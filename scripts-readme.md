# MCP Gateway 統合スクリプト

このディレクトリには、MCP Gatewayを統合・削除するためのスクリプトが含まれています。

## スクリプト一覧

### 1. integrate.ts - 共有MCP Gatewayに統合

既存のDocker Composeファイルを共有MCP Gateway構成に更新します。

```bash
./integrate.ts <docker-compose.ymlファイルのパス>
```

**実行内容:**
- プロジェクトごとのMCP Gatewayサービスを削除
- claude-codeサービスを共有MCP Gatewayに接続するよう設定
- 共有ネットワーク (shared-mcp-network) を追加
- 必要な環境変数を.envファイルに追加

**例:**
```bash
cd ~/Claude-Project/mcp-gateway
./integrate.ts ~/Claude-Project/docker-compose-base.yml
```

### 2. remove.ts - MCP Gateway設定を削除

Docker ComposeファイルからMCP Gateway関連の設定をすべて削除します。

```bash
./remove.ts <docker-compose.ymlファイルのパス>
```

**実行内容:**
- MCP Gatewayサービスを削除
- claude-codeサービスからMCP Gateway関連設定を削除
- 共有ネットワーク設定を削除
- .envファイルからMCP Gateway環境変数を削除

**例:**
```bash
cd ~/Claude-Project/mcp-gateway
./remove.ts ~/Claude-Project/docker-compose-base.yml
```

## 使用方法

### 共有MCP Gatewayへの移行

1. 共有MCP Gatewayを起動
```bash
cd ~/Claude-Project
docker compose -f docker-compose-shared.yml up -d
```

2. プロジェクトを統合
```bash
cd ~/Claude-Project/mcp-gateway
./integrate.ts ../docker-compose-base.yml
```

3. プロジェクトを再起動
```bash
cd ~/Claude-Project
docker compose down
docker compose up -d
```

### MCP Gateway設定の削除

1. 設定を削除
```bash
cd ~/Claude-Project/mcp-gateway
./remove.ts ../docker-compose-base.yml
```

2. プロジェクトを再起動
```bash
cd ~/Claude-Project
docker compose down
docker compose up -d
```

## 注意事項

- スクリプトは自動的にバックアップファイルを作成します
- integrate.ts は git submodule として mcp-gateway を追加します
- remove.ts は設定のみを削除し、サブモジュール自体は削除しません