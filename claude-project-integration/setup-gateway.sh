#!/bin/bash
# MCP Gateway統合用セットアップスクリプト

echo "🚀 MCP Gatewayをセットアップします..."

# 色の定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# MCP Gatewayのルートディレクトリを検出
if [ -f "$SCRIPT_DIR/../package.json" ] && grep -q "mcp-gateway" "$SCRIPT_DIR/../package.json" 2>/dev/null; then
    MCP_GATEWAY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    INTEGRATION_DIR="$MCP_GATEWAY_ROOT/claude-project-integration"
else
    # 既にClaude-Project内で実行されている場合
    MCP_GATEWAY_ROOT=""
    INTEGRATION_DIR=""
fi

# Claude-Projectディレクトリのパスを設定
CLAUDE_PROJECT_DIR="${1:-$HOME/Claude-Project}"

if [ ! -d "$CLAUDE_PROJECT_DIR" ]; then
    echo -e "${RED}❌ エラー: Claude-Projectディレクトリが見つかりません: $CLAUDE_PROJECT_DIR${NC}"
    exit 1
fi

echo -e "${YELLOW}📂 Claude-Projectディレクトリ: $CLAUDE_PROJECT_DIR${NC}"

# 統合ファイルのコピー（MCP Gatewayディレクトリから実行された場合）
if [ -n "$INTEGRATION_DIR" ] && [ -d "$INTEGRATION_DIR" ]; then
    echo -e "\n${GREEN}0. 統合ファイルをClaude-Projectにコピー...${NC}"
    
    # setup-gateway.sh自体をコピー
    cp "$INTEGRATION_DIR/setup-gateway.sh" "$CLAUDE_PROJECT_DIR/"
    chmod +x "$CLAUDE_PROJECT_DIR/setup-gateway.sh"
    
    # その他の統合ファイルをコピー
    cp "$INTEGRATION_DIR/docker-compose.yml" "$CLAUDE_PROJECT_DIR/docker-compose.gateway.yml"
    cp "$INTEGRATION_DIR/mcp-servers-gateway.json" "$CLAUDE_PROJECT_DIR/docker-base/config/"
    
    # READMEが存在しない場合のみコピー
    if [ ! -f "$CLAUDE_PROJECT_DIR/README-gateway.md" ]; then
        cp "$INTEGRATION_DIR/README.md" "$CLAUDE_PROJECT_DIR/README-gateway.md"
    fi
    
    echo "   ✓ 統合ファイルをコピーしました"
    
    # Claude-Projectディレクトリに移動して再実行を促す
    echo -e "\n${YELLOW}📌 統合ファイルをコピーしました。以下のコマンドで続行してください:${NC}"
    echo -e "${GREEN}cd $CLAUDE_PROJECT_DIR && ./setup-gateway.sh${NC}"
    exit 0
fi

# 1. MCP GatewayをGit Submoduleとして追加
echo -e "\n${GREEN}1. MCP GatewayをGit Submoduleとして追加...${NC}"
cd "$CLAUDE_PROJECT_DIR" || exit 1

if [ ! -d "mcp-gateway" ]; then
    git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway
    cd mcp-gateway && bun install && cd ..
else
    echo "   ✓ MCP Gatewayは既に存在します"
    cd mcp-gateway && git pull && bun install && cd ..
fi

# 2. Docker Compose拡張ファイルを作成
echo -e "\n${GREEN}2. Docker Compose拡張ファイルを作成...${NC}"
cat > "$CLAUDE_PROJECT_DIR/docker-compose.gateway.yml" << 'EOF'
# MCP Gateway統合用Docker Compose拡張
version: "3.8"

services:
  # プロキシチェッカー
  mcp-proxy-check:
    image: busybox
    command: |
      sh -c "
        if ! nc -z host.docker.internal 9999 2>/dev/null; then
          echo '❌ エラー: MCPプロキシサーバーが起動していません！'
          echo '👉 別ターミナルで以下を実行してください:'
          echo '   cd mcp-gateway && bun run proxy'
          exit 1
        fi
      "
    extra_hosts:
      - "host.docker.internal:host-gateway"

  # MCP Gateway APIサーバー
  mcp-gateway-server:
    build:
      context: ./mcp-gateway
      dockerfile: Dockerfile.server
    container_name: mcp-gateway-server
    ports:
      - "3003:3003"
    volumes:
      - ./mcp-gateway/mcp-config.json:/app/mcp-config.json
    environment:
      - MCP_PROXY_PORT=9999
      - DOCKER_ENV=true
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      mcp-proxy-check:
        condition: service_completed_successfully
    restart: unless-stopped

  # MCP管理用Web UI
  mcp-gateway-client:
    build:
      context: ./mcp-gateway
      dockerfile: Dockerfile.client
    container_name: mcp-gateway-client
    ports:
      - "3002:3002"
    environment:
      - API_URL=http://mcp-gateway-server:3003
    depends_on:
      - mcp-gateway-server
    restart: unless-stopped

  # Claude Codeの拡張設定
  claude-code:
    environment:
      - MCP_GATEWAY_URL=http://mcp-gateway-server:3003
    depends_on:
      - mcp-gateway-server
    volumes:
      # MCP設定をGateway用に更新
      - ./docker-base/config/mcp-servers-gateway.json:/home/developer/.config/claude/mcp-servers.json:ro
