import { createLogger } from './logger.js';

const logger = createLogger({ module: 'ErrorHandler' });

export enum ErrorType {
  // 一時的なエラー（リトライ可能）
  TIMEOUT = 'timeout',
  CONNECTION_REFUSED = 'connection_refused',
  NETWORK_ERROR = 'network_error',
  CONTAINER_STOPPED = 'container_stopped',
  
  // 永続的なエラー（リトライ不可）
  COMMAND_NOT_FOUND = 'command_not_found',
  PACKAGE_NOT_FOUND = 'package_not_found',
  PERMISSION_DENIED = 'permission_denied',
  INVALID_CONFIG = 'invalid_config',
  
  // 不明なエラー
  UNKNOWN = 'unknown'
}

export interface ErrorInfo {
  type: ErrorType;
  message: string;
  originalError?: Error;
  retryable: boolean;
  suggestedAction?: string;
}

export class ErrorHandler {
  private static errorCounts = new Map<string, number>();
  private static lastErrorTime = new Map<string, number>();
  private static circuitBreakerState = new Map<string, 'closed' | 'open' | 'half-open'>();
  
  // サーキットブレーカーの設定
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5; // エラー回数の閾値
  private static readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 60秒後に半開状態に
  private static readonly ERROR_WINDOW = 30000; // 30秒以内のエラーをカウント
  
  static classifyError(error: Error | string): ErrorInfo {
    const errorMessage = typeof error === 'string' ? error : error.message;
    
    // タイムアウトエラー
    if (errorMessage.includes('タイムアウト') || errorMessage.includes('timeout')) {
      return {
        type: ErrorType.TIMEOUT,
        message: '接続がタイムアウトしました',
        originalError: error instanceof Error ? error : undefined,
        retryable: true,
        suggestedAction: 'ネットワーク接続を確認し、しばらく待ってから再試行してください'
      };
    }
    
    // 接続拒否エラー
    if (errorMessage.includes('ECONNREFUSED')) {
      return {
        type: ErrorType.CONNECTION_REFUSED,
        message: 'サーバーへの接続が拒否されました',
        originalError: error instanceof Error ? error : undefined,
        retryable: true,
        suggestedAction: 'プロキシサーバーが起動しているか確認してください'
      };
    }
    
    // コマンドが見つからない
    if (errorMessage.includes('spawn') || errorMessage.includes('ENOENT')) {
      return {
        type: ErrorType.COMMAND_NOT_FOUND,
        message: 'コマンドが見つかりません',
        originalError: error instanceof Error ? error : undefined,
        retryable: false,
        suggestedAction: 'コマンドがインストールされているか確認してください'
      };
    }
    
    // パッケージが見つからない
    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      return {
        type: ErrorType.PACKAGE_NOT_FOUND,
        message: 'パッケージが見つかりません',
        originalError: error instanceof Error ? error : undefined,
        retryable: false,
        suggestedAction: 'パッケージ名が正しいか確認してください'
      };
    }
    
    // 権限エラー
    if (errorMessage.includes('permission') || errorMessage.includes('EACCES')) {
      return {
        type: ErrorType.PERMISSION_DENIED,
        message: '権限がありません',
        originalError: error instanceof Error ? error : undefined,
        retryable: false,
        suggestedAction: 'コマンドの実行権限を確認してください'
      };
    }
    
    // コンテナ停止
    if (errorMessage.includes('コンテナが終了') || errorMessage.includes('container stopped')) {
      return {
        type: ErrorType.CONTAINER_STOPPED,
        message: 'Dockerコンテナが停止しました',
        originalError: error instanceof Error ? error : undefined,
        retryable: true,
        suggestedAction: 'コンテナを再起動してください'
      };
    }
    
