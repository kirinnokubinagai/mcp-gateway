/**
 * MCP Gateway エラーハンドリングモジュール
 * 
 * エラーの分類、復旧戦略、サーキットブレーカーパターンを実装
 */

export interface ErrorInfo {
  type: ErrorType;
  message: string;
  userMessage: string;
  details?: string;
  retryable: boolean;
  maxRetries: number;
  retryDelay: number;
  severity: ErrorSeverity;
}

export enum ErrorType {
  // 一時的なエラー（復旧可能）
  TIMEOUT = 'timeout',
  CONNECTION_REFUSED = 'connection_refused',
  NETWORK_ERROR = 'network_error',
  CONTAINER_CRASHED = 'container_crashed',
  PROXY_UNAVAILABLE = 'proxy_unavailable',
  
  // 永続的なエラー（復旧不可能）
  COMMAND_NOT_FOUND = 'command_not_found',
  PACKAGE_NOT_FOUND = 'package_not_found',
  PERMISSION_DENIED = 'permission_denied',
  INVALID_CONFIG = 'invalid_config',
  AUTHENTICATION_FAILED = 'authentication_failed',
  
  // 不明なエラー
  UNKNOWN = 'unknown'
}

export enum ErrorSeverity {
  LOW = 'low',      // 警告レベル
  MEDIUM = 'medium', // 通常のエラー
  HIGH = 'high',    // 重大なエラー
  CRITICAL = 'critical' // システム停止レベル
}

// サーキットブレーカーの状態
export enum CircuitState {
  CLOSED = 'closed',     // 正常（接続を試行する）
  OPEN = 'open',         // 異常（接続を拒否する）
  HALF_OPEN = 'half_open' // 復旧確認中
}

export interface CircuitBreaker {
  state: CircuitState;
  failureCount: number;
  lastFailureTime?: Date;
  nextRetryTime?: Date;
  successCount: number;
}

// サーバーごとのサーキットブレーカー
const circuitBreakers = new Map<string, CircuitBreaker>();

// エラータイプ別の復旧戦略
const errorStrategies: Record<ErrorType, Partial<ErrorInfo>> = {
  [ErrorType.TIMEOUT]: {
    retryable: true,
    maxRetries: 3,
    retryDelay: 5000,
    severity: ErrorSeverity.MEDIUM,
    userMessage: '接続がタイムアウトしました。自動的に再接続を試みます。'
  },
  [ErrorType.CONNECTION_REFUSED]: {
    retryable: true,
    maxRetries: 5,
    retryDelay: 3000,
    severity: ErrorSeverity.HIGH,
    userMessage: 'プロキシサーバーに接続できません。サーバーが起動しているか確認してください。'
  },
  [ErrorType.NETWORK_ERROR]: {
    retryable: true,
    maxRetries: 3,
    retryDelay: 5000,
    severity: ErrorSeverity.MEDIUM,
    userMessage: 'ネットワークエラーが発生しました。接続を再試行します。'
  },
  [ErrorType.CONTAINER_CRASHED]: {
    retryable: true,
    maxRetries: 3,
    retryDelay: 10000,
    severity: ErrorSeverity.HIGH,
    userMessage: 'コンテナが異常終了しました。再起動を試みます。'
  },
  [ErrorType.PROXY_UNAVAILABLE]: {
    retryable: true,
    maxRetries: 10,
    retryDelay: 2000,
    severity: ErrorSeverity.CRITICAL,
    userMessage: 'プロキシサーバーが利用できません。`bun run proxy`でプロキシサーバーを起動してください。'
  },
  [ErrorType.COMMAND_NOT_FOUND]: {
    retryable: false,
    maxRetries: 0,
    retryDelay: 0,
    severity: ErrorSeverity.HIGH,
    userMessage: 'コマンドが見つかりません。インストールされているか確認してください。'
  },
  [ErrorType.PACKAGE_NOT_FOUND]: {
    retryable: false,
    maxRetries: 0,
    retryDelay: 0,
    severity: ErrorSeverity.HIGH,
    userMessage: 'パッケージが見つかりません。npm installまたはパッケージ名を確認してください。'
  },
  [ErrorType.PERMISSION_DENIED]: {
    retryable: false,
    maxRetries: 0,
    retryDelay: 0,
    severity: ErrorSeverity.HIGH,
    userMessage: '権限がありません。実行権限を確認してください。'
  },
  [ErrorType.INVALID_CONFIG]: {
    retryable: false,
    maxRetries: 0,
    retryDelay: 0,
    severity: ErrorSeverity.CRITICAL,
    userMessage: '設定が無効です。mcp-config.jsonを確認してください。'
  },
  [ErrorType.AUTHENTICATION_FAILED]: {
    retryable: false,
    maxRetries: 0,
    retryDelay: 0,
    severity: ErrorSeverity.HIGH,
    userMessage: '認証に失敗しました。認証情報を確認してください。'
  },
  [ErrorType.UNKNOWN]: {
    retryable: true,
    maxRetries: 2,
    retryDelay: 5000,
    severity: ErrorSeverity.MEDIUM,
    userMessage: '不明なエラーが発生しました。'
  }
};

