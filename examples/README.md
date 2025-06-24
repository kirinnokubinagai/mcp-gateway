# MCP Gateway 使用例

このディレクトリには、他のDockerコンテナからMCP Gatewayを使用する例が含まれています。

## 📁 ディレクトリ構造

```
examples/
└── test-client/            # 接続テスト用クライアント
    ├── test-connection.js
    └── package.json
```

## 🚀 使い方

### 1. MCP Gatewayを起動

まず、MCP GatewayをDockerモードで起動します：

```bash
cd /path/to/mcp-gateway
./start-docker.sh
```

### 2. テストクライアントを実行

別のターミナルで：

```bash
cd /path/to/mcp-gateway
docker-compose -f docker-compose-example.yml up mcp-test-client
```

これにより、MCP Gatewayへの接続テストが実行されます。

### 3. Claude Codeコンテナを実行（仮想例）

```bash
docker-compose -f docker-compose-example.yml up claude-code-example
```

## 🔧 独自のコンテナからMCP Gatewayを使用

### docker-compose.ymlの設定

```yaml
version: '3.8'

services:
  your-app:
    image: your-app:latest
    environment:
      - MCP_GATEWAY_URL=http://mcp-gateway-server:3003
    networks:
      - mcp-gateway_default

networks:
  mcp-gateway_default:
    external: true
```

### APIエンドポイント

MCP Gatewayは以下のREST APIを提供します：

#### 設定の取得
```bash
GET http://mcp-gateway-server:3003/api/config
```

#### ツールリストの取得
```bash
GET http://mcp-gateway-server:3003/api/tools
```

#### ツールの実行
```bash
POST http://mcp-gateway-server:3003/api/tools/call
Content-Type: application/json

{
  "name": "gateway.list_servers",
  "arguments": {}
}
```

### Node.jsからの使用例

```javascript
import fetch from 'node-fetch';

const MCP_GATEWAY_URL = 'http://mcp-gateway-server:3003';

// ツールを実行
async function callTool(toolName, args = {}) {
  const response = await fetch(`${MCP_GATEWAY_URL}/api/tools/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: toolName,
      arguments: args
    })
  });
  
  return await response.json();
}

// 使用例
const result = await callTool('magic-mcp.search', { 
  query: 'hello world' 
});
console.log(result);
```

### Pythonからの使用例

```python
import requests

MCP_GATEWAY_URL = 'http://mcp-gateway-server:3003'

def call_tool(tool_name, args=None):
    response = requests.post(
        f'{MCP_GATEWAY_URL}/api/tools/call',
        json={
            'name': tool_name,
            'arguments': args or {}
        }
    )
    return response.json()

# 使用例
result = call_tool('gateway.list_servers')
print(result)
```

## 🔍 トラブルシューティング

### ネットワークエラー

```bash
# ネットワークが存在するか確認
docker network ls | grep mcp-gateway_default

# 存在しない場合は作成
docker network create mcp-gateway_default
```

### 接続できない場合

1. MCP Gatewayが起動していることを確認
2. コンテナが同じネットワークに接続されていることを確認
3. ホスト名が正しいことを確認（`mcp-gateway-server`）