    // 不明なエラー
    return {
      type: ErrorType.UNKNOWN,
      message: errorMessage,
      originalError: error instanceof Error ? error : undefined,
      retryable: true,
      suggestedAction: 'エラーログを確認してください'
    };
  }
  
  static shouldRetry(serverName: string, errorInfo: ErrorInfo): boolean {
    if (!errorInfo.retryable) {
      return false;
    }
    
    // サーキットブレーカーチェック
    const state = this.circuitBreakerState.get(serverName);
    if (state === 'open') {
      const lastError = this.lastErrorTime.get(serverName) || 0;
      if (Date.now() - lastError > this.CIRCUIT_BREAKER_TIMEOUT) {
        // タイムアウト経過後は半開状態に
        this.circuitBreakerState.set(serverName, 'half-open');
        return true;
      }
      return false;
    }
    
    return true;
  }
  
  static recordError(serverName: string, errorInfo: ErrorInfo) {
    const now = Date.now();
    const lastError = this.lastErrorTime.get(serverName) || 0;
    
    // エラーウィンドウ内のエラーのみカウント
    if (now - lastError > this.ERROR_WINDOW) {
      this.errorCounts.set(serverName, 1);
    } else {
      const count = (this.errorCounts.get(serverName) || 0) + 1;
      this.errorCounts.set(serverName, count);
      
      // 閾値を超えたらサーキットブレーカーを開く
      if (count >= this.CIRCUIT_BREAKER_THRESHOLD) {
        this.circuitBreakerState.set(serverName, 'open');
        logger.error(`サーキットブレーカー開放: ${serverName}`, undefined, { serverName, errorCount: count });
      }
    }
    
    this.lastErrorTime.set(serverName, now);
  }
  
  static recordSuccess(serverName: string) {
    // 成功時はカウンターをリセット
    this.errorCounts.delete(serverName);
    this.lastErrorTime.delete(serverName);
    
    // サーキットブレーカーが半開状態なら閉じる
    if (this.circuitBreakerState.get(serverName) === 'half-open') {
      this.circuitBreakerState.set(serverName, 'closed');
      logger.info(`サーキットブレーカー閉鎖: ${serverName}`, { serverName });
    }
  }
  
  static getRetryDelay(serverName: string, attemptNumber: number): number {
    // 指数バックオフ: 2^n * 1000ms (最大30秒)
    const baseDelay = Math.min(Math.pow(2, attemptNumber) * 1000, 30000);
    
    // ジッター追加（±20%）
    const jitter = baseDelay * 0.2 * (Math.random() - 0.5);
    
    return Math.round(baseDelay + jitter);
  }
  
  static formatErrorMessage(serverName: string, errorInfo: ErrorInfo): string {
    const parts = [`[${serverName}] ${errorInfo.message}`];
    
    if (errorInfo.suggestedAction) {
      parts.push(`対処法: ${errorInfo.suggestedAction}`);
    }
    
    const state = this.circuitBreakerState.get(serverName);
    if (state === 'open') {
      parts.push('注意: 多数のエラーのため一時的に接続を停止しています');
    }
    
    return parts.join('\n');
  }
  
  static getCircuitBreakerStatus(serverName: string): 'closed' | 'open' | 'half-open' {
    return this.circuitBreakerState.get(serverName) || 'closed';
  }
  
  static resetCircuitBreaker(serverName: string): void {
    this.errorCounts.delete(serverName);
    this.lastErrorTime.delete(serverName);
    this.circuitBreakerState.delete(serverName);
    logger.info(`サーキットブレーカーをリセット: ${serverName}`, { serverName });
  }
  
  static resetAllCircuitBreakers(): void {
    this.errorCounts.clear();
    this.lastErrorTime.clear();
    this.circuitBreakerState.clear();
    logger.info('すべてのサーキットブレーカーをリセット');
  }
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * エラー情報を作成する
 */
export function createErrorInfo(error: Error | string, serverName?: string): ErrorInfo {
  return ErrorHandler.classifyError(error);
}

/**
 * 復旧戦略を実行する
 */
export async function executeRecoveryStrategy(
  serverName: string,
  errorInfo: ErrorInfo,
  retryCount: number,
  retryCallback: () => Promise<void>
): Promise<void> {
  if (!ErrorHandler.shouldRetry(serverName, errorInfo)) {
    logger.warn(`リトライ不可: ${serverName}`, { serverName, errorType: errorInfo.type });
    return;
  }
  
  const delay = ErrorHandler.getRetryDelay(serverName, retryCount);
  logger.info(`${delay}ms後に再接続を試行: ${serverName}`, { serverName, delay, retryCount });
  
  setTimeout(async () => {
    try {
      await retryCallback();
    } catch (error) {
      logger.error(`再接続失敗: ${serverName}`, error, { serverName });
    }
  }, delay);
}

/**
 * 成功を記録する
 */
export function recordSuccess(serverName: string): void {
  ErrorHandler.recordSuccess(serverName);
}

/**
 * 失敗を記録する
 */
export function recordFailure(serverName: string, errorInfo: ErrorInfo): void {
  ErrorHandler.recordError(serverName, errorInfo);
}

/**
 * エラーステータスを取得する
 */
export function getErrorStatus(serverName: string, error: string): {
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  errorCount: number;
  lastErrorTime?: number;
  retryable: boolean;
} {
  const errorInfo = createErrorInfo(error, serverName);
  const circuitBreakerState = ErrorHandler.getCircuitBreakerStatus(serverName);
  
  return {
    circuitBreakerState,
    errorCount: (ErrorHandler as any).errorCounts.get(serverName) || 0,
    lastErrorTime: (ErrorHandler as any).lastErrorTime.get(serverName),
    retryable: errorInfo.retryable
  };
}

/**
 * サーキットブレーカーをリセットする
 */
export function resetCircuitBreaker(serverName: string): void {
  ErrorHandler.resetCircuitBreaker(serverName);
}

/**
 * すべてのサーキットブレーカーをリセットする
 */
export function resetAllCircuitBreakers(): void {
  ErrorHandler.resetAllCircuitBreakers();
}