#!/bin/bash
# MCP GatewayをClaude-Projectに正しく統合するスクリプト
# docker-compose.ymlにサービスを直接追加する方式

set -e

echo "🚀 MCP Gateway統合を開始します..."

# 色の定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 引数チェック
if [ $# -ne 2 ]; then
    echo -e "${RED}使用方法: $0 <Claude-Projectパス> <docker-compose.ymlファイル名>${NC}"
    echo "例: $0 ~/Claude-Project docker-compose-base.yml"
    exit 1
fi

CLAUDE_PROJECT_DIR="$1"
COMPOSE_FILE_NAME="$2"

# ディレクトリとファイルの存在確認
if [ ! -d "$CLAUDE_PROJECT_DIR" ]; then
    echo -e "${RED}❌ エラー: Claude-Projectディレクトリが見つかりません: $CLAUDE_PROJECT_DIR${NC}"
    exit 1
fi

if [ ! -f "$CLAUDE_PROJECT_DIR/$COMPOSE_FILE_NAME" ]; then
    echo -e "${RED}❌ エラー: Docker Composeファイルが見つかりません: $COMPOSE_FILE_NAME${NC}"
    exit 1
fi

cd "$CLAUDE_PROJECT_DIR" || exit 1

# 1. Git Submodule追加（既存の場合は更新）
echo -e "${YELLOW}1. Git Submoduleを設定...${NC}"
if [ ! -d "mcp-gateway" ]; then
    git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway
fi
git submodule update --init --recursive
(cd mcp-gateway && git pull origin main)

# 2. 依存関係インストール
echo -e "${YELLOW}2. 依存関係をインストール...${NC}"
(cd mcp-gateway && bun install)

# 3. プロキシサーバーをバックグラウンドで起動
echo -e "${YELLOW}3. プロキシサーバーを起動...${NC}"
if nc -z localhost 9999 2>/dev/null; then
    echo "プロキシサーバーは既に起動しています"
else
    cd mcp-gateway
    nohup bun run proxy > /dev/null 2>&1 &
    PROXY_PID=$!
    cd ..
    sleep 3
    echo "プロキシサーバー起動完了 (PID: $PROXY_PID)"
fi

# 4. docker-compose.ymlにMCP Gatewayサービスを追加
echo -e "${YELLOW}4. Docker ComposeファイルにMCP Gatewayサービスを追加...${NC}"

# PROJECT_NAMEを取得
PROJECT_NAME=$(basename "$PWD")

# Pythonスクリプトを使用してYAMLを処理
python3 << EOF
import yaml
import sys
import os

compose_file = '$COMPOSE_FILE_NAME'
project_name = '$PROJECT_NAME'

# YAMLファイルを読み込み
with open(compose_file, 'r') as f:
    data = yaml.safe_load(f)

# バックアップを作成
import shutil
shutil.copy(compose_file, f"{compose_file}.backup")
print(f"バックアップを作成しました: {compose_file}.backup")

# MCP Gatewayサービスが既に追加されているかチェック
if 'services' in data and 'mcp-gateway-server' in data['services']:
    print("⚠️  MCP Gatewayサービスは既に追加されています")
    sys.exit(0)

# servicesセクションがない場合は作成
if 'services' not in data:
    data['services'] = {}

# MCP Gatewayサービスを追加
data['services']['mcp-proxy-check'] = {
    'image': 'busybox',
    'command': '''sh -c "if ! nc -z host.docker.internal 9999 2>/dev/null; then echo '❌ エラー: MCPプロキシサーバーが起動していません！'; echo '👉 cd mcp-gateway && bun run proxy'; exit 1; fi"''',
    'extra_hosts': ['host.docker.internal:host-gateway']
}

if 'networks' in data and 'app-network' in data['networks']:
    data['services']['mcp-proxy-check']['networks'] = ['app-network']

data['services']['mcp-gateway-server'] = {
    'build': {
        'context': './mcp-gateway',
        'dockerfile': 'Dockerfile.server'
    },
    'container_name': f'mcp-gateway-server',
    'ports': ['\${MCP_API_PORT:-3003}:3003'],
    'volumes': ['./mcp-gateway/mcp-config.json:/app/mcp-config.json'],
    'environment': [
        'MCP_PROXY_PORT=\${MCP_PROXY_PORT:-9999}',
        'DOCKER_ENV=true'
    ],
    'extra_hosts': ['host.docker.internal:host-gateway'],
    'depends_on': {
        'mcp-proxy-check': {
            'condition': 'service_completed_successfully'
        }
    },
    'restart': 'unless-stopped'
}

if 'networks' in data and 'app-network' in data['networks']:
    data['services']['mcp-gateway-server']['networks'] = ['app-network']

data['services']['mcp-gateway-client'] = {
    'build': {
        'context': './mcp-gateway',
        'dockerfile': 'Dockerfile.client'
    },
    'container_name': f'mcp-gateway-client',
    'ports': ['\${MCP_WEB_PORT:-3002}:3002'],
    'environment': ['API_URL=http://mcp-gateway-server:3003'],
    'depends_on': ['mcp-gateway-server'],
    'restart': 'unless-stopped'
}

if 'networks' in data and 'app-network' in data['networks']:
    data['services']['mcp-gateway-client']['networks'] = ['app-network']

# claude-codeサービスの更新
if 'claude-code' in data['services']:
    service = data['services']['claude-code']
    
    # environmentに追加
    if 'environment' not in service:
        service['environment'] = []
    if isinstance(service['environment'], list):
        if 'MCP_GATEWAY_URL=http://mcp-gateway-server:3003' not in service['environment']:
            service['environment'].append('MCP_GATEWAY_URL=http://mcp-gateway-server:3003')
    
    # depends_onに追加
    if 'depends_on' not in service:
        service['depends_on'] = []
    if isinstance(service['depends_on'], list):
        if 'mcp-gateway-server' not in service['depends_on']:
            service['depends_on'].append('mcp-gateway-server')
    
    # volumesに追加
    if 'volumes' not in service:
        service['volumes'] = []
    mcp_config_volume = './mcp-gateway/claude-project-integration/mcp-servers-gateway.json:/home/developer/.config/claude/mcp-servers.json:ro'
    if mcp_config_volume not in service['volumes']:
        service['volumes'].append(mcp_config_volume)

# YAMLファイルに書き込み
with open(compose_file, 'w') as f:
    yaml.dump(data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

print("✅ MCP Gatewayサービスを追加しました")
EOF

# 5. Docker環境を再起動
echo -e "${YELLOW}5. Docker環境を再起動...${NC}"
docker compose -f "$COMPOSE_FILE_NAME" down
docker compose -f "$COMPOSE_FILE_NAME" up -d

echo -e "\n${GREEN}✅ 統合完了！${NC}"
echo ""
echo -e "${GREEN}📌 すべて自動で設定されました:${NC}"
echo "   - Git Submodule: mcp-gateway/"
echo "   - プロキシサーバー: 起動済み"
echo "   - Docker Composeファイル: 更新済み"
echo "   - MCP Gatewayサービス: 追加済み"
echo ""
echo -e "${GREEN}🌐 アクセス先:${NC}"
echo "   - MCP管理用Web UI: http://localhost:3002"
echo "   - MCP Gateway API: http://localhost:3003"