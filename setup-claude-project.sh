#!/bin/bash
# MCP GatewayをClaude-Projectに統合するセットアップスクリプト

echo "🚀 MCP GatewayをClaude-Projectに統合します..."

# 色の定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 使用方法を表示
usage() {
    echo "使用方法:"
    echo "  $0 [Claude-Projectパス] [ベースとなるdocker-compose.yml]"
    echo ""
    echo "例:"
    echo "  $0                                              # デフォルト: ~/Claude-Project, docker-compose-base.yml"
    echo "  $0 /path/to/project                            # カスタムパス, docker-compose-base.yml"
    echo "  $0 /path/to/project docker-compose.yml         # カスタムパス, カスタムファイル"
    echo "  $0 ~/Claude-Project docker-compose-teams.yml   # デフォルトパス, teams用ファイル"
    exit 1
}

# ヘルプオプション
if [[ "$1" == "-h" ]] || [[ "$1" == "--help" ]]; then
    usage
fi

# Claude-Projectディレクトリのパスを設定
CLAUDE_PROJECT_DIR="${1:-$HOME/Claude-Project}"

# ベースとなるdocker-compose.ymlファイル名
BASE_COMPOSE_FILE="${2:-docker-compose-base.yml}"

# Claude-Projectディレクトリの存在確認
if [ ! -d "$CLAUDE_PROJECT_DIR" ]; then
    echo -e "${RED}❌ エラー: Claude-Projectディレクトリが見つかりません: $CLAUDE_PROJECT_DIR${NC}"
    echo -e "${YELLOW}💡 ヒント: 引数でディレクトリを指定できます: $0 /path/to/Claude-Project${NC}"
    exit 1
fi

echo -e "${GREEN}📂 Claude-Projectディレクトリ: $CLAUDE_PROJECT_DIR${NC}"
echo -e "${BLUE}📄 ベースファイル: $BASE_COMPOSE_FILE${NC}"

