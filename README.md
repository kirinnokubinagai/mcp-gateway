# MCP Gateway

複数のMCPサーバーを統合し、Dockerネットワーク経由でアクセス可能にするゲートウェイ

## 🎯 できること

- **複数のMCPサーバーを統合**: `filesystem`、`github`、`obsidian`など複数のMCPサーバーを1つのインターフェースに
- **Docker間通信**: 他のDockerコンテナからHTTP API経由でMCPツールを実行
- **ツール名の自動変換**: `serverName.toolName`形式で各サーバーのツールを識別
- **WebSocketプロキシ対応**: ホストのMCPサーバーにもアクセス可能

## 🤖 Claude Desktopでの使用

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "/path/to/mcp-gateway/mcp-server"
    }
  }
}
```

## 🏗️ アーキテクチャ

MCP Gatewayは3つのコンポーネントで構成されています：

1. **プロキシサーバー** (ws://localhost:9999)
   - ホストで動作（mcp-proxy-server/server.js）
   - DockerコンテナからホストのMCPサーバーへのアクセスを仲介
   - WebSocket通信でstdin/stdoutをトンネリング

2. **mcp-gateway-server** (http://localhost:3003)
   - MCPサーバー本体（Dockerコンテナ）
   - MCPプロトコル（stdio）とHTTP APIの両方を提供
   - 複数のMCPサーバーを統合

3. **mcp-gateway-client** (http://localhost:3002)
   - Web UI（Dockerコンテナ）
   - MCPサーバーの登録・管理画面

## 🐳 他のDockerコンテナ内のClaude Codeから使用

### 前提条件
MCP Gatewayの3つのコンポーネントがすべて起動している必要があります：
```bash
npm run gateway  # プロキシサーバー + 2つのDockerコンテナを起動
```

### 完全なdocker-compose.yml設定例

```yaml
version: '3.8'

services:
  # あなたのClaude Codeコンテナ
  claude-dev:
    image: your-claude-code-image
    volumes:
      - ./your-project:/workspace
      - /var/run/docker.sock:/var/run/docker.sock  # docker execに必要
    networks:
      - mcp-gateway_default  # MCP Gatewayと同じネットワーク

networks:
  mcp-gateway_default:
    external: true  # MCP Gatewayが作成したネットワークを使用
```

### Claude Codeコンテナからの接続

```bash
# claude-devコンテナ内で実行
claude mcp add gateway \
  docker exec -i mcp-gateway-server node dist/index.js
```

これにより、Claude Code内で`gateway.list_servers`や`filesystem.read_file`などのツールが使用可能になります。

### MCP Gatewayの管理

MCP Gatewayで使用するMCPサーバーの登録・管理は以下の方法で行います：

1. **Web UI**: http://localhost:3002 にアクセス（mcp-gateway-clientが提供）
2. **mcp-config.json**: 直接編集して設定
3. **REST API**: `POST /api/servers`で動的に追加

## 📡 API エンドポイント

- `GET /api/tools` - 利用可能なツール一覧
- `POST /api/tools/call` - ツールを実行
- `GET /api/config` - 設定情報
- `GET /api/servers` - 接続中のMCPサーバー一覧

## 🛠️ 利用可能なツール例

```
# ゲートウェイ管理
gateway.list_servers          # 接続されたMCPサーバー一覧

# ファイルシステム（filesystem MCPサーバー経由）
filesystem.read_file          # ファイル読み取り
filesystem.write_file         # ファイル書き込み
filesystem.list_directory     # ディレクトリ一覧

# GitHub（github MCPサーバー経由）
github.create_issue           # Issue作成
github.create_pull_request    # PR作成
github.search_repositories    # リポジトリ検索

# その他のMCPサーバー
[サーバー名].[ツール名]      # 各MCPサーバーのツール
```

## 📋 npmコマンド一覧

```bash
# ゲートウェイ関連
npm run gateway       # プロキシとDockerを起動（Web UI用）
npm run gateway:stop  # すべて停止
npm run docker:logs   # ログを表示
npm run docker:down   # Dockerコンテナを停止

# Claude Desktop用
npm run mcp          # MCPサーバーとして起動（stdio接続）

# 開発用
npm run dev          # 開発モード（サーバーとクライアント）
npm run build        # ビルド
npm run build:server # サーバーのみビルド
npm run lint         # Lintチェック

# その他
npm run proxy        # プロキシサーバーのみ起動
npm run docker:up    # Dockerコンテナのみ起動
```

## 🔧 トラブルシューティング

```bash
# ログ確認
npm run docker:logs
tail -f proxy.log

# ポート確認
lsof -i :3002  # UI
lsof -i :3003  # API
lsof -i :9999  # プロキシ

# 再起動
npm run gateway:stop
npm run gateway
```

