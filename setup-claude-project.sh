#!/bin/bash
# MCP GatewayをClaude-Projectに統合するワンライナースクリプト

echo "🚀 MCP GatewayをClaude-Projectに統合します..."

# 色の定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# スクリプトのディレクトリを取得（MCP Gatewayのルート）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTEGRATION_DIR="$SCRIPT_DIR/claude-project-integration"

# Claude-Projectディレクトリのパスを設定
CLAUDE_PROJECT_DIR="${1:-$HOME/Claude-Project}"

# 統合ディレクトリの存在確認
if [ ! -d "$INTEGRATION_DIR" ]; then
    echo -e "${RED}❌ エラー: 統合ディレクトリが見つかりません: $INTEGRATION_DIR${NC}"
    exit 1
fi

# Claude-Projectディレクトリの存在確認
if [ ! -d "$CLAUDE_PROJECT_DIR" ]; then
    echo -e "${RED}❌ エラー: Claude-Projectディレクトリが見つかりません: $CLAUDE_PROJECT_DIR${NC}"
    echo -e "${YELLOW}💡 ヒント: 引数でディレクトリを指定できます: $0 /path/to/Claude-Project${NC}"
    exit 1
fi

echo -e "${GREEN}📂 統合元: $INTEGRATION_DIR${NC}"
echo -e "${GREEN}📂 統合先: $CLAUDE_PROJECT_DIR${NC}"

# 統合ファイルをコピー
echo -e "\n${YELLOW}📋 統合ファイルをコピー中...${NC}"

# docker-compose.gateway.yml
cp "$INTEGRATION_DIR/docker-compose.yml" "$CLAUDE_PROJECT_DIR/docker-compose.gateway.yml"
echo "   ✓ docker-compose.gateway.yml"

# MCP設定ファイル
mkdir -p "$CLAUDE_PROJECT_DIR/docker-base/config"
cp "$INTEGRATION_DIR/mcp-servers-gateway.json" "$CLAUDE_PROJECT_DIR/docker-base/config/"
echo "   ✓ mcp-servers-gateway.json"

# セットアップスクリプト
cp "$INTEGRATION_DIR/setup-gateway.sh" "$CLAUDE_PROJECT_DIR/"
chmod +x "$CLAUDE_PROJECT_DIR/setup-gateway.sh"
echo "   ✓ setup-gateway.sh"

# README（既存のものがない場合のみ）
if [ ! -f "$CLAUDE_PROJECT_DIR/README-gateway.md" ]; then
    cp "$INTEGRATION_DIR/README.md" "$CLAUDE_PROJECT_DIR/README-gateway.md"
    echo "   ✓ README-gateway.md"
fi

echo -e "\n${GREEN}✅ 統合ファイルのコピーが完了しました！${NC}"

# セットアップスクリプトを実行するか確認
echo -e "\n${YELLOW}セットアップを続行しますか？ (y/N)${NC}"
read -r response

if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo -e "\n${GREEN}セットアップを続行します...${NC}"
    cd "$CLAUDE_PROJECT_DIR" || exit 1
    ./setup-gateway.sh
else
    echo -e "\n${YELLOW}📌 次のステップ:${NC}"
    echo -e "1. Claude-Projectディレクトリに移動:"
    echo -e "   ${GREEN}cd $CLAUDE_PROJECT_DIR${NC}"
    echo ""
    echo -e "2. セットアップスクリプトを実行:"
    echo -e "   ${GREEN}./setup-gateway.sh${NC}"
    echo ""
    echo -e "詳細は ${GREEN}$CLAUDE_PROJECT_DIR/README-gateway.md${NC} を参照してください。"
fi