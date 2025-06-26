#!/bin/bash
# Claude-Projectのdocker-compose.ymlを修正するスクリプト

echo "🔧 Claude-Projectのdocker-compose.gateway.ymlを修正します..."

# 色の定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Claude-Projectディレクトリのパス
CLAUDE_PROJECT_DIR="${1:-$HOME/Claude-Project}"

if [ ! -d "$CLAUDE_PROJECT_DIR" ]; then
    echo -e "${RED}❌ エラー: Claude-Projectディレクトリが見つかりません: $CLAUDE_PROJECT_DIR${NC}"
    exit 1
fi

# スクリプトのディレクトリ
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${YELLOW}📂 対象: $CLAUDE_PROJECT_DIR/docker-compose.gateway.yml${NC}"

# バックアップを作成
if [ -f "$CLAUDE_PROJECT_DIR/docker-compose.gateway.yml" ]; then
    cp "$CLAUDE_PROJECT_DIR/docker-compose.gateway.yml" "$CLAUDE_PROJECT_DIR/docker-compose.gateway.yml.backup"
    echo -e "${GREEN}✓ バックアップを作成しました${NC}"
fi

# 修正版をコピー
cp "$SCRIPT_DIR/docker-compose.yml" "$CLAUDE_PROJECT_DIR/docker-compose.gateway.yml"

echo -e "${GREEN}✅ docker-compose.gateway.ymlを修正しました！${NC}"
echo ""
echo -e "${YELLOW}修正内容:${NC}"
echo "- extendsブロックを削除（拡張ファイルとして使用）"
echo "- 環境変数のサポートを追加"
echo "- コメントを整理"
echo ""
echo -e "${YELLOW}使い方:${NC}"
echo -e "${GREEN}docker compose -f docker-compose-base.yml -f docker-compose.gateway.yml up -d${NC}"