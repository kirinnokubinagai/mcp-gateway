# MCP Gateway完全リファクタリング要件書

## 1. プロジェクト概要

### 目的
MCP Gatewayプロジェクトのアーキテクチャを完全に分離し、プロファイル機能を修正、開発環境を統一することで、保守性と拡張性を向上させる。

### 現在の問題点
1. **アーキテクチャの混在**: フロントエンド（ui/）、バックエンド（server/）、プロキシ（mcp-proxy-server/）が統合されたpackage.json構成
2. **プロファイル機能の複雑性**: デフォルトプロファイル概念、enabled/disabledの二重管理
3. **不要ファイルの蓄積**: バックアップファイル、テストファイル、デバッグコードの散在
4. **Docker/ローカル環境の不整合**: 設定ファイルや起動方法の違い
5. **Makefileの不在**: claude-project-integrationは手動管理

## 2. 要求仕様

### 2.1 アーキテクチャ分離要件

#### 2.1.1 フロントエンド完全分離（ui/）
```
ui/
├── package.json        # 独自の依存関係管理
├── tsconfig.json       # UI専用TypeScript設定
├── vite.config.ts      # Vite設定
├── tailwind.config.js  # Tailwind設定
├── src/
│   ├── components/     # React components
│   ├── lib/           # Utils
│   ├── App.tsx        # メインコンポーネント
│   └── main.tsx       # エントリーポイント
└── dist/              # ビルド成果物
```

**依存関係**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui

#### 2.1.2 バックエンド完全分離（server/）
```
server/
├── package.json         # 独自の依存関係管理（Bun対応）
├── tsconfig.json        # サーバー専用TypeScript設定
├── index.ts            # メインサーバー
├── api-server.ts       # REST API
├── types/              # 型定義
├── schemas/            # 設定スキーマ
├── __tests__/          # テストファイル
└── dist/               # ビルド成果物
```

**依存関係**: Bun, Hono, WebSocket, TypeScript

#### 2.1.3 プロキシサーバー完全分離（mcp-proxy-server/）
```
mcp-proxy-server/
├── package.json    # 独自の依存関係管理（Bun専用）
├── tsconfig.json   # プロキシ専用TypeScript設定
├── server.ts       # WebSocketプロキシサーバー
└── dist/           # ビルド成果物
```

**依存関係**: Bun（必須）、WebSocket

#### 2.1.4 プロジェクトルート最小化
```
プロジェクトルート/
├── Makefile            # 統一された操作コマンド
├── docker-compose.yml  # Docker設定
├── .env.example        # 環境変数テンプレート
├── mcp-config.json     # MCP設定（enabled削除）
├── docs/               # ドキュメント集約
├── ui/                 # フロントエンド
├── server/             # バックエンド
└── mcp-proxy-server/   # プロキシ
```

### 2.2 プロファイル機能修正要件

#### 2.2.1 デフォルトプロファイル概念の完全削除
- `activeProfile`フィールドの削除
- `default`プロファイルの削除
- プロファイル未選択時は「プロファイルなし」状態

#### 2.2.2 enabled フィールドの削除
```json
// 修正前
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {},
      "enabled": true  // <- 削除
    }
  }
}

// 修正後
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {}
    }
  }
}
```

#### 2.2.3 プロファイル切り替え機能（localhost:3002）
- トグルボタン: プロファイル指定時のみ有効/無効切替可能
- プロファイル未選択時: 全MCPサーバーが自動接続
- プロファイル選択時: 指定されたサーバーのみ接続、個別トグル可能

#### 2.2.4 新しい設定形式
```json
{
  "mcpServers": {
    "github": { "command": "...", "args": [...], "env": {...} },
    "obsidian": { "command": "...", "args": [...], "env": {...} }
  },
  "profiles": {
    "claude_desktop": ["github", "obsidian"],
    "claude_code": ["github", "obsidian", "playwright"]
  }
}
```

### 2.3 開発環境統一要件

#### 2.3.1 Makefile による統一操作
```makefile
# 開発開始
start: proxy-start docker-start
stop: docker-stop proxy-stop

# プロキシサーバー
proxy-start:
    cd mcp-proxy-server && bun run dev &

proxy-stop:
    pkill -f "bun.*server.ts"

# Docker環境
docker-start:
    docker-compose up -d

docker-stop:
    docker-compose down

# ビルド
build: build-ui build-server build-proxy

build-ui:
    cd ui && bun run build

build-server:
    cd server && bun run build

build-proxy:
    cd mcp-proxy-server && bun run build

# テスト
test: test-server test-ui

test-server:
    cd server && bun test

test-ui:
    cd ui && bun test

# 型チェック
typecheck: typecheck-ui typecheck-server typecheck-proxy

typecheck-ui:
    cd ui && bun run typecheck

typecheck-server:
    cd server && bun run typecheck

typecheck-proxy:
    cd mcp-proxy-server && bun run typecheck
```

