#!/bin/bash

# プロキシサーバーを安定して実行するスクリプト

# 色付きの出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# プロキシサーバーのパス
PROXY_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROXY_DIR/logs"
LOG_FILE="$LOG_DIR/proxy.log"
PID_FILE="$LOG_DIR/proxy.pid"

# ログディレクトリを作成
mkdir -p "$LOG_DIR"

# 既存のプロセスを停止
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo -e "${YELLOW}既存のプロキシサーバー (PID: $OLD_PID) を停止しています...${NC}"
        kill "$OLD_PID"
        sleep 2
    fi
fi

# 手動で起動しているプロセスも停止
pkill -f "bun.*mcp-proxy-server" 2>/dev/null || true

echo -e "${GREEN}プロキシサーバーを起動しています...${NC}"

# プロキシサーバーを無限ループで実行
while true; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') - プロキシサーバーを起動" >> "$LOG_FILE"
    
    # bunでプロキシサーバーを実行
    cd "$PROXY_DIR/mcp-proxy-server" && \
    bun run server.ts >> "$LOG_FILE" 2>&1 &
    
    # PIDを保存
    PROXY_PID=$!
    echo $PROXY_PID > "$PID_FILE"
    
    echo -e "${GREEN}✅ プロキシサーバーが起動しました (PID: $PROXY_PID)${NC}"
    echo "📍 WebSocket URL: ws://localhost:${MCP_PROXY_PORT:-9999}"
    echo ""
    echo "ログファイル: $LOG_FILE"
    echo "停止するには: kill $PROXY_PID"
    echo ""
    
    # プロセスが終了するまで待つ
    wait $PROXY_PID
    EXIT_CODE=$?
    
    echo "$(date '+%Y-%m-%d %H:%M:%S') - プロキシサーバーが終了しました (終了コード: $EXIT_CODE)" >> "$LOG_FILE"
    
    # Ctrl+Cで停止された場合は再起動しない
    if [ $EXIT_CODE -eq 130 ] || [ $EXIT_CODE -eq 143 ]; then
        echo -e "${YELLOW}プロキシサーバーが手動で停止されました${NC}"
        rm -f "$PID_FILE"
        exit 0
    fi
    
    echo -e "${YELLOW}プロキシサーバーが停止しました。5秒後に再起動します...${NC}"
    sleep 5
done