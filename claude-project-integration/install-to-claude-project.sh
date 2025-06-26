#!/bin/bash

# MCP Gateway効率化機能をClaude-Projectに統合するスクリプト

# カラー定義
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}MCP Gateway効率化機能のインストール${NC}"
echo ""

# Claude-Projectのパスを確認
CLAUDE_PROJECT_DIR="${1:-$HOME/Claude-Project}"

if [ ! -d "$CLAUDE_PROJECT_DIR" ]; then
    echo -e "${RED}エラー: Claude-Projectが見つかりません: $CLAUDE_PROJECT_DIR${NC}"
    echo "使用方法: $0 [Claude-Projectパス]"
    exit 1
fi

# 現在のディレクトリを保存
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}1. 自動セットアップスクリプトをコピー${NC}"
mkdir -p "$CLAUDE_PROJECT_DIR/docker-base/scripts/mcp-gateway"
cp "$SCRIPT_DIR/setup-mcp-gateway.sh" "$CLAUDE_PROJECT_DIR/docker-base/scripts/mcp-gateway/"
cp "$SCRIPT_DIR/mcp-gateway-alias.sh" "$CLAUDE_PROJECT_DIR/docker-base/scripts/mcp-gateway/"

echo -e "${BLUE}2. DockerfileBaseを更新${NC}"
# DockerfileBaseのバックアップを作成
cp "$CLAUDE_PROJECT_DIR/DockerfileBase" "$CLAUDE_PROJECT_DIR/DockerfileBase.backup"

# DockerfileBaseに追加する内容を作成
cat > /tmp/dockerfile_addition.txt << 'EOF'

# MCP Gateway効率化機能を追加
COPY docker-base/scripts/mcp-gateway /opt/claude-system/mcp-gateway
RUN chmod +x /opt/claude-system/mcp-gateway/*.sh

# bashrcにエイリアスを追加
RUN echo "# MCP Gateway aliases" >> /home/developer/.bashrc && \
    echo "source /opt/claude-system/mcp-gateway/mcp-gateway-alias.sh" >> /home/developer/.bashrc

EOF

# DockerfileBaseの最後に追加（CMD行の前）
if grep -q "^CMD" "$CLAUDE_PROJECT_DIR/DockerfileBase"; then
    # CMD行がある場合は、その前に挿入
    awk '/^CMD/ && !done {print ""; system("cat /tmp/dockerfile_addition.txt"); done=1} 1' \
        "$CLAUDE_PROJECT_DIR/DockerfileBase" > "$CLAUDE_PROJECT_DIR/DockerfileBase.new"
else
    # CMD行がない場合は、ファイルの最後に追加
    cat "$CLAUDE_PROJECT_DIR/DockerfileBase" /tmp/dockerfile_addition.txt > "$CLAUDE_PROJECT_DIR/DockerfileBase.new"
fi

mv "$CLAUDE_PROJECT_DIR/DockerfileBase.new" "$CLAUDE_PROJECT_DIR/DockerfileBase"

echo -e "${BLUE}3. setup-mcp.shを更新${NC}"
# setup-mcp.shのバックアップを作成
cp "$CLAUDE_PROJECT_DIR/docker-base/scripts/setup-mcp.sh" "$CLAUDE_PROJECT_DIR/docker-base/scripts/setup-mcp.sh.backup"

# setup-mcp.shの最後にGateway設定を追加
cat >> "$CLAUDE_PROJECT_DIR/docker-base/scripts/setup-mcp.sh" << 'EOF'

# MCP Gatewayの自動設定
echo ""
echo -e "${BLUE}[INFO]${NC} MCP Gatewayの自動設定を確認中..."

# mcp-gateway-serverコンテナが起動しているか確認
if docker ps --format "{{.Names}}" | grep -q "mcp-gateway-server-${PROJECT_NAME}"; then
    echo -e "${GREEN}[INFO]${NC} MCP Gatewayサーバーが検出されました"
    
    # 自動セットアップスクリプトを実行
    if [ -f "/opt/claude-system/mcp-gateway/setup-mcp-gateway.sh" ]; then
        echo -e "${BLUE}[INFO]${NC} MCP Gatewayを自動設定中..."
        bash /opt/claude-system/mcp-gateway/setup-mcp-gateway.sh
    fi
else
    echo -e "${YELLOW}[INFO]${NC} MCP Gatewayサーバーが検出されませんでした"
    echo -e "${YELLOW}[INFO]${NC} 手動で 'mcpg' コマンドを実行してください"
fi
EOF

echo -e "${BLUE}4. README.mdを作成${NC}"
cat > "$SCRIPT_DIR/EFFICIENCY_GUIDE.md" << 'EOF'
# MCP Gateway効率化ガイド

## 🚀 新機能

MCP Gatewayの統合が大幅に効率化されました！

### 自動セットアップ

Claude Codeコンテナ起動時に、MCP Gatewayが自動的に検出・設定されるようになりました。

### 便利なエイリアス

以下のコマンドが利用可能です：

| コマンド | エイリアス | 説明 |
|---------|-----------|------|
| `mcp-add-gateway` | `mcpg` | MCP Gatewayを自動設定 |
| `mcp-gateway` | - | Docker exec経由でGatewayを追加 |
| `mcp-gateway-http` | `mcpgh` | HTTPトランスポートでGatewayを追加 |
| `mcp-list` | - | 設定済みMCPサーバーを表示 |
| `mcp-remove <name>` | - | MCPサーバーを削除 |
| `mcp-help` | - | ヘルプを表示 |

### 使用方法

1. **自動設定（推奨）**
   ```bash
   # コンテナ起動時に自動実行されます
   # 手動実行する場合：
   mcpg
   ```

2. **手動設定（必要な場合）**
   ```bash
   # Docker exec経由
   mcp-gateway
   
   # HTTPトランスポート経由
   mcp-gateway-http
   ```

3. **確認**
   ```bash
   mcp-list
   ```

### トラブルシューティング

- **自動設定が動作しない場合**
  - MCPプロキシサーバーが起動していることを確認
  - `cd mcp-gateway && bun run proxy`

- **コンテナ名が異なる場合**
  - 環境変数 `PROJECT_NAME` が正しく設定されているか確認

- **HTTPモードを使用したい場合**
  - `mcpgh` または `mcp-gateway-http` を実行

## 永続化

設定は自動的にuserスコープで保存され、コンテナを再起動しても維持されます。
EOF

echo ""
echo -e "${GREEN}✅ インストールが完了しました！${NC}"
echo ""
echo -e "${YELLOW}次のステップ:${NC}"
echo "1. Dockerイメージを再ビルド:"
echo "   cd $CLAUDE_PROJECT_DIR"
echo "   docker compose -f docker-compose-base.yml build"
echo ""
echo "2. プロジェクトを再起動:"
echo "   ./create-project.sh <プロジェクト名>"
echo ""
echo "3. コンテナ内で確認:"
echo "   docker exec -it claude-code-<プロジェクト名> bash"
echo "   mcp-help"
echo ""
echo -e "${BLUE}効率化機能の詳細は EFFICIENCY_GUIDE.md を参照してください${NC}"