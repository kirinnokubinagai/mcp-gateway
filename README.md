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
bun run proxy:watch

# APIサーバーとWeb UIを起動（デフォルト）
docker-compose up -d

# Web UIなしで起動（オプション）
docker-compose up -d proxy-check mcp-gateway-server
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
      "command": "bun",
      "args": ["run", "proxy"],
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
claude mcp add gateway -- docker exec -i mcp-gateway-server bun server/index.ts
```

### 方法3: 既存のプロジェクトのDockerコンテナから実行

既存のプロジェクトでMCP Gatewayが起動している場合：

```bash
# プロジェクトのディレクトリで確認
docker ps | grep mcp-gateway

# Claude Codeに追加（固定コンテナ名を使用）
claude mcp add gateway -- docker exec -i mcp-gateway-server bun server/index.ts
```

**注意**: 
- Docker経由で実行する場合、プロキシサーバーが起動している必要があります
- `--`を忘れずに付けてください（`claude mcp add`のオプションとコマンドを区別するため）

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

#### 方法2: HTTP トランスポート（非推奨）

**注意**: MCP Gateway の HTTP API は MCP プロトコルに準拠していないため、この方法は動作しません。

```bash
# ❌ 動作しない例
claude mcp add --transport http gateway http://mcp-gateway-server:3003
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


## 🐳 Claude-Projectとの統合

### 前提条件
- Claude-Projectが既にセットアップされている
- Bunがインストールされている
- Dockerが起動している

### 統合手順

#### 1. Claude-Projectディレクトリに移動
```bash
cd ~/Claude-Project
```

#### 2. Git SubmoduleとしてMCP Gatewayを追加
```bash
git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway
git submodule update --init --recursive
```

#### 3. 統合スクリプトを実行
```bash
# integrate.tsを使用してdocker-compose.ymlを自動更新
./mcp-gateway/integrate.ts ~/Claude-Project/docker-compose-base.yml
```

#### 5. プロキシサーバーを起動（別ターミナルで）
```bash
cd mcp-gateway
bun run proxy
```
※ ポート9999で起動します

#### 6. プロジェクトを起動
```bash
cd ~/Claude-Project
./create-project.sh <プロジェクト名>
```

#### 7. Claude Codeコンテナ内でMCP Gatewayを追加
```bash
docker exec -it claude-code-<プロジェクト名> bash
claude mcp add gateway -- docker exec -i shared-mcp-gateway-server bun server/index.ts
```

### ⚠️ 重要：統合後の必須手順

**統合後も、Claude Codeコンテナ内で`claude mcp add`コマンドの実行が必要です！**

```bash
# コンテナに入る
docker exec -it claude-code-<プロジェクト名> bash

# MCP Gatewayを追加（docker exec経由、固定コンテナ名を使用）
claude mcp add gateway -- docker exec -i mcp-gateway-server bun server/index.ts

# 確認
claude mcp list
```

これにより、すべてのMCPサーバー（obsidian、github、context7など）がGateway経由で利用可能になります。

**注意**: 統合スクリプトによってコンテナ名は`mcp-gateway-server`に固定されているため、プロジェクト名に関係なく同じコマンドで動作します。

### integrate.ts スクリプトの動作

`integrate.ts`は、既存のdocker-compose.ymlファイルにMCP Gatewayサービスを自動的に追加するTypeScriptスクリプトです。

#### 使用方法
```bash
./integrate.ts <docker-compose.ymlファイルのパス>
```

#### スクリプトが行う処理

1. **YAMLファイルの読み込みと解析**
   - js-yamlライブラリを使用してdocker-compose.ymlを解析
   - バックアップファイル（.backup）を自動作成

2. **サービスの追加**
   ```yaml
   # 以下のサービスが自動的に追加されます：
   mcp-proxy-check:      # プロキシサーバーの起動確認
   mcp-gateway-server:   # MCP Gateway APIサーバー（固定名）
   mcp-gateway-client:   # MCP管理用Web UI（固定名）
   ```
   
   - **MCP管理用Web UI**: http://localhost:3002 でアクセス可能
   - **MCP Gateway API**: http://localhost:3003 でアクセス可能

3. **既存サービスの更新**
   - `claude-code`サービスに環境変数`MCP_GATEWAY_URL`を追加
   - 依存関係（depends_on）に`mcp-gateway-server`を追加
   - MCP設定ファイルのボリュームマウントを追加

4. **ネットワーク設定の自動判定**
   - `network_mode: host`の場合：ポート設定をスキップ
   - 通常モードの場合：適切なポートとネットワークを設定

5. **.envファイルの更新**
   ```bash
   # 以下の環境変数が自動的に追加されます：
   PROJECT_NAME=default-project
   CLAUDE_PROJECT_DIR=/path/to/claude-project
   MCP_PROXY_PORT=9999
   MCP_API_PORT=3003
   MCP_WEB_PORT=3002
   ```

#### 統合後の構成
```yaml
services:
  claude-code:
    # 既存の設定...
    environment:
      - MCP_GATEWAY_URL=http://mcp-gateway-server:3003  # 自動追加
    volumes:
      # MCP設定ファイルの自動マウント
      - ${CLAUDE_PROJECT_DIR}/mcp-gateway/claude-project-integration/mcp-servers-gateway.json:/home/developer/.config/claude/mcp-servers.json:ro
    depends_on:
      - mcp-gateway-server  # 自動追加

  # 以下、自動追加されるサービス
  mcp-gateway-server:
    container_name: mcp-gateway-server  # 固定名
    # ...
```

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
```

**オプションB: 直接コピー**
```bash
# MCP Gatewayをプロジェクトにコピー
cp -r /path/to/mcp-gateway ./mcp-gateway
```

#### Step 2: プロキシサーバーを起動

```bash
# 別ターミナルでプロキシを起動（重要！）
cd mcp-gateway
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
# Docker execでMCP Gatewayを追加（HTTPトランスポートは非対応）
claude mcp add gateway -- docker exec -i mcp-gateway-server bun server/index.ts

# 確認
claude mcp list
# 出力例:
# Available MCP servers:
# - gateway (stdio) ✓ Connected
#   Scope: local
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
# 解決策: プロキシサーバーはBunの実行時に依存関係を解決します
# package.jsonには依存関係が不要です
```

#### ❌ エラー: ポートが既に使用中
```bash
# .envファイルでポートを変更
MCP_API_PORT=3013
MCP_WEB_PORT=3012
```

#### ❌ エラー: Claude Codeで "Connection refused"
```bash
# Docker execを使用する必要があります（HTTPトランスポートは非対応）
# ❌ 間違い
claude mcp add --transport http gateway http://mcp-gateway-server:3003

# ✅ 正解（Docker exec経由）
claude mcp add gateway -- docker exec -i mcp-gateway-server bun server/index.ts
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