#### 2.3.2 Docker/ローカル環境一致
- 両環境で同一のmcp-config.json使用
- 環境変数による設定分岐廃止
- ポート統一: proxy(9999), api(3003), web(3002)

#### 2.3.3 claude-project-integration のMakefile化
```makefile
# claude-project-integration/Makefile
include ../Makefile

# Claude Code固有の設定
integrate: check-proxy start-containers

check-proxy:
    @nc -z localhost 9999 || (echo "プロキシ未起動" && exit 1)

start-containers:
    docker-compose -f ../docker-compose.yml up -d
```

## 3. 削除対象ファイル・コード

### 3.1 完全削除対象ファイル
```
# バックアップファイル
mcp-proxy-server/server.ts.backup
mcp-proxy-server/server.ts.backup2
server/@types/@modelcontextprotocol/sdk/index.d.ts.bak
server/types/mcp-sdk.d.ts.bak
server/schemas/config.schema.ts.bak
server/schemas/migrations.ts.bak
server/schemas/config-schema.ts.bak

# 旧ディレクトリ
src-backup/                    # 完全削除
docker-configs/               # 不要（各package.jsonに移行）

# ルートレベル設定ファイル
package.json                  # 分離後不要
package-lock.json
bun.lock
tsconfig.json
tsconfig.node.json
vite.config.ts
postcss.config.js
tailwind.config.js
index.html
.prettierrc.json
.prettierignore
.eslintrc.json

# 統合用スクリプト
integrate.ts
remove.ts
scripts-readme.md
scripts/replace-secrets.js
scripts/watch-config.js
scripts/validate-config.js

# テスト関連ファイル（各ディレクトリ内に移動）
tests/                        # server/__tests__/に統合
server/test-simple.ts         # server/__tests__/に移動
server/test-state-manager.js  # server/__tests__/に移動
server/state-manager.js       # TypeScript版があるため削除
server/logger.js              # TypeScript版があるため削除
```

### 3.2 不要コード削除対象

#### 3.2.1 デフォルトプロファイル関連
```typescript
// 削除対象
interface MCPConfig {
  activeProfile?: string | null;  // 削除
}

// 削除対象
let activeProfile = process.env.MCP_PROFILE || 'default'; // 削除

// 削除対象
config.activeProfile = 'default'; // 削除

// 削除対象
if (activeProfile === 'default') { // 削除
```

#### 3.2.2 enabled フィールド処理
```typescript
// 削除対象
interface MCPServer {
  enabled?: boolean; // 削除
}

// 削除対象
if (server.enabled === false) { // 削除
```

#### 3.2.3 不要なコメント・デバッグコード
- 日本語コメント（機能説明以外）
- console.log デバッグ出力
- 未使用のimport文
- 空の関数・クラス

## 4. ファイル移動・新規作成計画

### 4.1 ファイル移動
```
# フロントエンド移動
src/* → ui/src/
index.html → ui/index.html
vite.config.ts → ui/vite.config.ts
tailwind.config.js → ui/tailwind.config.js
postcss.config.js → ui/postcss.config.js

# 設定ファイル移動
.eslintrc.json → 各ディレクトリに個別作成
.prettierrc.json → 各ディレクトリに個別作成
tsconfig.json → 各ディレクトリに個別作成

# テストファイル統合
tests/* → server/__tests__/
server/test-*.js → server/__tests__/
```

### 4.2 新規作成ファイル
```
# Makefile
Makefile
claude-project-integration/Makefile

# 個別package.json
ui/package.json
server/package.json
mcp-proxy-server/package.json

# 個別設定ファイル
ui/tsconfig.json
ui/.eslintrc.json
ui/.prettierrc.json
server/tsconfig.json
server/.eslintrc.json
server/.prettierrc.json
mcp-proxy-server/tsconfig.json

# ドキュメント
docs/README.md
docs/ARCHITECTURE.md
docs/DEPLOYMENT.md
docs/API.md
```

## 5. 実装順序とタスク分解

### Phase 1: 準備作業（1-2時間）
1. **バックアップ作成**
   - 現在の状態をgit commitで保存
   - 重要ファイルの手動バックアップ

