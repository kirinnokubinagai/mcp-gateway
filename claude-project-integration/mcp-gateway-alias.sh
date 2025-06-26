#!/bin/bash

# MCP Gateway用エイリアス設定
# このファイルをClaude Codeコンテナの.bashrcに追加してエイリアスを利用可能にする

# MCP Gateway関連のエイリアス
alias mcp-add-gateway='bash /opt/claude-system/mcp-gateway/setup-mcp-gateway.sh'
alias mcp-gateway='claude mcp add gateway -- docker exec -i mcp-gateway-server-${PROJECT_NAME} bun server/index.ts'
alias mcp-gateway-http='claude mcp add -t http gateway http://mcp-gateway-server:3003'

# ショートカット
alias mcpg='mcp-add-gateway'
alias mcpgh='mcp-gateway-http'

# MCP管理コマンド
alias mcp-list='claude mcp list'
alias mcp-remove='claude mcp remove'

# 説明を表示する関数
mcp-help() {
    echo "MCP Gateway Commands:"
    echo "  mcp-add-gateway (mcpg)  - MCP Gatewayを自動設定"
    echo "  mcp-gateway            - Docker exec経由でGatewayを追加"
    echo "  mcp-gateway-http       - HTTPトランスポートでGatewayを追加"
    echo "  mcp-list              - 設定済みMCPサーバーを表示"
    echo "  mcp-remove <name>     - MCPサーバーを削除"
    echo "  mcp-help              - このヘルプを表示"
}

# 初回ログイン時に自動実行（オプション）
if [ -z "$MCP_GATEWAY_SETUP_DONE" ]; then
    echo ""
    echo "💡 MCP Gatewayを設定するには 'mcpg' または 'mcp-add-gateway' を実行してください"
    echo "   詳細は 'mcp-help' で確認できます"
    echo ""
    export MCP_GATEWAY_SETUP_DONE=1
fi