/**
 * エラーメッセージからエラータイプを判定
 */
export function detectErrorType(error: Error | string): ErrorType {
  const message = typeof error === 'string' ? error : error.message;
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('timeout') || lowerMessage.includes('タイムアウト')) {
    return ErrorType.TIMEOUT;
  }
  if (lowerMessage.includes('econnrefused') || lowerMessage.includes('connection refused')) {
    return ErrorType.CONNECTION_REFUSED;
  }
  if (lowerMessage.includes('enetunreach') || lowerMessage.includes('network')) {
    return ErrorType.NETWORK_ERROR;
  }
  if (lowerMessage.includes('container') && (lowerMessage.includes('exit') || lowerMessage.includes('crash'))) {
    return ErrorType.CONTAINER_CRASHED;
  }
  if (lowerMessage.includes('proxy') && lowerMessage.includes('unavailable')) {
    return ErrorType.PROXY_UNAVAILABLE;
  }
  if (lowerMessage.includes('command not found') || lowerMessage.includes('enoent') || lowerMessage.includes('spawn')) {
    return ErrorType.COMMAND_NOT_FOUND;
  }
  if (lowerMessage.includes('404') || lowerMessage.includes('package not found')) {
    return ErrorType.PACKAGE_NOT_FOUND;
  }
  if (lowerMessage.includes('permission') || lowerMessage.includes('eacces') || lowerMessage.includes('eperm')) {
    return ErrorType.PERMISSION_DENIED;
  }
  if (lowerMessage.includes('config') || lowerMessage.includes('invalid')) {
    return ErrorType.INVALID_CONFIG;
  }
  if (lowerMessage.includes('auth') || lowerMessage.includes('unauthorized')) {
    return ErrorType.AUTHENTICATION_FAILED;
  }
  
  return ErrorType.UNKNOWN;
}

/**
 * エラー情報を生成
 */
export function createErrorInfo(error: Error | string, serverName?: string): ErrorInfo {
  const errorType = detectErrorType(error);
  const strategy = errorStrategies[errorType];
  const errorMessage = typeof error === 'string' ? error : error.message;
  
  // サーバー名を含むより詳細なメッセージ
  let userMessage = strategy.userMessage || 'エラーが発生しました。';
  if (serverName) {
    userMessage = `[${serverName}] ${userMessage}`;
  }
  
  return {
    type: errorType,
    message: errorMessage,
    userMessage,
    details: error instanceof Error ? error.stack : undefined,
    retryable: strategy.retryable ?? false,
    maxRetries: strategy.maxRetries ?? 0,
    retryDelay: strategy.retryDelay ?? 5000,
    severity: strategy.severity ?? ErrorSeverity.MEDIUM
  };
}

/**
 * サーキットブレーカーの取得または作成
 */
export function getCircuitBreaker(serverName: string): CircuitBreaker {
  if (!circuitBreakers.has(serverName)) {
    circuitBreakers.set(serverName, {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0
    });
  }
  return circuitBreakers.get(serverName)!;
}

/**
 * エラー発生時のサーキットブレーカー更新
 */
export function recordFailure(serverName: string, errorInfo: ErrorInfo): void {
  const breaker = getCircuitBreaker(serverName);
  breaker.failureCount++;
  breaker.lastFailureTime = new Date();
  breaker.successCount = 0;
  
  // 失敗回数が閾値を超えたらサーキットを開く
  const threshold = errorInfo.severity === ErrorSeverity.CRITICAL ? 1 : 
                    errorInfo.severity === ErrorSeverity.HIGH ? 3 : 5;
  
  if (breaker.failureCount >= threshold) {
    breaker.state = CircuitState.OPEN;
    // 復旧試行までの待機時間を計算（指数バックオフ）
    const waitTime = Math.min(
      errorInfo.retryDelay * Math.pow(2, breaker.failureCount - threshold),
      300000 // 最大5分
    );
    breaker.nextRetryTime = new Date(Date.now() + waitTime);
    
    console.error(`[${serverName}] サーキットブレーカーがOPENになりました。次回再試行: ${breaker.nextRetryTime.toLocaleTimeString()}`);
  }
}

