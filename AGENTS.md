# Repository Guidelines

## プロジェクト構成と役割
- ルート直下: `src/` に Node ESM 実装 (HTTP サーバー、WebSocket MCP プロキシ、プロセス管理、永続ストレージ、CLI、サンプル登録スクリプト)。
- `ui/`: React + Vite + shadcn UI（日本語表示）。`ui/src/` にページとコンポーネント、`ui/dist/` はビルド成果物。サーバーは `dist/` を静的配信します。
- `tests/runtime.test.js`: ランタイムのヘルス・CRUD 基本経路を検証。追加テストもここに近い形で配置。
- パッケージ管理は pnpm ワークスペース。`packageManager` フィールドでバージョン固定。Docker は不要・非推奨。

## ビルド・実行・開発コマンド
- 依存取得: `pnpm install`
- UI 開発: `pnpm --filter mcp-gateway-ui run dev`（ポート 5173）。
- UI ビルド: `pnpm build:ui`（成果物を `ui/dist` に生成）。
- サーバー開発: `pnpm dev`（デフォルト 8787 で API + 静的配信）。
- 本番相当起動: `pnpm start`（事前に UI をビルド）。
- STDIO 起動（Claude の add 1行用ラッパー）: `claude mcp add -s user mcp-gateway -- /Users/kirinnokubinagaiyo/Claude-Project/mcp-gateway/scripts/mcp-gateway-stdio.sh --profile=dev`
- サンプル登録: `pnpm init:samples`（GitHub MCP:9000 と fs MCP:9001 を profiles/servers に追加。`--force` で上書き）。

## コーディングスタイルと命名
- Node 側は ESM (`type: module`)、2 スペースインデント・セミコロンあり。関数は純粋/副作用を意識し、IO（ファイル・プロセス・ソケット）を境界に分離。
- UI は TypeScript + React。コンポーネントは shadcn パターン（`ui/src/components/ui`）、スタイルは Tailwind + `cn` ヘルパー。ラベル/コピーは日本語で統一。
- サーバー ID は kebab-case、プロファイル名は英小文字＋記号なしを推奨。環境変数は `KEY=VAL` の 1 行 1 変数で保存。

## テスト指針
- 主要テスト: `pnpm test`（`node --test tests/runtime.test.js`）。新規 API/プロキシ挙動を追加したら同ファイルにケースを足すか新ファイルを `tests/` に配置。
- プロセス生成や WebSocket 依存テストはポート衝突に注意し、一時ポートを選ぶかモック化する。
- UI はユニットテスト未整備のため、主要フロー（サーバー登録→プロファイル保存→接続 URL コピー）を Vite `preview` または E2E で手動確認。

## コミット & PR ガイド
- コミットは短く目的先行（例: `feat(proxy): support profile param`、`fix(ui): avoid null modal target`）。
- PR には「目的/変更点/確認手順/関連 Issue・スクショ」を簡潔に記載。破壊的変更時は必ず注意書きを追加。

## 運用・設定上の注意
- すべてローカル前提。Docker は使用しない。ポート既定は HTTP 8787 / WS `/mcp`。
- 秘密情報は `.env` に書かず、UI の Env 入力やプロファイル保存で都度注入。`init-samples` で挿入されるトークン値はダミーのため必ず置き換える。
- 既存データを壊さないため、ストレージ（`store.json`）は JSON バリデーション後に上書き。バックアップが必要ならコピーを取ってから実行。
