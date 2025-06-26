#!/bin/bash

# MCP Gateway自動セットアップスクリプト
# Claude Codeコンテナ内でMCP Gatewayを自動的に設定

# カラー定義
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}${BOLD}======================================${NC}"
echo -e "${BLUE}${BOLD}    MCP Gateway Auto Setup${NC}"
echo -e "${BLUE}${BOLD}======================================${NC}"
echo ""

# プロジェクト名を環境変数から取得
PROJECT_NAME="${PROJECT_NAME:-default}"

# 既存のgatewayをチェック
echo -e "${BLUE}[INFO]${NC} 既存のMCP Gateway設定を確認中..."
if claude mcp list 2>/dev/null | grep -q "gateway"; then
    echo -e "${YELLOW}[INFO]${NC} MCP Gatewayは既に設定されています"
    
    # 既存のgatewayを削除（更新のため）
    echo -e "${BLUE}[INFO]${NC} 既存の設定を更新します..."
    claude mcp remove gateway >/dev/null 2>&1
fi

# MCP Gatewayを追加
echo -e "${BLUE}[INFO]${NC} MCP Gatewayを追加中..."

# Docker execモードで追加（プロジェクト名を使用）
cmd="claude mcp add gateway -- docker exec -i mcp-gateway-server-${PROJECT_NAME} bun server/index.ts"

echo -e "${BLUE}[DEBUG]${NC} 実行コマンド: $cmd"
eval "$cmd"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} MCP Gatewayを追加しました"
    
    # 設定を永続化（userスコープ）
    echo -e "${BLUE}[INFO]${NC} 設定を永続化中..."
    claude mcp add -s user gateway -- docker exec -i mcp-gateway-server-${PROJECT_NAME} bun server/index.ts >/dev/null 2>&1
    
    echo ""
    echo -e "${GREEN}[SUCCESS]${NC} MCP Gateway設定が完了しました！"
    echo ""
    echo -e "${BLUE}[INFO]${NC} 利用可能なMCPツール:"
    echo "  - Obsidian: mcp__obsidian__*"
    echo "  - GitHub: mcp__github__*"
    echo "  - Context7: mcp__context7__*"
    echo "  - Supabase: mcp__supabase__*"
    echo "  - Stripe: mcp__stripe__*"
    echo "  - LINE Bot: mcp__line-bot__*"
    echo "  - Magic MCP: mcp__magic-mcp__*"
    echo "  - Playwright: mcp__playwrights__*"
    echo ""
else
    echo -e "${RED}[ERROR]${NC} MCP Gatewayの追加に失敗しました"
    echo -e "${YELLOW}[INFO]${NC} HTTPトランスポートモードを試行中..."
    
    # HTTPトランスポートモードで再試行
    cmd="claude mcp add -t http gateway http://mcp-gateway-server:3003"
    echo -e "${BLUE}[DEBUG]${NC} 実行コマンド: $cmd"
    eval "$cmd"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[SUCCESS]${NC} MCP Gateway (HTTP)を追加しました"
        
        # HTTPモードも永続化
        claude mcp add -s user -t http gateway http://mcp-gateway-server:3003 >/dev/null 2>&1
    else
        echo -e "${RED}[ERROR]${NC} MCP Gatewayの追加に失敗しました"
        exit 1
    fi
fi

# 設定の確認
echo -e "${BLUE}[INFO]${NC} 現在のMCPサーバー設定:"
claude mcp list

echo ""
echo -e "${GREEN}${BOLD}======================================${NC}"
echo -e "${GREEN}${BOLD}    Setup Complete!${NC}"
echo -e "${GREEN}${BOLD}======================================${NC}"
echo ""