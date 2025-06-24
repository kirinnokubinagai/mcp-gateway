#!/bin/bash

echo "🚀 MCP Gateway をデーモンモードで起動します..."
echo ""

# MCPゲートウェイのディレクトリに移動
cd /Users/kirinnokubinagaiyo/Project/mcp-gateway

# プロキシサーバーを起動
echo "🔌 MCPプロキシサーバーを起動中..."
cd mcp-proxy-server
npm install > /dev/null 2>&1
nohup env PATH="$PATH" node server.js > ../proxy.log 2>&1 &
PROXY_PID=$!
echo $PROXY_PID > ../proxy.pid
cd ..

# プロキシサーバーが起動するまで待機
echo "  ⏳ プロキシサーバーの起動を待っています..."
for i in {1..10}; do
    if nc -z localhost 9999 2>/dev/null; then
        echo "  ✓ プロキシサーバーが起動しました"
        break
    fi
    sleep 1
done

# Dockerコンテナを起動
echo ""
echo "🐳 Dockerコンテナを起動中..."
docker-compose up -d --build

# 起動を待機
echo ""
echo "⏳ コンテナの起動を待っています..."
for i in {1..15}; do
    if curl -s http://localhost:3002 > /dev/null 2>&1 && curl -s http://localhost:3003/api/config > /dev/null 2>&1; then
        echo "✓ コンテナが起動しました"
        break
    fi
    sleep 1
done

# 起動完了
echo ""
echo "✅ MCP Gateway がデーモンモードで起動しました！"
echo ""
echo "📍 アクセスURL:"
echo "  • クライアント: http://localhost:3002"
echo "  • サーバーAPI: http://localhost:3003"
echo "  • プロキシ: ws://localhost:9999"
echo ""
echo "🛑 停止するには: ./stop-daemon.sh を実行してください"
echo ""
echo "📝 ログを確認:"
echo "  • プロキシ: tail -f proxy.log"
echo "  • Docker: docker-compose logs -f"