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

## 🐳 他のDockerコンテナ内のClaude Codeから使用

### 前提条件
先に`npm run gateway`でMCP Gatewayを起動しておく必要があります。

### 方法1: Dockerソケットをマウント
```yaml
# docker-compose.yml
services:
  claude-dev:
    image: your-claude-code-image
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - mcp-gateway_default
```

```bash
# コンテナ内で実行
claude mcp add gateway \
  docker exec -i mcp-gateway-server node dist/index.js
```

### 方法2: ブリッジスクリプト経由
コンテナ内に以下のスクリプトを配置：

```javascript
// /app/mcp-gateway-bridge.js
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  { name: 'mcp-gateway', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler('tools/list', async () => {
  const res = await fetch('http://mcp-gateway-server:3003/api/tools');
  const data = await res.json();
  return { tools: data.tools };
});

server.setRequestHandler('tools/call', async (request) => {
  const res = await fetch('http://mcp-gateway-server:3003/api/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.params)
  });
  return await res.json();
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

```bash
# コンテナ内で実行
claude mcp add gateway node /app/mcp-gateway-bridge.js
```

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

