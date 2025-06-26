# MCP Gateway

複数のMCPサーバーを統合し、Dockerネットワーク経由でアクセス可能にするゲートウェイ（Bun専用）

## 📋 必要な環境

### 必須要件
- **Bun**: v1.0以上（必須）
- **Docker**: v20以上（Web UI使用時）
- **Docker Compose**: v2以上（Web UI使用時）
- **注意**: このプロジェクトはBun専用です。Node.js/npmでは動作しません。

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

## 🚀 クイックスタート

```bash
# 依存関係のインストール
bun install

# Claude Desktop用（プロキシサーバーとGatewayを起動）
bun run mcp

# MCP管理用Web UI付きで起動（Docker使用）
bun start

# 開発モード
bun run dev
```

### 📌 動作ポート

- **プロキシサーバー**: ws://localhost:9999
- **APIサーバー**: http://localhost:3003
- **MCP管理用Web UI**: http://localhost:3002 （`bun start`時のみ）

## 🤖 Claude Desktopでの使用

### 1. 依存関係のインストール

```bash
bun install
```

### 2. Claude Desktopへの設定

Claude Desktopの設定ファイル（`~/Library/Application Support/Claude/claude_desktop_config.json`）に以下を追加：

#### 基本設定（推奨）
```json
{
  "mcpServers": {
    "gateway": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/path/to/mcp-gateway"
    }
  }
}
```

#### MCP管理用Web UIなしで起動（リソース節約）
```json
{
  "mcpServers": {
    "gateway": {
      "command": "bun",
      "args": ["run", "mcp:no-ui"],
      "cwd": "/path/to/mcp-gateway"
    }
  }
}
```

**重要**: 
- Gateway MCPを使用する場合、個別のMCPサーバー（obsidian、context7など）の設定は削除してください
- `bun run mcp`はシンプルな起動コマンドで、MCP管理用Web UIは含まれません
- MCP管理用Web UIが必要な場合は`bun start`を使用してください

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
claude mcp add gateway "docker exec -i mcp-gateway-stdio bun server/index.ts"
```

### 方法3: 既存のプロジェクトのDockerコンテナから実行

既存のプロジェクトでMCP Gatewayが起動している場合：

```bash
# プロジェクトのディレクトリで確認
docker ps | grep mcp-gateway

# Claude Codeに追加（コンテナ名を確認して指定）
claude mcp add gateway "docker exec -i mcp-gateway-server bun server/index.ts"
```

**注意**: 
- Docker経由で実行する場合、プロキシサーバーが起動している必要があります
- コンテナ名は`docker ps`で確認してください

## 🤖 Claude Code（Docker版）でのMCP追加方法

### MCPサーバーの追加コマンド

Claude CodeのDockerコンテナ内で、MCP Gatewayを追加するには：

#### 方法1: Docker exec（推奨）

同じDockerネットワーク内のコンテナに接続：

```bash
# Docker execでMCP Gatewayコンテナに接続
claude mcp add gateway -- docker exec -i mcp-gateway-server bun server/index.ts

# 環境変数を渡す場合
claude mcp add gateway -e API_KEY=your-key -- docker exec -i mcp-gateway-server bun server/index.ts
```

#### 方法2: ホストマシンでの実行（Dockerを使わない場合）

ホストマシンで直接実行する場合：

```bash
# ホストマシンでMCP Gatewayディレクトリに移動して実行
claude mcp add gateway -- /bin/sh -c "cd /path/to/mcp-gateway && bun run mcp"
```

#### 方法3: 新規コンテナの起動（単体実行）

```bash
# 新しいDockerコンテナを起動する場合
claude mcp add gateway docker run -i --rm --init mcp-gateway-server

# 環境変数付き
claude mcp add gateway -e MCP_CONFIG=/app/config.json -- docker run -i --rm mcp-gateway-server
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

### スコープについて

MCPサーバーは3つのスコープで管理できます：

- `local`（デフォルト）: 現在のプロジェクトでのみ有効
- `project`: プロジェクト全体で共有（.mcp.jsonファイル経由）
- `user`: すべてのプロジェクトで有効

```bash
# プロジェクト全体で共有する場合
claude mcp add -s project gateway --transport http http://mcp-gateway-server:3003
```

## 🐳 Claude-Projectとの統合

詳細は[HOW_TO_INTEGRATE.md](HOW_TO_INTEGRATE.md)を参照してください。

### クイック統合手順

