# Claude-ProjectへのMCP Gateway統合ガイド

このガイドでは、Claude-ProjectにMCP Gatewayを統合する手順を説明します。

## 🚀 クイックスタート

### 自動セットアップ（推奨）

```bash
# 1. 統合ファイルをClaude-Projectにコピー
cp -r /path/to/mcp-gateway/claude-project-integration/* ~/Claude-Project/

# 2. セットアップスクリプトを実行
cd ~/Claude-Project
./setup-gateway.sh
```

### 手動セットアップ

#### 1. MCP GatewayをSubmoduleとして追加

```bash
cd ~/Claude-Project
git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway
cd mcp-gateway && bun install && cd ..
```

#### 2. 必要なファイルをコピー

```bash
# Docker Compose拡張ファイル
cp /path/to/mcp-gateway/claude-project-integration/docker-compose.yml ~/Claude-Project/docker-compose.gateway.yml

# MCP Gateway用設定
cp /path/to/mcp-gateway/claude-project-integration/mcp-servers-gateway.json ~/Claude-Project/docker-base/config/

# 起動スクリプト
cp /path/to/mcp-gateway/claude-project-integration/*.sh ~/Claude-Project/
chmod +x ~/Claude-Project/*.sh
```

## 📖 使い方

### 1. プロキシサーバーの起動（必須）

新しいターミナルを開いて実行：

```bash
cd ~/Claude-Project
./start-gateway-proxy.sh
```

または手動で：

```bash
cd ~/Claude-Project/mcp-gateway
bun run proxy
```

### 2. Docker環境の起動

別のターミナルで実行：

```bash
cd ~/Claude-Project

# 方法1: 統合起動スクリプト（推奨）
./start-with-gateway.sh

# 方法2: Docker Composeを直接使用
docker compose -f docker-compose-base.yml -f docker-compose.gateway.yml up -d
```

### 3. コンテナ内での設定

```bash
# コンテナに接続
docker exec -it claude-code-${PROJECT_NAME} bash

# MCP設定をGateway用に切り替え
setup-mcp-gateway

# Claude CLIを起動して確認
ccd
```

## 🔧 設定ファイル

### docker-compose.gateway.yml

MCP Gateway統合用のDocker Compose拡張ファイル。以下のサービスを追加：

- `mcp-proxy-check`: プロキシサーバーの起動確認
- `mcp-gateway-server`: MCP Gateway APIサーバー
- `mcp-gateway-client`: MCP管理用Web UI

### mcp-servers-gateway.json

Claude Code用のMCP設定。すべてのMCPサーバーへの接続をGateway経由に統一：

```json
{
  "mcpServers": {
    "gateway": {
      "transport": "http",
      "url": "http://mcp-gateway-server:3003"
    }
  }
}
```

## 📌 アクセス情報

- **MCP管理用Web UI**: http://localhost:3002
- **MCP Gateway API**: http://localhost:3003

## 🎯 利用可能なMCPツール

Gateway経由で以下のMCPサーバーのツールが使用可能：

- **Obsidian**: ノート管理
- **GitHub**: リポジトリ操作
- **Supabase**: データベース管理
- **Context7**: ドキュメント検索
- **LINE Bot**: メッセージ送信
- **Stripe**: 決済処理
- **Playwright**: ブラウザ自動化
- **Magic MCP**: UI生成

各ツールは `serverName_toolName` 形式で呼び出されます。

## ⚠️ 注意事項

1. **プロキシサーバーは必須**: Gateway機能を使用するには、必ずプロキシサーバーを起動しておく必要があります

2. **ポート競合**: 以下のポートが使用されます
   - 9999: プロキシサーバー
   - 3002: MCP管理用Web UI
   - 3003: Gateway API

3. **元の設定に戻す**: Gateway統合を解除する場合
   ```bash
   # コンテナ内で実行
   cp ~/.config/claude/mcp-servers.json.backup ~/.config/claude/mcp-servers.json
   ```

## 🔄 更新方法

```bash
cd ~/Claude-Project/mcp-gateway
git pull
bun install
docker compose -f docker-compose-base.yml -f docker-compose.gateway.yml build
```

## 🛠️ トラブルシューティング

### プロキシサーバーが起動しない

```bash
# ポート9999が使用中でないか確認
lsof -i :9999

# Bunがインストールされているか確認
bun --version
```

### MCPツールが表示されない

1. プロキシサーバーが起動しているか確認
2. `mcp-config.json`でMCPサーバーが有効になっているか確認
3. 環境変数（APIキーなど）が設定されているか確認

### コンテナが起動しない

```bash
# ログを確認
docker compose -f docker-compose-base.yml -f docker-compose.gateway.yml logs

# 個別のサービスのログ
docker logs mcp-gateway-server
```