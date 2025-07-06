#!/bin/bash

# プロキシサーバーをデーモンとして起動するスクリプト

# 色付きの出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# pm2がインストールされているか確認
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}pm2がインストールされていません。インストールしています...${NC}"
    npm install -g pm2
fi

# プロキシサーバーのパス
PROXY_DIR="$(cd "$(dirname "$0")" && pwd)"
PROXY_SCRIPT="$PROXY_DIR/mcp-proxy-server/server.ts"

# pm2の設定ファイルを作成
cat > "$PROXY_DIR/ecosystem.config.js" << EOF
module.exports = {
  apps: [{
    name: 'mcp-proxy',
    script: 'bun',
    args: '$PROXY_SCRIPT',
    cwd: '$PROXY_DIR',
    env: {
      MCP_PROXY_PORT: process.env.MCP_PROXY_PORT || '9999'
    },
    // 自動再起動の設定
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    // クラッシュ時の再起動設定
    min_uptime: '10s',
    max_restarts: 10,
    // ログ設定
    error_file: '$PROXY_DIR/logs/proxy-error.log',
    out_file: '$PROXY_DIR/logs/proxy-out.log',
    log_file: '$PROXY_DIR/logs/proxy-combined.log',
    time: true,
    // エラー時の通知
    kill_timeout: 5000,
    listen_timeout: 10000,
    // メモリ最適化
    node_args: '--expose-gc'
  }]
};
EOF

# ログディレクトリを作成
mkdir -p "$PROXY_DIR/logs"

# 既存のプロセスを停止
echo -e "${YELLOW}既存のプロキシサーバーを停止しています...${NC}"
pm2 stop mcp-proxy 2>/dev/null || true
pm2 delete mcp-proxy 2>/dev/null || true

# 手動で起動しているbunプロセスも停止
pkill -f "bun.*mcp-proxy-server" 2>/dev/null || true

# プロキシサーバーを起動
echo -e "${GREEN}プロキシサーバーをデーモンとして起動しています...${NC}"
pm2 start ecosystem.config.js

# 起動確認
sleep 2
if pm2 list | grep -q "mcp-proxy.*online"; then
    echo -e "${GREEN}✅ プロキシサーバーが正常に起動しました${NC}"
    echo ""
    echo "📍 WebSocket URL: ws://localhost:${MCP_PROXY_PORT:-9999}"
    echo ""
    echo "管理コマンド:"
    echo "  pm2 status        - ステータス確認"
    echo "  pm2 logs mcp-proxy - ログ表示"
    echo "  pm2 stop mcp-proxy - 停止"
    echo "  pm2 restart mcp-proxy - 再起動"
    echo "  pm2 monit         - リアルタイム監視"
    echo ""
    
    # システム起動時の自動起動を設定
    echo -e "${YELLOW}システム起動時の自動起動を設定しますか？ (y/N)${NC}"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        pm2 startup
        pm2 save
        echo -e "${GREEN}✅ 自動起動を設定しました${NC}"
    fi
else
    echo -e "${RED}❌ プロキシサーバーの起動に失敗しました${NC}"
    pm2 logs mcp-proxy --lines 50
    exit 1
fi