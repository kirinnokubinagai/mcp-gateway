#!/bin/bash
# MCP GatewayをClaude-Projectに一発で統合（Git Submoduleのみ使用）

set -e  # エラーが発生したら停止

echo "🚀 MCP Gateway統合を開始します（Git Submoduleベース）..."

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
BASE_COMPOSE_FILE="$2"

# ディレクトリとファイルの存在確認
if [ ! -d "$CLAUDE_PROJECT_DIR" ]; then
    echo -e "${RED}❌ エラー: Claude-Projectディレクトリが見つかりません: $CLAUDE_PROJECT_DIR${NC}"
    exit 1
fi

if [ ! -f "$CLAUDE_PROJECT_DIR/$BASE_COMPOSE_FILE" ]; then
    echo -e "${RED}❌ エラー: Docker Composeファイルが見つかりません: $BASE_COMPOSE_FILE${NC}"
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
cd mcp-gateway
nohup bun run proxy > /dev/null 2>&1 &
PROXY_PID=$!
cd ..
sleep 3

# 4. Docker環境を起動（Git Submodule内のファイルを直接参照）
echo -e "${YELLOW}4. Docker環境を起動...${NC}"
docker compose -f "$BASE_COMPOSE_FILE" -f mcp-gateway/claude-project-integration/docker-compose.yml up -d

# 5. コンテナが起動するまで待機
echo -e "${YELLOW}5. コンテナの起動を待機中...${NC}"
sleep 10

# PROJECT_NAMEを取得
PROJECT_NAME=$(basename "$PWD")

# 6. MCP設定を自動で切り替え
echo -e "${YELLOW}6. MCP設定を切り替え...${NC}"
docker exec claude-code-${PROJECT_NAME} bash -c "
mkdir -p ~/.config/claude
if [ -f ~/.config/claude/mcp-servers.json ]; then
    cp ~/.config/claude/mcp-servers.json ~/.config/claude/mcp-servers.json.backup
fi
cat > ~/.config/claude/mcp-servers.json << 'EOF'
{
  \"mcpServers\": {
    \"gateway\": {
      \"transport\": \"http\",
      \"url\": \"http://mcp-gateway-server:3003\"
    }
  }
}
EOF
"

echo -e "\n${GREEN}✅ 統合完了！${NC}"
echo ""
echo -e "${GREEN}📌 すべて自動で設定されました:${NC}"
echo "   - Git Submodule: mcp-gateway/"
echo "   - プロキシサーバー: 起動済み (PID: $PROXY_PID)"
echo "   - Docker環境: 起動済み"
echo "   - MCP設定: Gateway用に切り替え済み"
echo ""
echo -e "${GREEN}🌐 アクセス先:${NC}"
echo "   - MCP管理用Web UI: http://localhost:3002"
echo "   - MCP Gateway API: http://localhost:3003"
echo ""
echo -e "${GREEN}💡 使い方:${NC}"
echo "   コンテナに接続: docker exec -it claude-code-${PROJECT_NAME} bash"
echo "   Claude CLIを起動: ccd"
echo ""
echo -e "${YELLOW}🛑 終了時:${NC}"
echo "   Docker停止: docker compose -f $BASE_COMPOSE_FILE -f mcp-gateway/claude-project-integration/docker-compose.yml down"
echo "   プロキシ停止: kill $PROXY_PID"