```bash
# 1. Claude-Projectに移動
cd ~/Claude-Project

# 2. Git Submoduleとして追加
git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway

# 3. 統合スクリプトを実行
cd mcp-gateway
./integrate.ts ../docker-compose-base.yml

# 4. 依存関係インストール
bun install && cd ..

# 5. プロキシサーバー起動（別ターミナル）
cd mcp-gateway && bun run proxy

# 6. プロジェクトを起動
cd ~/Claude-Project
./create-project.sh <プロジェクト名>

# 7. Claude Codeコンテナ内でMCP Gatewayを追加
docker exec -it claude-code-<プロジェクト名> bash
claude mcp add gateway -- docker exec -i mcp-gateway-server bun server/index.ts
```

### ⚠️ 重要：統合後の必須手順

**統合後も、Claude Codeコンテナ内で`claude mcp add`コマンドの実行が必要です！**

```bash
# コンテナに入る
docker exec -it claude-code-<プロジェクト名> bash

# MCP Gatewayを追加（docker exec経由）
claude mcp add gateway -- docker exec -i mcp-gateway-server bun server/index.ts

# 確認
claude mcp list
```

これにより、すべてのMCPサーバー（obsidian、github、context7など）がGateway経由で利用可能になります。

## 🐳 その他のDockerプロジェクトとの統合

### 📋 統合の全体像

```
あなたのプロジェクト/
├── docker-compose.yml     # あなたのプロジェクト設定
├── .env                   # 環境変数
└── mcp-gateway/           # Git SubmoduleまたはコピーしたMCP Gateway
    ├── docker-compose.yml
    ├── mcp-config.json    # MCPサーバー設定
    └── ...
```

### 🚀 統合方法

#### 方法1: ワンコマンド統合（推奨）

MCP Gatewayディレクトリから実行：

```bash
# integrate.shスクリプトを使用
./integrate.sh [Claude-Projectパス] [docker-compose.ymlファイル名]

# 例
./integrate.sh ~/Claude-Project docker-compose-base.yml
```

このコマンドが自動的に実行すること：
1. Git SubmoduleとしてMCP Gatewayを追加
2. 依存関係（`bun install`）をインストール
3. プロキシサーバーをバックグラウンドで起動
4. Docker Compose拡張ファイルを使用して統合環境を起動
5. Claude Code内のMCP設定をGateway用に自動切り替え

#### 方法2: 手動統合

### 🚀 ステップバイステップガイド

#### Step 1: MCP Gatewayを取得

**オプションA: Git Submodule（推奨）**
```bash
# あなたのプロジェクトのルートで実行
git submodule add https://github.com/your-username/mcp-gateway.git
cd mcp-gateway
bun install
```

**オプションB: 直接コピー**
```bash
# MCP Gatewayをプロジェクトにコピー
cp -r /path/to/mcp-gateway ./mcp-gateway
```

#### Step 2: プロキシサーバーを起動

```bash
# MCP Gatewayの依存関係をインストール
cd mcp-gateway
bun install

# 別ターミナルでプロキシを起動（重要！）
bun run proxy
```

⚠️ **これを忘れるとClaude CodeがMCPサーバーにアクセスできません**

#### Step 3: docker-compose.ymlを更新

あなたのプロジェクトの`docker-compose.yml`に以下を追加：

```yaml
version: '3.8'

services:
  # === MCP Gateway 統合 ここから ===
  
  # 1. プロキシチェッカー（最初に実行される）
  mcp-proxy-check:
    image: busybox
    command: |
      sh -c "
        if ! nc -z host.docker.internal 9999 2>/dev/null; then
          echo '❌ エラー: MCPプロキシサーバーが起動していません！'
          echo '👉 別ターミナルで以下を実行してください:'
          echo '   cd mcp-gateway && npm run proxy'
          exit 1
        fi
      "
    extra_hosts:
      - "host.docker.internal:host-gateway"

  # 2. MCP Gateway APIサーバー
  mcp-gateway-server:
    build:
      context: ./mcp-gateway
      dockerfile: Dockerfile.server
    container_name: mcp-gateway-server
    ports:
      - "3003:3003"    # APIポート
    volumes:
      - ./mcp-gateway/mcp-config.json:/app/mcp-config.json
    environment:
      - MCP_PROXY_PORT=9999
      - DOCKER_ENV=true
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      mcp-proxy-check:
        condition: service_completed_successfully
    networks:
      - app-network

  # 3. MCP管理用Web UI（オプション）
  mcp-gateway-client:
    build:
      context: ./mcp-gateway
      dockerfile: Dockerfile.client
    container_name: mcp-gateway-client
    ports:
      - "3002:3002"    # MCP管理用Web UIポート
    environment:
      - API_URL=http://mcp-gateway-server:3003
    depends_on:
      - mcp-gateway-server
    networks:
      - app-network

  # === MCP Gateway 統合 ここまで ===

  # あなたのアプリケーション
  your-app:
    build: .
    # ... あなたの設定 ...
    environment:
      # MCP Gateway APIを使用する場合
      MCP_GATEWAY_URL: http://mcp-gateway-server:3003
    depends_on:
      - mcp-gateway-server
    networks:
      - app-network

networks:
  app-network:
    driver: bridge
```

