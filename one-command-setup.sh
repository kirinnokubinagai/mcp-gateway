#!/bin/bash
# MCP GatewayをClaude-Projectに一発で統合するスクリプト

set -e  # エラーが発生したら停止

echo "🚀 MCP Gateway統合を開始します..."

# 色の定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

# 1. Git Submodule追加
echo -e "${YELLOW}📦 Git Submoduleを追加...${NC}"
if [ ! -d "mcp-gateway" ]; then
    git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway
    git submodule update --init --recursive
else
    cd mcp-gateway && git pull origin main && cd ..
    git submodule update --recursive
fi

# 2. 依存関係インストール
echo -e "${YELLOW}📥 依存関係をインストール...${NC}"
cd mcp-gateway && bun install && cd ..

# 3. プロキシサーバーをバックグラウンドで起動
echo -e "${YELLOW}📡 プロキシサーバーを起動...${NC}"
cd mcp-gateway && bun run proxy &
PROXY_PID=$!
cd ..
sleep 3

# 4. Docker環境を起動
echo -e "${YELLOW}🐳 Docker環境を起動...${NC}"
docker compose -f "$BASE_COMPOSE_FILE" -f mcp-gateway/claude-project-integration/docker-compose.yml up -d

# 5. MCP設定を自動で切り替え（コンテナが起動するまで待つ）
echo -e "${YELLOW}⏳ コンテナの起動を待機中...${NC}"
sleep 10

# PROJECT_NAMEを取得
PROJECT_NAME=$(basename "$PWD")

echo -e "${YELLOW}🔄 MCP設定を切り替え...${NC}"
docker exec claude-code-${PROJECT_NAME} bash -c "
mkdir -p ~/.config/claude
if [ -f ~/.config/claude/mcp-servers.json ]; then
    cp ~/.config/claude/mcp-servers.json ~/.config/claude/mcp-servers.json.backup
fi
echo '{
  \"mcpServers\": {
    \"gateway\": {
      \"transport\": \"http\",
      \"url\": \"http://mcp-gateway-server:3003\"
    }
  }
}' > ~/.config/claude/mcp-servers.json
"

echo -e "\n${GREEN}✅ 統合完了！${NC}"
echo ""
echo -e "${YELLOW}📌 情報:${NC}"
echo -e "   プロキシサーバーPID: ${GREEN}$PROXY_PID${NC}"
echo -e "   MCP管理用Web UI: ${GREEN}http://localhost:3002${NC}"
echo -e "   MCP Gateway API: ${GREEN}http://localhost:3003${NC}"
echo ""
echo -e "${YELLOW}💡 使い方:${NC}"
echo -e "   1. コンテナに接続: ${GREEN}docker exec -it claude-code-${PROJECT_NAME} bash${NC}"
echo -e "   2. Claude CLIを起動: ${GREEN}ccd${NC}"
echo ""
echo -e "${YELLOW}🛑 終了方法:${NC}"
echo -e "   1. Docker環境を停止: ${GREEN}docker compose -f $BASE_COMPOSE_FILE -f mcp-gateway/claude-project-integration/docker-compose.yml down${NC}"
echo -e "   2. プロキシサーバーを停止: ${GREEN}kill $PROXY_PID${NC}"