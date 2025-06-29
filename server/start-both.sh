#!/bin/sh

# APIサーバーをバックグラウンドで起動
cd /app/server && bun run api-server.ts &

# MCPサーバー（stdioモード）をフォアグラウンドで起動
cd /app && exec bun server/index.ts