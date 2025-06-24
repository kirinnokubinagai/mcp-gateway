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

**現在の制限事項**: DockerコンテナからホストのMCPサーバーへのアクセスは技術的な制約により利用できません。

### 代替方法

1. **Web UIを使用** - http://localhost:3002 でMCPサーバーの管理
2. **APIを使用** - http://localhost:3003 で他のアプリケーションから利用
3. **個別のMCPサーバーを直接Claude Desktopに設定**

```bash
# 例: Obsidianサーバーを直接追加
claude mcp add obsidian npx -y @modelcontextprotocol/server-obsidian "/path/to/vault"
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




