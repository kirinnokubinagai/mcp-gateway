# MCP Gateway

複数のMCPサーバーを統合し、Dockerネットワーク経由でアクセス可能にするゲートウェイ（Bun専用）

## 📋 必要な環境

### 必須要件
- **Bun**: v1.0以上（プロキシサーバー用、必須）
- **Node.js**: v18以上（watch-config.js用、必須）
- **Docker**: v20以上（Web UI使用時）
- **Docker Compose**: v2以上（Web UI使用時）

### 推奨環境
- **OS**: macOS、Linux、Windows (WSL2)
- **メモリ**: 4GB以上の空きRAM
- **ストレージ**: 1GB以上の空き容量

### Bunのインストール

```bash
# macOS、Linux、WSL
curl -fsSL https://bun.sh/install | bash

# 確認
bun --version
```

## 🎯 特徴

- **複数のMCPサーバーを統合**: `obsidian`、`context7`、`github`など複数のMCPサーバーを1つのインターフェースに
- **Docker間通信**: 他のDockerコンテナからMCPツールを実行
- **MCP管理用Web UI**: ブラウザから簡単にMCPサーバーを管理
- **リアルタイム更新**: WebSocket経由でステータスをリアルタイム更新
- **ツール名の自動変換**: `serverName_toolName`形式で各サーバーのツールを識別

### ⚠️ 重要な注意事項
Web UI（http://localhost:3002）でMCPサーバーが「エラー」と表示されるのは正常な動作です。MCPサーバーはClaude Codeから接続された時に初めて起動されます。

#### 状態の説明
- **無効**: サーバーが無効化されている
- **接続中...** (青色): サーバーへの接続を試行中
- **接続済み** (緑色): サーバーに正常に接続されている
- **エラー** (赤色): 接続に失敗した（詳細なエラー原因が表示されます）

## 🚀 クイックスタート

### 統合起動（推奨）
```bash
# プロキシサーバーとDockerコンテナを一括起動
npm start
# または
./start.sh

# 一括停止
npm stop
# または
./stop.sh
```

### 個別起動
```bash
# プロキシサーバーを起動（基本）
bun run start
```

### 📌 動作ポート

- **プロキシサーバー**: ws://localhost:9999
- **APIサーバー**: http://localhost:3003
- **MCP管理用Web UI**: http://localhost:3002

## 🤖 Claude Desktopでの使用

### Claude Desktopへの設定

Claude Desktopの設定ファイル（`~/Library/Application Support/Claude/claude_desktop_config.json`）に以下を追加：

```json
{
  "mcpServers": {
    "gateway": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "shared-mcp-gateway-server",
        "bun",
        "server/index.ts"
      ],
      "cwd": "/path/to/mcp-gateway/mcp-proxy-server"
    }
  }
}
```

**重要**: 
- Gateway MCPを使用する場合、個別のMCPサーバー（obsidian、context7など）の設定は削除してください

## 🤖 Claude Codeでの使用

Claude CodeでMCP Gatewayを使用するには、以下の方法があります：

### 方法1: ローカル実行（推奨）

```bash
# 1. プロキシサーバーを起動（別ターミナル）
cd /path/to/mcp-gateway
bun run proxy

# 2. Claude Codeに追加
claude mcp add gateway /path/to/mcp-gateway/start-mcp-for-claude.sh
```

### 方法2: Docker経由での実行

```bash
# 1. Docker Composeを起動
cd /path/to/mcp-gateway
bun start

# 2. Claude Codeに追加（専用コンテナを使用）
claude mcp add gateway -- docker exec -i shared-mcp-gateway-server bun server/index.ts
```

注意**: 
- Docker経由で実行する場合、プロキシサーバーが起動している必要があります
- `--`を忘れずに付けてください（`claude mcp add`のオプションとコマンドを区別するため）

## 🤖 Claude Code（Docker版）でのMCP追加方法