EOF

# 3. MCP Gateway用の設定ファイルを作成
echo -e "\n${GREEN}3. MCP Gateway用設定ファイルを作成...${NC}"
cat > "$CLAUDE_PROJECT_DIR/docker-base/config/mcp-servers-gateway.json" << 'EOF'
{
  "mcpServers": {
    "gateway": {
      "transport": "http",
      "url": "http://mcp-gateway-server:3003"
    }
  }
}
EOF

# 4. プロキシサーバー起動スクリプトを作成
echo -e "\n${GREEN}4. プロキシサーバー起動スクリプトを作成...${NC}"
cat > "$CLAUDE_PROJECT_DIR/start-gateway-proxy.sh" << 'EOF'
#!/bin/bash
# MCP Gatewayプロキシサーバーを起動

echo "🚀 MCP Gatewayプロキシサーバーを起動します..."
cd mcp-gateway && bun run proxy
EOF
chmod +x "$CLAUDE_PROJECT_DIR/start-gateway-proxy.sh"

# 5. 統合起動スクリプトを作成
echo -e "\n${GREEN}5. 統合起動スクリプトを作成...${NC}"
cat > "$CLAUDE_PROJECT_DIR/start-with-gateway.sh" << 'EOF'
#!/bin/bash
# MCP Gateway統合環境を起動

echo "🚀 MCP Gateway統合環境を起動します..."

# プロキシサーバーをバックグラウンドで起動
echo "📡 プロキシサーバーを起動中..."
cd mcp-gateway && bun run proxy &
PROXY_PID=$!

# 少し待機
sleep 3

# Docker Composeで起動
echo "🐳 Dockerコンテナを起動中..."
docker compose -f docker-compose-base.yml -f docker-compose.gateway.yml up -d

echo "✅ 起動完了！"
echo ""
echo "📌 アクセス情報:"
echo "   - MCP管理用Web UI: http://localhost:3002"
echo "   - MCP Gateway API: http://localhost:3003"
echo ""
echo "💡 コンテナに接続: docker exec -it claude-code-${PROJECT_NAME} bash"
echo ""
echo "⚠️  プロキシサーバーのPID: $PROXY_PID"
echo "   終了時は: kill $PROXY_PID"
EOF
chmod +x "$CLAUDE_PROJECT_DIR/start-with-gateway.sh"

# 6. setup-mcpスクリプトを更新
echo -e "\n${GREEN}6. setup-mcpスクリプトにGateway切り替えオプションを追加...${NC}"
cat >> "$CLAUDE_PROJECT_DIR/docker-base/scripts/setup-mcp-gateway.sh" << 'EOF'
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
chmod +x "$CLAUDE_PROJECT_DIR/docker-base/scripts/setup-mcp-gateway.sh"

echo -e "\n${GREEN}✅ セットアップ完了！${NC}"
echo ""
echo "📋 使い方:"
echo "1. 新しいターミナルでプロキシサーバーを起動:"
echo "   ${YELLOW}cd $CLAUDE_PROJECT_DIR && ./start-gateway-proxy.sh${NC}"
echo ""
echo "2. 別のターミナルで統合環境を起動:"
echo "   ${YELLOW}cd $CLAUDE_PROJECT_DIR && docker compose -f docker-compose-base.yml -f docker-compose.gateway.yml up -d${NC}"
echo ""
echo "   または、統合起動スクリプトを使用:"
echo "   ${YELLOW}cd $CLAUDE_PROJECT_DIR && ./start-with-gateway.sh${NC}"
echo ""
echo "3. コンテナ内でMCP設定を切り替え:"
echo "   ${YELLOW}docker exec -it claude-code-\${PROJECT_NAME} bash${NC}"
echo "   ${YELLOW}setup-mcp-gateway${NC}"
echo ""
echo "📌 アクセス先:"
echo "   - MCP管理用Web UI: ${GREEN}http://localhost:3002${NC}"
echo "   - MCP Gateway API: ${GREEN}http://localhost:3003${NC}"