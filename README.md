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

`~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/mcp-gateway"
    }
  }
}
```

## 🐳 他のDockerコンテナから使用

### docker-compose.ymlに追加
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




