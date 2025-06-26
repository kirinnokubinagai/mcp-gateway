# MCP GatewayをClaude-Projectに統合する方法

## 前提条件
- Claude-Projectが既にセットアップされている
- Bunがインストールされている
- Dockerが起動している

## 統合手順

### 1. Claude-Projectディレクトリに移動
```bash
cd ~/Claude-Project
```

### 2. Git SubmoduleとしてMCP Gatewayを追加
```bash
git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway
git submodule update --init --recursive
```

### 3. 依存関係をインストール
```bash
cd mcp-gateway
bun install
cd ..
```

### 4. プロキシサーバーを起動（別ターミナルで）
```bash
cd mcp-gateway
bun run proxy
```
※ ポート9999で起動します

### 5. プロジェクト作成時の使用方法

#### オプション1: Docker Compose拡張ファイルを使用（推奨）
```bash
docker compose -f docker-compose-base.yml -f mcp-gateway/claude-project-integration/docker-compose.yml up -d
```

#### オプション2: create-project.shを修正（Claude-Projectを変更する場合）
create-project.shの該当箇所を以下のように修正：

```bash
# MCP Gatewayが存在する場合は統合ファイルも使用
if [ -f "$CLAUDE_PROJECT_DIR/mcp-gateway/claude-project-integration/docker-compose.yml" ]; then
    docker compose -f "$CLAUDE_PROJECT_DIR/docker-compose-base.yml" \
                   -f "$CLAUDE_PROJECT_DIR/mcp-gateway/claude-project-integration/docker-compose.yml" \
                   --project-directory "$PROJECT_DIR" up -d
else
    docker compose -f "$CLAUDE_PROJECT_DIR/docker-compose-base.yml" \
                   --project-directory "$PROJECT_DIR" up -d
fi
```

## 提供されるサービス

統合により以下のサービスが追加されます：

1. **mcp-proxy-check** - プロキシサーバーの起動確認
2. **mcp-gateway-server** - MCP Gateway APIサーバー（ポート3003）
3. **mcp-gateway-client** - MCP管理用Web UI（ポート3002）

## アクセス先

- **MCP管理用Web UI**: http://localhost:3002
- **MCP Gateway API**: http://localhost:3003

## 注意事項

1. **プロキシサーバーは必須**
   - Gateway機能を使用するには、必ずプロキシサーバーを起動しておく必要があります
   - `cd mcp-gateway && bun run proxy`

2. **ネットワーク設定**
   - Claude-Projectのネットワーク設定に合わせて調整が必要な場合があります
   - デフォルトでは`app-network`を使用

3. **MCP設定の自動切り替え**
   - コンテナ内の`~/.config/claude/mcp-servers.json`が自動的にGateway用に置き換わります
   - 元の設定は`.backup`として保存されます