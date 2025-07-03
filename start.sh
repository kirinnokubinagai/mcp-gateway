#!/bin/bash

# MCP Gateway 統合起動スクリプト

echo "🚀 MCP Gateway を起動します..."

# プロキシサーバーがすでに起動しているかチェック
if lsof -ti :9999 > /dev/null 2>&1; then
    echo "✅ プロキシサーバーは既に起動しています"
else
    echo "📡 プロキシサーバーをデーモンとして起動..."
    npm run proxy:daemon
    
    # 起動待機
    sleep 3
    
    # 起動確認
    if lsof -ti :9999 > /dev/null 2>&1; then
        echo "✅ プロキシサーバーが起動しました"
    else
        echo "❌ プロキシサーバーの起動に失敗しました"
        exit 1
    fi
fi

# Docker Composeを起動
echo "🐳 Docker コンテナを起動..."
docker-compose up -d

# 状態確認
echo ""
echo "✨ MCP Gateway が起動しました！"
echo ""
echo "📍 アクセスURL:"
echo "   - Web UI: http://localhost:3002"
echo "   - API: http://localhost:3003"
echo "   - Proxy WebSocket: ws://localhost:9999"
echo ""
echo "🛑 停止する場合: ./stop.sh"