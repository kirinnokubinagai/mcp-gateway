# MCP Gateway

複数のMCPサーバーを統合し、Dockerネットワーク経由でアクセス可能にするゲートウェイ

## 🚀 クイックスタート

```bash
# 起動
npm start

# 停止
npm stop

# ログ確認
npm run logs
```

- **Web UI**: http://localhost:3002
- **API**: http://localhost:3003
- **プロキシ**: ws://localhost:9999

## 🎯 できること

- **複数のMCPサーバーを統合**: `filesystem`、`github`、`obsidian`など複数のMCPサーバーを1つのインターフェースに
- **Docker間通信**: 他のDockerコンテナからMCPツールを実行
- **ツール名の自動変換**: `serverName.toolName`形式で各サーバーのツールを識別
- **ホストのMCPサーバー対応**: プロキシ経由でnpxコマンドなどを実行

## 🤖 Claude Desktopでの使用

### 1. mcp-serverに実行権限を付与
```bash
chmod +x /path/to/mcp-gateway/mcp-server
```

### 2. Claude Desktop設定に追加
`~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "/absolute/path/to/mcp-gateway/mcp-server"
    }
  }
}
```

※ mcp-serverスクリプトが`npm run mcp`を実行し、プロキシサーバーとDockerコンテナを起動します

## 🐳 他のDockerコンテナから使用

### 1. docker-compose.ymlに追加
```yaml
services:
  your-app:
    image: your-image
    networks:
      - mcp-gateway_default

networks:
  mcp-gateway_default:
    external: true
```

### 2. APIでツールを実行
```bash
# ツール一覧を取得
curl http://mcp-gateway-server:3003/api/tools

# ツールを実行
curl -X POST http://mcp-gateway-server:3003/api/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "filesystem.read_file",
    "arguments": {"path": "/path/to/file"}
  }'
```

## 📡 API エンドポイント

- `GET /api/tools` - 利用可能なツール一覧
- `POST /api/tools/call` - ツールを実行
- `GET /api/config` - 設定情報
- `GET /api/servers` - 接続中のMCPサーバー一覧