/**
 * 成功時のサーキットブレーカー更新
 */
export function recordSuccess(serverName: string): void {
  const breaker = getCircuitBreaker(serverName);
  breaker.successCount++;
  
  // HALF_OPEN状態で成功したらCLOSEDに戻す
  if (breaker.state === CircuitState.HALF_OPEN) {
    breaker.state = CircuitState.CLOSED;
    breaker.failureCount = 0;
    console.error(`[${serverName}] サーキットブレーカーがCLOSEDになりました。正常状態に復帰。`);
  }
}

/**
 * 接続を試行すべきかチェック
 */
export function shouldAttemptConnection(serverName: string): boolean {
  const breaker = getCircuitBreaker(serverName);
  
  if (breaker.state === CircuitState.CLOSED) {
    return true;
  }
  
  if (breaker.state === CircuitState.OPEN) {
    // 再試行時間に達したらHALF_OPENに移行
    if (breaker.nextRetryTime && new Date() >= breaker.nextRetryTime) {
      breaker.state = CircuitState.HALF_OPEN;
      console.error(`[${serverName}] サーキットブレーカーがHALF_OPENになりました。接続を試行します。`);
      return true;
    }
    return false;
  }
  
  // HALF_OPEN状態では1回だけ試行を許可
  return breaker.state === CircuitState.HALF_OPEN;
}

/**
 * エラー復旧戦略の実行
 */
export async function executeRecoveryStrategy(
  serverName: string,
  errorInfo: ErrorInfo,
  attemptNumber: number,
  onRetry: () => Promise<void>
): Promise<boolean> {
  // リトライ不可能なエラーの場合
  if (!errorInfo.retryable) {
    console.error(`[${serverName}] このエラーは復旧できません: ${errorInfo.type}`);
    return false;
  }
  
  // 最大リトライ回数を超えた場合
  if (attemptNumber >= errorInfo.maxRetries) {
    console.error(`[${serverName}] 最大リトライ回数(${errorInfo.maxRetries})に達しました。`);
    return false;
  }
  
  // サーキットブレーカーチェック
  if (!shouldAttemptConnection(serverName)) {
    const breaker = getCircuitBreaker(serverName);
    console.error(`[${serverName}] サーキットブレーカーがOPENです。次回再試行: ${breaker.nextRetryTime?.toLocaleTimeString()}`);
    return false;
  }
  
  // リトライ遅延（指数バックオフ）
  const delay = errorInfo.retryDelay * Math.pow(1.5, attemptNumber);
  console.error(`[${serverName}] ${delay}ms後に再接続を試みます... (試行 ${attemptNumber + 1}/${errorInfo.maxRetries})`);
  
  await new Promise(resolve => setTimeout(resolve, delay));
  
  try {
    await onRetry();
    recordSuccess(serverName);
    return true;
  } catch (retryError) {
    const newErrorInfo = createErrorInfo(retryError as Error, serverName);
    recordFailure(serverName, newErrorInfo);
    return false;
  }
}

/**
 * エラー状態の詳細情報を取得
 */
export interface ErrorStatus {
  errorType: ErrorType;
  errorMessage: string;
  userMessage: string;
  severity: ErrorSeverity;
  retryable: boolean;
  circuitBreakerState: CircuitState;
  failureCount: number;
  lastFailureTime?: Date;
  nextRetryTime?: Date;
}

export function getErrorStatus(serverName: string, error: Error | string): ErrorStatus {
  const errorInfo = createErrorInfo(error, serverName);
  const breaker = getCircuitBreaker(serverName);
  
  return {
    errorType: errorInfo.type,
    errorMessage: errorInfo.message,
    userMessage: errorInfo.userMessage,
    severity: errorInfo.severity,
    retryable: errorInfo.retryable,
    circuitBreakerState: breaker.state,
    failureCount: breaker.failureCount,
    lastFailureTime: breaker.lastFailureTime,
    nextRetryTime: breaker.nextRetryTime
  };
}

/**
 * すべてのサーキットブレーカーをリセット
 */
export function resetAllCircuitBreakers(): void {
  circuitBreakers.clear();
  console.error('すべてのサーキットブレーカーをリセットしました。');
}

/**
 * 特定のサーバーのサーキットブレーカーをリセット
 */
export function resetCircuitBreaker(serverName: string): void {
  circuitBreakers.delete(serverName);
  console.error(`[${serverName}] サーキットブレーカーをリセットしました。`);
}