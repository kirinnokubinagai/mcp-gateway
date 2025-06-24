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

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "/path/to/mcp-gateway/mcp-server"
    }
  }
}
```

## 🐳 他のDockerコンテナから使用

MCP Gatewayは`http://mcp-gateway-server:3003`でAPIを提供しています。
同じDockerネットワーク内の他のコンテナからHTTP経由でツールを実行できます。

## 📡 API エンドポイント

- `GET /api/tools` - 利用可能なツール一覧
- `POST /api/tools/call` - ツールを実行
- `GET /api/config` - 設定情報
- `GET /api/servers` - 接続中のMCPサーバー一覧




