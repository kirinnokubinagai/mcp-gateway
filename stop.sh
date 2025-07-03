#!/bin/bash

# MCP Gateway 統合停止スクリプト

echo "🛑 MCP Gateway を停止します..."

# Docker コンテナを停止
echo "🐳 Docker コンテナを停止..."
docker-compose down

# プロキシサーバーを停止
echo "📡 プロキシサーバーを停止..."
npm run proxy:stop

echo "✅ MCP Gateway を停止しました"