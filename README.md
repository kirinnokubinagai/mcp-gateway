# MCP Gateway

ローカル専用の MCP ゲートウェイです。ブラウザ UI からサーバー登録・プロファイル管理・起動/停止ができ、`/mcp` WebSocket を通じて MCP クライアントから 1 本で接続できます（serverId または profile 指定）。

## セットアップ / 実行
```bash
pnpm install
pnpm --filter mcp-gateway-ui run build
pnpm start   # http://127.0.0.1:8787
# オプション: --port=8787 --host=127.0.0.1 --data-dir=/path/to/data を cli.js に渡せます
```

## MCP クライアントからの接続
- サーバーIDで指定  
  `ws://127.0.0.1:8787/mcp?serverId=<サーバーID>`  
  例: `claude mcp add mcp-github --url ws://127.0.0.1:8787/mcp?serverId=github-mcp`

- プロファイル名で指定（そのプロファイルの先頭サーバーに接続）  
  `ws://127.0.0.1:8787/mcp?profile=<プロファイル名>`  
  例: `claude mcp add mcp-dev --url ws://127.0.0.1:8787/mcp?profile=dev`

## サンプル登録（任意）
初期状態は空です。サンプルが欲しい場合はコマンドで投入してください。
```bash
pnpm init:samples            # github-mcp (port 9000), fs-mcp (port 9001), default/dev プロファイルを追加
pnpm init:samples -- --force # 既存を上書きしたい場合
```

## 機能
- MCP サーバー登録/編集/削除（command/args/env, autoStart）
- プロファイル作成/削除/切替（複数同時有効可）。有効プロファイルの autoStart サーバーを自動起動
- 手動 Start/Stop、ログは `~/.mcp-gateway/logs/<id>.log`
- 状態保存: `~/.mcp-gateway/state.json`
- MCP プロキシ: `/mcp` で serverId / profile を切替可能

## API エンドポイント
- `GET  /api/health`
- `GET  /api/state`
- `GET  /api/servers`
- `POST /api/servers`
- `PUT  /api/servers/:id`
- `DELETE /api/servers/:id`
- `POST /api/servers/:id/start`
- `POST /api/servers/:id/stop`
- `GET  /api/profiles`
- `POST /api/profiles`
- `PUT  /api/profiles/:name`
- `DELETE /api/profiles/:name`
- `POST /api/profiles/:name/activate`
- `POST /api/profiles/active`  (names: string[])
- `POST /api/reload`
- `GET  /api/status`
- `GET  /api/logs/:id?lines=200`

## テスト
```bash
pnpm test
```

## ディレクトリ
- `src/` : サーバー本体、CLI、ストレージ、プロセスマネージャ、WebSocket プロキシ
- `ui/`  : Vite + React + shadcn UI

## 注意
- 初回のみ `pnpm install` が必要です。以降はオフラインでも動作します。
- Claude などからは `/mcp?serverId=...` または `/mcp?profile=...` を登録してください。
