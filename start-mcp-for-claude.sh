#!/bin/bash
# Claude Code用のMCP Gateway起動スクリプト

# プロキシサーバーの起動確認
echo "🔍 MCPプロキシサーバーをチェック中..."
if ! nc -z localhost ${MCP_PROXY_PORT:-9999} 2>/dev/null; then
    echo "⚠️  MCPプロキシサーバーが起動していません！"
    echo "👉 別のターミナルで以下のコマンドを実行してください:"
    echo "   cd $(pwd) && bun run proxy"
    exit 1
fi

echo "✅ プロキシサーバーは起動しています"
echo "🚀 MCP Gatewayを起動中..."

# MCPサーバーをstdioモードで起動
exec bun server/index.ts