#### Step 4: 起動と確認

```bash
# 1. プロキシサーバーが起動していることを確認
cd mcp-gateway
bun run proxy

# 2. 別ターミナルでプロジェクトを起動
cd ..
docker compose up

# 3. 動作確認
# MCP管理用Web UI: http://localhost:3002
# API: http://localhost:3003/api/status
```

#### Step 5: Claude CodeでMCPを追加

Claude Codeコンテナ内で実行：

```bash
# HTTPトランスポートでMCP Gatewayを追加
claude mcp add --transport http gateway http://mcp-gateway-server:3003

# 確認
claude mcp list
# 出力例:
# Available MCP servers:
# - gateway (http) ✓ Connected
#   Scope: local
#   Transport: HTTP
#   URL: http://mcp-gateway-server:3003
```

### 💡 よくあるトラブルと解決策

#### ❌ エラー: "MCPプロキシサーバーが起動していません"
```bash
# 解決策
cd mcp-gateway
bun run proxy
```

#### ❌ エラー: "Cannot find module"
```bash
# 解決策
cd mcp-gateway
bun install
```

#### ❌ エラー: ポートが既に使用中
```bash
# .envファイルでポートを変更
MCP_API_PORT=3013
MCP_WEB_PORT=3012
```

#### ❌ エラー: Claude Codeで "Connection refused"
```bash
# HTTPトランスポートを指定する必要があります
# ❌ 間違い
claude mcp add gateway http://localhost:3003

# ✅ 正解（サービス名とHTTPトランスポート）
claude mcp add --transport http gateway http://mcp-gateway-server:3003
```

#### ❌ エラー: "Network not found"
```bash
# docker-compose.ymlに同じネットワークを定義
networks:
  app-network:  # 両方のサービスで同じネットワーク名を使用
    driver: bridge
```

### 🎯 Claude Codeでの使用例

#### 使用可能なMCPツール

MCP Gatewayを追加後、以下のようなMCPツールが使えるようになります：

```
# Obsidianのファイル操作
mcp__obsidian__obsidian_list_files_in_vault
mcp__obsidian__obsidian_get_file_contents
mcp__obsidian__obsidian_append_content

# GitHubの操作
mcp__github__create_repository
mcp__github__create_pull_request
mcp__github__search_repositories

# その他のMCPサーバー
mcp__context7__get-library-docs
mcp__stripe__create_customer
```

### 📝 最小構成の例

MCP管理用Web UIが不要な場合は、以下の最小構成で使用できます：

```yaml
services:
  # プロキシチェック（必須）
  mcp-proxy-check:
    image: busybox
    command: 'nc -z host.docker.internal 9999 || (echo "Run: cd mcp-gateway && npm run proxy" && exit 1)'
    extra_hosts:
      - "host.docker.internal:host-gateway"

  # MCP Gateway API（必須）
  mcp-gateway-server:
    build:
      context: ./mcp-gateway
      dockerfile: Dockerfile.server
    ports:
      - "3003:3003"
    volumes:
      - ./mcp-gateway/mcp-config.json:/app/mcp-config.json
    environment:
      - MCP_PROXY_URL=ws://host.docker.internal:9999
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      mcp-proxy-check:
        condition: service_completed_successfully

  # MCP管理用Web UIは省略可能
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

### Bun専用プロジェクト
このプロジェクトはBunランタイムに特化して最適化されています。Node.js/npmでは動作しません。

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
# 開発モード（ファイル監視付き）
bun run dev

# ビルド（MCP管理用Web UI）
bun run build

# クリーンアップ
bun run clean
```

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
3. ポートが開いているか確認: `docker port mcp-gateway-server`

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

## 📄 ライセンス

MIT