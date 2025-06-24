#!/bin/bash

echo "🚀 MCP Gateway を起動します..."
echo ""

# 色付きの出力
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# プロセスIDを保存
PROXY_PID=""

# クリーンアップ関数
cleanup() {
    echo ""
    echo "🛑 シャットダウン中..."
    
    # プロキシサーバーを停止
    if [ ! -z "$PROXY_PID" ]; then
        kill $PROXY_PID 2>/dev/null
        echo "  ✓ プロキシサーバーを停止しました"
    fi
    
    # Dockerコンテナを停止
    echo "  ⏳ Dockerコンテナを停止中..."
    docker-compose -f /Users/kirinnokubinagaiyo/Project/mcp-gateway/docker-compose.yml down
    
    echo "👋 終了しました"
    exit 0
}

# シグナルハンドラーを設定
trap cleanup INT TERM

# MCPゲートウェイのディレクトリに移動
cd /Users/kirinnokubinagaiyo/Project/mcp-gateway

# プロキシサーバーを起動
echo "${BLUE}🔌 MCPプロキシサーバーを起動中...${NC}"
cd mcp-proxy-server
npm install > /dev/null 2>&1
env PATH="$PATH" node server.js > ../proxy.log 2>&1 &
PROXY_PID=$!
cd ..

# プロキシサーバーが起動するまで待機
echo "  ⏳ プロキシサーバーの起動を待っています..."
for i in {1..10}; do
    if nc -z localhost 9999 2>/dev/null; then
        echo "  ${GREEN}✓ プロキシサーバーが起動しました${NC}"
        break
    fi
    sleep 1
done

# Dockerコンテナを起動
echo ""
echo "${BLUE}🐳 Dockerコンテナを起動中...${NC}"
docker-compose up -d --build

# 起動を待機
echo ""
echo "⏳ コンテナの起動を待っています..."
for i in {1..15}; do
    if curl -s http://localhost:3002 > /dev/null 2>&1 && curl -s http://localhost:3003/api/config > /dev/null 2>&1; then
        echo "${GREEN}✓ コンテナが起動しました${NC}"
        break
    fi
    sleep 1
done

# 起動完了
echo ""
echo "${GREEN}✅ MCP Gateway が起動しました！${NC}"
echo ""
echo "📍 アクセスURL:"
echo "  • クライアント: ${GREEN}http://localhost:3002${NC}"
echo "  • サーバーAPI: ${BLUE}http://localhost:3003${NC}"
echo "  • プロキシ: ${YELLOW}ws://localhost:9999${NC}"
echo ""
echo "✨ ${GREEN}ローカルのMCPサーバー（npxなど）を使用できます！${NC}"
echo "✨ ${GREEN}他のDockerコンテナからもアクセスできます！${NC}"
echo ""
echo "📝 ログファイル:"
echo "  • プロキシ: proxy.log"
echo "  • Docker: docker-compose logs -f"
echo ""
echo "🛑 停止するには ${GREEN}Ctrl+C${NC} を押してください"
echo ""

# プロセスが終了するまで待機
wait $PROXY_PID