### MCPサーバーの追加コマンド

Claude CodeのDockerコンテナ内で、MCP Gatewayを追加するには：

#### 方法1: Docker exec（推奨）

同じDockerネットワーク内のコンテナに接続：

```bash
# プロキシサーバーとmcp-gatewayのdockerを起動
cd path/to/mcp-gateway
bun start

# 統合しようとしているdocker-compose.ymlと.envに設定を書き足す
path/to/mcp-gateway/integrate.sh docker-compose.yml

# 統合したdocker-compose.ymlを起動 ※ 必要に応じて読み替えてください
docker compose build
docker compose up -d

# 統合先のコンテナのclaude codeにMCP Gatewayコンテナに接続
claude mcp add gateway -- docker exec -i shared-mcp-gateway-server bun server/index.ts
```

### 設定の確認

```bash
# 追加されたMCPサーバーを確認
claude mcp list

# 特定のサーバーの詳細を表示
claude mcp get gateway

# サーバーを削除する場合
claude mcp remove gateway
```

### 🔧 mcp-config.jsonの設定

`mcp-gateway/mcp-config.json`でMCPサーバーを設定：

```json
{
  "servers": {
    "obsidian": {
      "command": "/path/to/obsidian-mcp-server",
      "args": [],
      "env": {},
      "enabled": true
    },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token"
      },
      "enabled": true
    }
  }
}
```

## 📝 設定ファイル (mcp-config.json)

```json
{
  "servers": {
    "obsidian": {
      "command": "/path/to/obsidian-mcp-server",
      "args": [],
      "env": {
        "OBSIDIAN_API_KEY": "your-api-key"
      },
      "enabled": true // 有効無効の切り替えで使用
    },
    "context7": {
      "command": "npx",
      "args": ["@upstash/context7-mcp"],
      "env": {},
      "enabled": true // 有効無効の切り替えで使用
    }
  }
}
```

## 🎯 注意事項

### プロキシサーバーはBun専用
プロキシサーバー（mcp-proxy-server）はBunランタイムに特化して最適化されています。watch-config.jsはNode.jsで動作します。

### 環境変数
以下の環境変数を`.env`ファイルで設定できます：

```bash
# ポート設定
MCP_PROXY_PORT=9999
MCP_API_PORT=3003
MCP_WEB_PORT=3002
```

## 🔧 開発

### スクリプト

```bash
# プロキシサーバー起動
bun run proxy

# プロキシサーバー起動（設定ファイル監視付き）
bun run proxy:watch

# クリーンアップ
bun run clean

# WebSocket接続の安定性テスト
npm run test:websocket
```

## 🛡️ WebSocket接続の安定性向上

### 実装された改善点

1. **自動再接続機能**
   - 指数バックオフアルゴリズムによる再接続
   - 最大5回まで自動的に再接続を試行
   - 再接続間隔: 1秒から最大30秒まで段階的に増加

2. **Ping/Pongによる健全性チェック**
   - 30秒ごとに自動的にPingを送信
   - 接続の生存確認とレイテンシー測定
   - 応答がない場合は自動的に再接続

3. **接続プール管理**
   - 各接続に一意のIDを割り当て
   - 5分間アクティビティがない接続は自動クリーンアップ
   - 接続状態の詳細な追跡とログ

4. **詳細なエラーハンドリング**
   - エラータイプごとの適切な処理
   - ユーザーフレンドリーなエラーメッセージ
   - 自動復旧戦略の実装

### 設定可能なパラメータ

WebSocketTransportのオプション:
- `reconnectAttempts`: 再接続試行回数（デフォルト: 5）
- `reconnectDelay`: 初期再接続遅延（デフォルト: 1000ms）
- `maxReconnectDelay`: 最大再接続遅延（デフォルト: 30000ms）
- `pingInterval`: Ping送信間隔（デフォルト: 30000ms）

## 📚 アーキテクチャ


