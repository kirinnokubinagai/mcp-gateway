#!/bin/bash
# Docker Composeファイルを書き換えてMCP Gatewayを統合

set -e

echo "🚀 MCP Gateway統合を開始します..."

# 引数チェック
if [ $# -ne 1 ]; then
    echo "使用方法: $0 <docker-compose.ymlファイルのパス>"
    echo "例: $0 ~/Claude-Project/docker-compose-base.yml"
    exit 1
fi

COMPOSE_FILE="$1"

# ファイルの存在確認
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "❌ エラー: Docker Composeファイルが見つかりません: $COMPOSE_FILE"
    exit 1
fi

# バックアップ作成
cp "$COMPOSE_FILE" "${COMPOSE_FILE}.backup"
echo "📄 バックアップを作成しました: ${COMPOSE_FILE}.backup"

# MCP Gatewayサービスが既に追加されているかチェック
if grep -q "mcp-gateway-server" "$COMPOSE_FILE"; then
    echo "⚠️  MCP Gatewayは既に統合されています"
    exit 0
fi

# docker-compose.ymlに追加する内容を作成
cat >> "$COMPOSE_FILE" << 'EOF'

  # === MCP Gateway Services ===
  # プロキシチェッカー
  mcp-proxy-check:
    image: busybox
    command: |
      sh -c "
        if ! nc -z host.docker.internal 9999 2>/dev/null; then
          echo '❌ エラー: MCPプロキシサーバーが起動していません！'
          echo '👉 cd mcp-gateway && bun run proxy'
          exit 1
        fi
      "
    extra_hosts:
      - "host.docker.internal:host-gateway"
    networks:
      - app-network

  # MCP Gateway APIサーバー
  mcp-gateway-server:
    build:
      context: ./mcp-gateway
      dockerfile: Dockerfile.server
    container_name: mcp-gateway-server
    ports:
      - "${MCP_API_PORT:-3003}:3003"
    volumes:
      - ./mcp-gateway/mcp-config.json:/app/mcp-config.json
    environment:
      - MCP_PROXY_PORT=${MCP_PROXY_PORT:-9999}
      - DOCKER_ENV=true
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      mcp-proxy-check:
        condition: service_completed_successfully
    networks:
      - app-network
    restart: unless-stopped

  # MCP管理用Web UI
  mcp-gateway-client:
    build:
      context: ./mcp-gateway
      dockerfile: Dockerfile.client
    container_name: mcp-gateway-client
    ports:
      - "${MCP_WEB_PORT:-3002}:3002"
    environment:
      - API_URL=http://mcp-gateway-server:3003
    depends_on:
      - mcp-gateway-server
    networks:
      - app-network
    restart: unless-stopped
EOF

# claude-codeサービスを更新（環境変数、depends_on、volumesを追加）
# sedを使用してclaude-codeサービスに設定を追加
echo "🔧 claude-codeサービスを更新中..."

# claude-codeサービスのenvironmentセクションを探して追加
# ここは複雑なので、手動で追加することを推奨
echo ""
echo "⚠️  注意: claude-codeサービスに以下を手動で追加してください:"
echo ""
echo "  claude-code:"
echo "    environment:"
echo "      - MCP_GATEWAY_URL=http://mcp-gateway-server:3003"
echo "    depends_on:"
echo "      - mcp-gateway-server"
echo "    volumes:"
echo "      - ./mcp-gateway/claude-project-integration/mcp-servers-gateway.json:/home/developer/.config/claude/mcp-servers.json:ro"
echo ""

echo "✅ MCP Gatewayサービスを追加しました！"
echo ""
echo "📝 次のステップ:"
echo "1. claude-codeサービスの設定を手動で更新"
echo "2. Git Submoduleを追加: git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git"
echo "3. プロキシサーバーを起動: cd mcp-gateway && bun run proxy"
echo "4. Docker Composeを再起動: docker compose up -d"