2. **不要ファイル削除**
   - backup, .bak ファイル削除
   - src-backup/ ディレクトリ削除
   - 重複ファイル削除

### Phase 2: アーキテクチャ分離（3-4時間）
3. **ui/ ディレクトリ構築**
   - package.json作成（React, Vite, TypeScript）
   - 設定ファイル移動・調整
   - src/移動とimport修正

4. **server/ ディレクトリ整理**
   - package.json作成（Bun, Hono専用）
   - 不要ファイル削除
   - テストファイル統合

5. **mcp-proxy-server/ 独立化**
   - package.json作成（Bun専用）
   - 設定ファイル独立

### Phase 3: プロファイル機能修正（2-3時間）
6. **設定形式変更**
   - enabled フィールド削除
   - activeProfile 概念削除
   - スキーマ更新

7. **UI修正**
   - デフォルトプロファイル処理削除
   - トグルボタン動作修正
   - プロファイル未選択時の動作実装

8. **バックエンド修正**
   - プロファイル処理ロジック修正
   - API仕様変更
   - WebSocket通信修正

### Phase 4: 開発環境統一（1-2時間）
9. **Makefile作成**
   - 統一操作コマンド実装
   - Docker操作統合
   - ビルド・テスト自動化

10. **Docker設定調整**
    - Dockerfile修正
    - docker-compose.yml最適化
    - 環境変数整理

### Phase 5: 品質改善・テスト（2-3時間）
11. **コード品質向上**
    - YAGNI・KISS原則適用
    - 不要コメント削除
    - TypeScript型安全性向上

12. **テスト実行・修正**
    - 全モジュールテスト実行
    - 失敗テスト修正
    - E2E動作確認

13. **ドキュメント整備**
    - docs/ ディレクトリ構築
    - README.md完全更新
    - API仕様書更新

### Phase 6: 最終検証（1時間）
14. **動作確認**
    - ローカル環境テスト
    - Docker環境テスト
    - プロファイル切り替えテスト

15. **パフォーマンス検証**
    - 起動時間測定
    - メモリ使用量確認
    - WebSocket安定性確認

## 6. 成功基準

### 6.1 技術的成功基準
- [ ] 各モジュール（ui/, server/, mcp-proxy-server/）が独立してビルド・実行可能
- [ ] プロファイル機能がenabledフィールドなしで正常動作
- [ ] Docker環境とローカル環境で同一動作
- [ ] 全テストが通過
- [ ] TypeScript型エラーゼロ
- [ ] ESLint警告ゼロ

### 6.2 機能的成功基準
- [ ] localhost:3002でプロファイル切り替え可能
- [ ] プロファイル未選択時に全MCPサーバー自動接続
- [ ] トグルボタンがプロファイル選択時のみ機能
- [ ] WebSocketプロキシが安定動作
- [ ] MCP servers-gatewayが正常動作

### 6.3 保守性成功基準
- [ ] Makefileで全操作が統一
- [ ] 不要ファイル・コードの完全削除
- [ ] ドキュメントがdocs/に集約
- [ ] 各モジュールの責任分離明確

## 7. リスク分析と対策

### 7.1 高リスク
**WebSocket接続断**: プロファイル変更時の接続安定性
- **対策**: 段階的切り替え実装、フォールバック機能

**Docker環境差異**: ローカルとDocker環境の設定不整合
- **対策**: 環境変数統一、設定ファイル共有

### 7.2 中リスク
**依存関係競合**: 分離時のpackage.json依存関係
- **対策**: 最小限の依存関係、バージョン固定

**TypeScript型エラー**: 大幅なコード変更による型不整合
- **対策**: 段階的移行、型定義ファイル整備

### 7.3 低リスク
**テスト失敗**: 構造変更によるテスト不整合
- **対策**: テスト修正、必要に応じてテスト追加

## 8. 完了後の利益

### 8.1 開発効率向上
- 各モジュール独立開発・デプロイ可能
- Makefileによる操作統一
- Docker/ローカル環境一致

### 8.2 保守性向上
- 責任分離による理解容易性
- 不要コード削除による可読性向上
- ドキュメント集約による情報アクセス性

### 8.3 拡張性向上
- モジュール独立による拡張容易性
- プロファイル機能のシンプル化
- 設定管理の一元化

この要件書に基づいて、段階的かつ確実にリファクタリングを実行することで、MCP Gatewayプロジェクトの品質と保守性を大幅に向上させることができます。