# ベースファイルの存在確認
if [ ! -f "$CLAUDE_PROJECT_DIR/$BASE_COMPOSE_FILE" ]; then
    echo -e "${RED}❌ エラー: ベースとなるDocker Composeファイルが見つかりません: $BASE_COMPOSE_FILE${NC}"
    echo -e "${YELLOW}💡 利用可能なファイル:${NC}"
    ls -la "$CLAUDE_PROJECT_DIR"/*.yml 2>/dev/null || echo "   （Docker Composeファイルが見つかりません）"
    exit 1
fi

# Claude-Projectディレクトリに移動
cd "$CLAUDE_PROJECT_DIR" || exit 1

# 1. MCP GatewayをGit Submoduleとして追加
echo -e "\n${YELLOW}1. MCP GatewayをGit Submoduleとして追加...${NC}"

if [ ! -d "mcp-gateway" ]; then
    echo "   Git Submoduleとして追加中..."
    git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway
    
    # Submoduleの初期化とアップデート
    git submodule update --init --recursive
    
    echo "   ✓ MCP Gatewayを追加しました"
else
    echo "   ✓ MCP Gatewayは既に存在します"
    echo "   最新版に更新中..."
    cd mcp-gateway && git pull origin main && cd ..
    git submodule update --recursive
fi

# 2. 依存関係のインストール
echo -e "\n${YELLOW}2. 依存関係をインストール...${NC}"
cd mcp-gateway && bun install && cd ..
echo "   ✓ 依存関係をインストールしました"

# 3. 統合ファイルをシンボリックリンクで配置
echo -e "\n${YELLOW}3. 統合ファイルを設定...${NC}"

# docker-compose.gateway.yml (シンボリックリンク)
if [ ! -e "docker-compose.gateway.yml" ]; then
    ln -s mcp-gateway/claude-project-integration/docker-compose.yml docker-compose.gateway.yml
    echo "   ✓ docker-compose.gateway.yml (シンボリックリンク)"
fi

# MCP設定ファイル (シンボリックリンク)
mkdir -p docker-base/config
if [ ! -e "docker-base/config/mcp-servers-gateway.json" ]; then
    ln -s ../../../mcp-gateway/claude-project-integration/mcp-servers-gateway.json docker-base/config/mcp-servers-gateway.json
    echo "   ✓ mcp-servers-gateway.json (シンボリックリンク)"
fi

# setup-mcp-gateway.sh スクリプト
if [ ! -e "docker-base/scripts/setup-mcp-gateway.sh" ]; then
    cat > docker-base/scripts/setup-mcp-gateway.sh << 'EOF'
#!/bin/bash
# MCP設定をGateway用に切り替え

echo "🔄 MCP設定をGateway用に切り替えます..."

# バックアップを作成
if [ -f ~/.config/claude/mcp-servers.json ]; then
    cp ~/.config/claude/mcp-servers.json ~/.config/claude/mcp-servers.json.backup
fi

# Gateway用設定をコピー
cp /opt/claude-system/config/mcp-servers-gateway.json ~/.config/claude/mcp-servers.json

echo "✅ MCP設定をGateway用に更新しました"
echo "💡 元の設定に戻す場合: cp ~/.config/claude/mcp-servers.json.backup ~/.config/claude/mcp-servers.json"
EOF
    chmod +x docker-base/scripts/setup-mcp-gateway.sh
    echo "   ✓ setup-mcp-gateway.sh"
fi

# 4. プロキシサーバー起動スクリプトを作成
echo -e "\n${YELLOW}4. 起動スクリプトを作成...${NC}"

# start-gateway-proxy.sh
if [ ! -e "start-gateway-proxy.sh" ]; then
    cat > start-gateway-proxy.sh << 'EOF'
#!/bin/bash
# MCP Gatewayプロキシサーバーを起動

echo "🚀 MCP Gatewayプロキシサーバーを起動します..."
cd mcp-gateway && bun run proxy
EOF
    chmod +x start-gateway-proxy.sh
    echo "   ✓ start-gateway-proxy.sh"
fi

# start-with-gateway.sh
if [ ! -e "start-with-gateway.sh" ]; then
    cat > start-with-gateway.sh << EOF
#!/bin/bash
# MCP Gateway統合環境を起動

echo "🚀 MCP Gateway統合環境を起動します..."

# ベースファイルを環境変数から取得（デフォルト: docker-compose-base.yml）
BASE_COMPOSE_FILE="\${BASE_COMPOSE_FILE:-$BASE_COMPOSE_FILE}"

echo "📄 使用するベースファイル: \$BASE_COMPOSE_FILE"

# プロキシサーバーをバックグラウンドで起動
echo "📡 プロキシサーバーを起動中..."
cd mcp-gateway && bun run proxy &
PROXY_PID=\$!

# 少し待機
sleep 3

# Docker Composeで起動
echo "🐳 Dockerコンテナを起動中..."
docker compose -f \$BASE_COMPOSE_FILE -f docker-compose.gateway.yml up -d

echo "✅ 起動完了！"
echo ""
echo "📌 アクセス情報:"
echo "   - MCP管理用Web UI: http://localhost:3002"
echo "   - MCP Gateway API: http://localhost:3003"
echo ""
echo "💡 コンテナに接続: docker exec -it claude-code-\${PROJECT_NAME} bash"
echo ""
echo "⚠️  プロキシサーバーのPID: \$PROXY_PID"
echo "   終了時は: kill \$PROXY_PID"
EOF
    chmod +x start-with-gateway.sh
    echo "   ✓ start-with-gateway.sh"
fi

echo -e "\n${GREEN}✅ セットアップ完了！${NC}"
echo ""
echo -e "${YELLOW}📋 使い方:${NC}"
echo "1. 新しいターミナルでプロキシサーバーを起動:"
echo "   ${GREEN}./start-gateway-proxy.sh${NC}"
echo ""
echo "2. 別のターミナルで統合環境を起動:"
echo "   ${GREEN}docker compose -f $BASE_COMPOSE_FILE -f docker-compose.gateway.yml up -d${NC}"
echo ""
echo "   または、統合起動スクリプトを使用:"
echo "   ${GREEN}./start-with-gateway.sh${NC}"
echo ""
echo "3. コンテナ内でMCP設定を切り替え:"
echo "   ${GREEN}docker exec -it claude-code-\${PROJECT_NAME} bash${NC}"
echo "   ${GREEN}setup-mcp-gateway${NC}"
echo ""
echo "📌 アクセス先:"
echo "   - MCP管理用Web UI: ${GREEN}http://localhost:3002${NC}"
echo "   - MCP Gateway API: ${GREEN}http://localhost:3003${NC}"
echo ""
echo "📚 詳細は mcp-gateway/claude-project-integration/README.md を参照してください。"