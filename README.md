# MCP Gateway

複数のMCPサーバーを統合管理するゲートウェイ

## 必要な環境

- Bun v1.0以上
- Docker & Docker Compose

## 使い方

### 1. プロキシサーバーを起動（別ターミナル）

```bash
bun install
bun run proxy
```

### 2. Docker Composeで起動

```bash
docker-compose up
```

### 3. Claude Desktopに登録

`~/Library/Application Support/Claude/claude_desktop_config.json` に追加：

```json
{
  "globalShortcut": "Shift+Alt+Space",
  "mcpServers": {
    "gateway": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "shared-mcp-gateway-server",
        "bun",
        "server/index.ts"
      ]
    }
  }
}
```

### 4. Claude Codeに登録

```bash
claude mcp add -s user gateway -- docker exec -i shared-mcp-gateway-server bun server/index.ts
```

## 他のDocker Composeと統合する場合

### 方法1: 拡張ファイルを使用

```bash
docker-compose -f docker-compose.yml -f docker-compose.mcp.yml up
```

### 方法2: integrate.tsを使用（自動統合）

```bash
./integrate.ts ./your-docker-compose.yml
```

## ポート

- プロキシ: ws://localhost:9999
- API: http://localhost:3003
- Web UI: http://localhost:3002

## MCPサーバー設定

`mcp-config.json` でMCPサーバーを管理