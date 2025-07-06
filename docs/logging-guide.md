# MCP Gateway ログシステムガイド

## 概要

MCP Gatewayは統一されたログシステムを提供しています。このシステムは以下の機能を持っています：

- 構造化ログ（JSON形式）
- ログレベル（DEBUG, INFO, WARN, ERROR）
- パフォーマンスメトリクス
- 相関ID追跡
- 自動ログローテーション
- 非同期バッチ書き込み

## 基本的な使い方

### ロガーの作成

```typescript
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'MyModule' });
```

### ログの出力

```typescript
// デバッグレベル
logger.debug('デバッグ情報', { userId: 123 });

// 情報レベル
logger.info('処理を開始しました', { action: 'start' });

// 警告レベル
logger.warn('メモリ使用率が高くなっています', { usage: 85 });

// エラーレベル
logger.error('エラーが発生しました', error, { context: 'database' });
```

## パフォーマンス計測

### タイマーを使用した計測

```typescript
const timer = logger.startTimer('データ取得');
// 処理
const data = await fetchData();
const metrics = timer();
logger.performance('データ取得完了', metrics);
```

### デコレーターを使用した自動計測

```typescript
import { logPerformance } from './logger.js';

class DataService {
  @logPerformance('データ取得')
  async fetchData() {
    // 処理時間とメモリ使用量が自動的に記録される
    return await database.query('...');
  }
}
```

## 相関ID追跡

リクエスト全体を通じて同じ相関IDを使用：

```typescript
await logger.withCorrelationId('req-123', async () => {
  // この中のすべてのログに相関IDが付与される
  logger.info('リクエスト処理開始');
  await processRequest();
  logger.info('リクエスト処理完了');
});
```

## 環境変数

### LOG_LEVEL

ログレベルを設定（DEBUG, INFO, WARN, ERROR）

```bash
LOG_LEVEL=DEBUG npm start
```

### LOG_MAX_SIZE

ログファイルの最大サイズ（バイト単位、デフォルト: 10MB）

```bash
LOG_MAX_SIZE=52428800 # 50MB
```

### LOG_MAX_FILES

保持するログファイルの最大数（デフォルト: 5）

```bash
LOG_MAX_FILES=10
```

### LOG_PERF_THRESHOLD

パフォーマンス警告の閾値（ミリ秒、デフォルト: 1000）

```bash
LOG_PERF_THRESHOLD=500 # 500ms以上で警告
```

## ログファイルの場所

ログファイルは以下の場所に保存されます：

- `logs/mcp-gateway-YYYY-MM-DD.log`

ファイルサイズが上限に達すると自動的にローテーションされます：

- `logs/mcp-gateway-YYYY-MM-DDTHH-mm-ss-SSS.log`

## ログ形式

### JSON形式（ファイル）

```json
{
  "timestamp": "2024-01-20T10:30:45.123Z",
  "level": "INFO",
  "message": "サーバー接続成功",
  "context": {
    "module": "MCPGateway",
    "serverName": "example-server"
  },
  "correlationId": "req-123",
  "performance": {
    "duration": 1234,
    "memory": {
      "used": 52428800,
      "total": 134217728
    }
  }
}
```

### カラー出力（コンソール）

```
[2024-01-20T10:30:45.123Z] [INFO] サーバー接続成功 {"module":"MCPGateway","serverName":"example-server"}
```

## ベストプラクティス

### 1. 構造化データを使用

```typescript
// 良い例
logger.info('ユーザー作成', {
  userId: user.id,
  email: user.email,
  role: user.role,
});

// 悪い例
logger.info(`ユーザー ${user.id} (${user.email}) を作成しました`);
```

### 2. エラーオブジェクトを渡す

```typescript
try {
  await someOperation();
} catch (error) {
  // 良い例
  logger.error('操作に失敗しました', error, { operation: 'someOperation' });

  // 悪い例
  logger.error(`操作に失敗しました: ${error.message}`);
}
```

### 3. 適切なログレベルを使用

- **DEBUG**: 開発時のデバッグ情報
- **INFO**: 正常な処理フロー
- **WARN**: 注意が必要な状態（継続可能）
- **ERROR**: エラー状態（要対応）

### 4. パフォーマンスが重要な処理を計測

```typescript
class CriticalService {
  @logPerformance('重要な処理')
  async criticalOperation() {
    // 自動的に実行時間とリソース使用量が記録される
  }
}
```

## トラブルシューティング

### ログが出力されない

1. 環境変数 `LOG_LEVEL` を確認
2. ログディレクトリの書き込み権限を確認

### ログファイルが大きくなりすぎる

1. `LOG_MAX_SIZE` を調整
2. `LOG_MAX_FILES` を減らす
3. ログレベルを上げる（INFO → WARN）

### パフォーマンス警告が多すぎる

1. `LOG_PERF_THRESHOLD` を調整
2. 実際のパフォーマンス問題を調査

## 移行ガイド

### console.log からの移行

```typescript
// 以前
console.log('処理開始');
console.error('エラー:', error);

// 移行後
logger.info('処理開始');
logger.error('エラーが発生しました', error);
```

### デバッグ時の tips

```typescript
// 開発環境でのみ詳細ログを出力
if (process.env.NODE_ENV === 'development') {
  logger.debug('詳細なデバッグ情報', {
    fullRequest: request,
    internalState: state,
  });
}
```
