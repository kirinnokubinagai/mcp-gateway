#!/bin/bash

echo "🛑 MCP Gateway を停止します..."

# MCPゲートウェイのディレクトリに移動
cd /Users/kirinnokubinagaiyo/Project/mcp-gateway

# プロキシサーバーを停止
if [ -f proxy.pid ]; then
    PROXY_PID=$(cat proxy.pid)
    if kill -0 $PROXY_PID 2>/dev/null; then
        kill $PROXY_PID
        echo "  ✓ プロキシサーバーを停止しました"
    fi
    rm proxy.pid
fi

# Dockerコンテナを停止
echo "  ⏳ Dockerコンテナを停止中..."
docker-compose down

echo "👋 MCP Gateway を停止しました"