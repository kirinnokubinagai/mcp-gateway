#!/bin/sh

# Webサーバーをバックグラウンドで起動
echo "Webサーバーを起動中..." >&2
bun run dist-server/web-server.js &

# 少し待機
sleep 2

# MCPサーバーを起動（フォアグラウンド）
echo "MCPサーバーを起動中..." >&2
exec bun run dist-server/index.js