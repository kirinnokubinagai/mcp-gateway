# MCP Gateway

複数のMCPサーバーを管理・統合するゲートウェイシステム

## 🚀 クイックスタート

```bash
# フォアグラウンドで起動（ログ表示）
./start.sh
# 停止: Ctrl+C

# デーモンモードで起動（バックグラウンド）
./start-daemon.sh
# 停止: ./stop-daemon.sh
```

- **UI**: http://localhost:3002
- **API**: http://localhost:3003

## 📝 使い方

### 1. 起動

```bash
./start.sh
```

### 2. 動作確認

```bash
# テストコンテナを実行
docker run --rm -it \
  --network mcp-gateway_default \
  node:20-slim \
  bash -c "
    npm install node-fetch
    cat > test.js << 'EOF'
import fetch from 'node-fetch';

// ツール一覧を取得
const res = await fetch('http://mcp-gateway-server:3003/api/tools');
const data = await res.json();
console.log('利用可能なツール:', data.tools.map(t => t.name));

// ツールを実行
const result = await fetch('http://mcp-gateway-server:3003/api/tools/call', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'gateway.list_servers',
    arguments: {}
  })
});
console.log('実行結果:', await result.json());
EOF
    node test.js
  "
```

### 3. ローカルから使用

```bash
# APIを直接叩く
curl -X POST http://localhost:3003/api/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name":"gateway.list_servers","arguments":{}}'

# Node.jsから
const response = await fetch('http://localhost:3003/api/tools/call', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'filesystem.read_file',
    arguments: { path: '/tmp/test.txt' }
  })
});

# Pythonから
import requests
response = requests.post('http://localhost:3003/api/tools/call',
    json={'name': 'gateway.list_servers', 'arguments': {}})
```

### 4. Dockerコンテナから使用

```yaml
# あなたのdocker-compose.yml
services:
  your-app:
    image: your-app
    environment:
      - MCP_GATEWAY_URL=http://mcp-gateway-server:3003
    networks:
      - mcp-gateway_default

networks:
  mcp-gateway_default:
    external: true
```

```javascript
// コンテナ内からはmcp-gateway-server:3003でアクセス
const response = await fetch('http://mcp-gateway-server:3003/api/tools/call', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'filesystem.read_file',
    arguments: { path: '/tmp/test.txt' }
  })
});
```

## ✨ 特徴

- **Docker専用設計**: 他のDockerコンテナから簡単にアクセス
- **ローカルMCPサーバー対応**: WebSocketプロキシ経由でホストのnpxコマンドも実行可能
- **REST API**: シンプルなHTTP APIで操作

## 🏗️ アーキテクチャ

```
ホスト
├── MCPプロキシサーバー (ws://localhost:9999)
│   └── ローカルMCPサーバー（npx等）を起動
└── Docker
    ├── mcp-gateway-server (3003)
    │   └── WebSocket → プロキシ経由でMCPサーバーに接続
    └── mcp-gateway-client (3002)
```

## 📋 要件

- Docker & Docker Compose
- Node.js（プロキシサーバー用）

## 🤖 Claude Desktop / Claude Code での使用方法

### ローカルからの使用

#### Claude Desktop

1. Claude Desktopの設定ファイルを開く：
```bash
# macOS
open ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Windows
# %APPDATA%\Claude\claude_desktop_config.json
```

2. 以下の設定を追加：
```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "--network", "mcp-gateway_default", "mcp-gateway-server", "node", "dist/index.js"],
      "env": {}
    }
  }
}
```

#### Claude Code (CLI)

```bash
# MCPサーバーとして追加
claude mcp add mcp-gateway \
  --command "docker" \
  --args "run" "--rm" "-i" "--network" "mcp-gateway_default" "mcp-gateway-server" "node" "dist/index.js"
```


### Dockerコンテナからの使用

#### 他のDockerコンテナ内でClaude Desktop/Codeを使う

1. Dockerコンテナのclaude_desktop_config.jsonを編集：
```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "node",
      "args": ["/app/gateway-client.js"],
      "env": {
        "MCP_GATEWAY_URL": "http://mcp-gateway-server:3003"
      }
    }
  }
}
```

2. gateway-client.jsを作成（MCPプロトコルブリッジ）：
```javascript
// Dockerコンテナ内でMCP Gatewayへのブリッジとして動作
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const fetch = require('node-fetch');

const server = new Server(
  { name: 'mcp-gateway-client', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler('tools/list', async () => {
  const res = await fetch(process.env.MCP_GATEWAY_URL + '/api/tools');
  const data = await res.json();
  return { tools: data.tools };
});

server.setRequestHandler('tools/call', async (request) => {
  const res = await fetch(process.env.MCP_GATEWAY_URL + '/api/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.params)
  });
  return await res.json();
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error('Gateway client connected');
});
```

3. docker-compose.ymlに追加：
```yaml
services:
  claude-container:
    image: your-claude-app
    environment:
      - MCP_GATEWAY_URL=http://mcp-gateway-server:3003
    networks:
      - mcp-gateway_default
    volumes:
      - ./gateway-client.js:/app/gateway-client.js
```

### 使用例

Claude DesktopやClaude Codeで以下のようなツールが使えるようになります：

```
# 登録されているMCPサーバー一覧
gateway.list_servers

# ファイルシステム操作（filesystem MCPサーバー経由）
filesystem.read_file
filesystem.write_file
filesystem.list_directory

# 他のMCPサーバーのツール
[サーバー名].[ツール名]
```

## 🔧 トラブルシューティング

```bash
# ログ確認
docker-compose logs -f mcp-gateway-server
tail -f proxy.log

# ポート確認
lsof -i :3002  # UI
lsof -i :3003  # API
lsof -i :9999  # プロキシ

# 再起動
./start.sh
```