### Claude Desktop使用時（MCP管理用Web UI付き）

```
┌─────────────────┐
│ Claude Desktop  │
└────────┬────────┘
         │ stdio
         ▼
┌─────────────────┐                    ┌──────────────┐
│  Gateway MCP    │                    │  MCP管理用    │
│     Server      │      HTTP API      │    Web UI    │
│                 │◀───localhost:3003──│  localhost   │
└────────┬────────┘                    │    :3002     │
                                       └──────────────┘
         │
    WebSocket
 ws://localhost:9999
         │
┌────────▼────────┐
│  MCP Proxy      │
│    Server       │
└────────┬────────┘
         │
    ┌────┴────┐
    │  spawn  │
┌───▼───┐ ┌───▼───┐
│  MCP  │ │  MCP  │
│Server1│ │Server2│ ・・・
└───────┘ └───────┘
```

### DockerでClaude Code使用時

```
┌─────────────────────┐  ┌─────────────────────┐            ┌──────────────┐
│  Claude Code        │  │  MCP Gateway        │            │  MCP管理用    │
│  Container          │  │  Container          │            │    Web UI    │
│                     │  │                     │            │  localhost   │
│  ┌───────────────┐  │  │  ┌───────────────┐  │            │    :3002     │
│  │  Claude Code  │──┼──┼─▶│ Gateway MCP   │◀─┼────────────┤              │
│  │               │  │  │  │   Server      │  │  HTTP API  └──────────────┘
│  └───────────────┘  │  │  └───────┬───────┘  │  localhost:3003
│                     │  │          │          │
└─────────────────────┘  └──────────┼──────────┘
                                    │
                               WebSocket
                              ws://host:9999
                                    │
┌───────────────────────────────────▼────────────┐
│                Host Machine                    │
│  ┌──────────────────────────────────────────┐  │
│  │            MCP Proxy Server              │  │
│  └────────────────────┬─────────────────────┘  │
│                       │                        │
│                  ┌────┴────┐                   │
│                  │  spawn  │                   │
│            ┌─────▼─────┐ ┌─────▼─────┐         │
│            │   MCP     │ │   MCP     │         │
│            │ Server 1  │ │ Server 2  │ ・・・   │
│            └───────────┘ └───────────┘         │
└────────────────────────────────────────────────┘
```

## 🔧 トラブルシューティング

### ツール数が表示されない場合

1. MCPサーバーが正しく起動しているか確認
2. `mcp-config.json`の設定が正しいか確認
3. 環境変数（API KEYなど）が設定されているか確認

### Dockerコンテナから接続できない場合

1. ネットワーク名が正しいか確認: `docker network ls`
2. コンテナ名が正しいか確認: `docker ps`
3. ポートが開いているか確認: `docker port shared-mcp-gateway-server`

## 🔗 Claude-Projectとの統合

既存のClaude-ProjectにMCP Gatewayを統合する場合：

### 使用方法
```bash
./setup-claude-project.sh [Claude-Projectパス] <docker-compose.ymlファイル名>
```

**注意**: docker-compose.ymlファイル名は必須です。

### 使用例
```bash
# 基本的な使い方
./setup-claude-project.sh ~/Claude-Project docker-compose-base.yml

# カスタムパス
./setup-claude-project.sh /path/to/project docker-compose.yml

# teams環境用
./setup-claude-project.sh ~/Claude-Project docker-compose-teams.yml

# 開発環境用
./setup-claude-project.sh ~/Claude-Project docker-compose-dev.yml

# カレントディレクトリで実行
./setup-claude-project.sh . docker-compose.yml
```

スクリプトは以下を自動実行：
1. 統合ファイルを指定されたClaude-Projectディレクトリにコピー
2. 対話式でセットアップを続行するか確認
3. Git Submoduleの追加やDocker設定の作成

詳細は[claude-project-integration/README.md](claude-project-integration/README.md)を参照してください。

