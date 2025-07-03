#!/bin/sh

# APIサーバーをバックグラウンドで起動
cd /app && bun server/api-server.ts &

# MCPサーバー（stdioモード）をフォアグラウンドで起動
cd /app && exec bun server/index.ts