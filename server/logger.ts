import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AsyncLocalStorage } from 'async_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogContext {
  [key: string]: any;
}

export interface PerformanceMetrics {
  duration: number;
  memory?: {
    used: number;
    total: number;
  };
  cpu?: {
    user: number;
    system: number;
  };
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  performance?: PerformanceMetrics;
  correlationId?: string;
  source?: {
    file?: string;
    line?: number;
    method?: string;
  };
}

// 非同期コンテキストストレージ（リクエストトレーシング用）
const asyncLocalStorage = new AsyncLocalStorage<{ correlationId: string }>();

class Logger {
  private level: LogLevel;
  private logDir: string;
  private fileStream?: ReturnType<typeof createWriteStream>;
  private currentLogFile?: string;
  private maxFileSize: number;
  private maxFiles: number;
  private writeQueue: string[] = [];
  private isWriting = false;
  private performanceThreshold: number;

  constructor() {
    this.level = this.parseLogLevel(process.env.LOG_LEVEL || 'INFO');
    this.logDir = join(dirname(__dirname), 'logs');
    this.maxFileSize = parseInt(process.env.LOG_MAX_SIZE || '10485760'); // 10MB
    this.maxFiles = parseInt(process.env.LOG_MAX_FILES || '5');
    this.performanceThreshold = parseInt(process.env.LOG_PERF_THRESHOLD || '1000'); // 1秒

    this.ensureLogDirectory();
    this.initializeFileStream();

    // 定期的にキューをフラッシュ
    setInterval(() => this.flushQueue(), 1000);
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level.toUpperCase()) {
      case 'DEBUG':
        return LogLevel.DEBUG;
      case 'INFO':
        return LogLevel.INFO;
      case 'WARN':
        return LogLevel.WARN;
      case 'ERROR':
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  private ensureLogDirectory(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private initializeFileStream(): void {
    const logFileName = `mcp-gateway-${new Date().toISOString().split('T')[0]}.log`;
    this.currentLogFile = join(this.logDir, logFileName);

    this.fileStream = createWriteStream(this.currentLogFile, { flags: 'a' });
  }

  private rotateLogFile(): void {
    if (!this.currentLogFile || !existsSync(this.currentLogFile)) {
      return;
    }

    const stats = statSync(this.currentLogFile);
    if (stats.size < this.maxFileSize) {
      return;
    }

    if (this.fileStream) {
      this.fileStream.end();
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedFileName = `mcp-gateway-${timestamp}.log`;
    const rotatedFilePath = join(this.logDir, rotatedFileName);

    const fs = require('fs');
    fs.renameSync(this.currentLogFile, rotatedFilePath);

    this.cleanupOldLogs();
    this.initializeFileStream();
  }

  private cleanupOldLogs(): void {
    const fs = require('fs');
    const files = fs
      .readdirSync(this.logDir)
      .filter((file: string) => file.startsWith('mcp-gateway-') && file.endsWith('.log'))
      .map((file: string) => ({
        name: file,
        path: join(this.logDir, file),
        mtime: fs.statSync(join(this.logDir, file)).mtime,
      }))
      .sort((a: any, b: any) => b.mtime.getTime() - a.mtime.getTime());

    if (files.length > this.maxFiles) {
      files.slice(this.maxFiles).forEach((file: any) => {
        fs.unlinkSync(file.path);
      });
    }
  }

  private formatLogEntry(
    level: string,
    message: string,
    context?: LogContext,
    error?: Error,
    performance?: PerformanceMetrics
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    // 相関IDを追加
    const store = asyncLocalStorage.getStore();
    if (store?.correlationId) {
      entry.correlationId = store.correlationId;
    }

    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }

    if (error) {
      entry.error = {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      };
    }

    if (performance) {
      entry.performance = performance;
    }

    // ソース情報を追加（デバッグ時のみ）
    if (this.level <= LogLevel.DEBUG) {
      const stack = new Error().stack;
      if (stack) {
        const lines = stack.split('\n');
        const callerLine = lines[4]; // formatLogEntry -> writeLog -> debug/info/warn/error -> 呼び出し元
        const match = callerLine?.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);
        if (match) {
          entry.source = {
            method: match[1],
            file: match[2],
            line: parseInt(match[3]),
          };
        }
      }
    }

    return entry;
  }

  private writeLog(entry: LogEntry): void {
    const logString = JSON.stringify(entry);

    // コンソール出力
    const coloredOutput = this.colorizeOutput(entry);
    console.error(coloredOutput);

    // ファイル出力をキューに追加（非同期）
    if (this.fileStream) {
      this.writeQueue.push(logString);
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isWriting || this.writeQueue.length === 0) {
      return;
    }

    this.isWriting = true;

    try {
      // ローテーションチェック
      this.rotateLogFile();

      // バッチ書き込み
      const batch = this.writeQueue.splice(0, 100); // 最大100行ずつ
      const data = batch.join('\n') + '\n';

      await new Promise<void>((resolve, reject) => {
        this.fileStream!.write(data, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (error) {
      console.error('ログ書き込みエラー:', error);
    } finally {
      this.isWriting = false;

      // まだキューにデータがある場合は再処理
      if (this.writeQueue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  private flushQueue(): void {
    if (this.writeQueue.length > 0 && !this.isWriting) {
      this.processQueue();
    }
  }

  private colorizeOutput(entry: LogEntry): string {
    const colors: { [key: string]: string } = {
      DEBUG: '\x1b[36m', // Cyan
      INFO: '\x1b[32m', // Green
      WARN: '\x1b[33m', // Yellow
      ERROR: '\x1b[31m', // Red
      RESET: '\x1b[0m',
    };

    const color = colors[entry.level] || colors.RESET;
    let output = `${color}[${entry.timestamp}] [${entry.level}]${colors.RESET} ${entry.message}`;

    if (entry.context) {
      output += ` ${JSON.stringify(entry.context)}`;
    }

    if (entry.error) {
      output += `\n${colors.ERROR}Error: ${entry.error.message}${colors.RESET}`;
      if (entry.error.stack) {
        output += `\n${entry.error.stack}`;
      }
    }

    return output;
  }

  public debug(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.DEBUG) {
      const entry = this.formatLogEntry('DEBUG', message, context);
      this.writeLog(entry);
    }
  }

  public info(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.INFO) {
      const entry = this.formatLogEntry('INFO', message, context);
      this.writeLog(entry);
    }
  }

  public warn(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.WARN) {
      const entry = this.formatLogEntry('WARN', message, context);
      this.writeLog(entry);
    }
  }

  public error(message: string, error?: Error | any, context?: LogContext): void {
    if (this.level <= LogLevel.ERROR) {
      const entry = this.formatLogEntry('ERROR', message, context, error);
      this.writeLog(entry);
    }
  }

  public performance(message: string, metrics: PerformanceMetrics, context?: LogContext): void {
    if (this.level <= LogLevel.INFO && metrics.duration >= this.performanceThreshold) {
      const perfContext = {
        ...context,
        performanceWarning: `処理時間が閾値（${this.performanceThreshold}ms）を超えました`,
      };
      const entry = this.formatLogEntry('WARN', message, perfContext, undefined, metrics);
      this.writeLog(entry);
    } else if (this.level <= LogLevel.DEBUG) {
      const entry = this.formatLogEntry('DEBUG', message, context, undefined, metrics);
      this.writeLog(entry);
    }
  }

  public startTimer(): () => PerformanceMetrics {
    const startTime = process.hrtime.bigint();
    const startMemory = process.memoryUsage();
    const startCpu = process.cpuUsage();

    return () => {
      const endTime = process.hrtime.bigint();
      const endMemory = process.memoryUsage();
      const endCpu = process.cpuUsage(startCpu);

      const duration = Number(endTime - startTime) / 1_000_000; // ナノ秒からミリ秒へ

      return {
        duration,
        memory: {
          used: endMemory.heapUsed - startMemory.heapUsed,
          total: endMemory.heapTotal,
        },
        cpu: {
          user: endCpu.user / 1000, // マイクロ秒からミリ秒へ
          system: endCpu.system / 1000,
        },
      };
    };
  }

  public async withCorrelationId<T>(correlationId: string, fn: () => Promise<T>): Promise<T> {
    return asyncLocalStorage.run({ correlationId }, fn);
  }

  public flush(): Promise<void> {
    return new Promise((resolve) => {
      this.flushQueue();
      if (this.fileStream) {
        this.fileStream.end(() => {
          this.initializeFileStream();
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public child(context: LogContext): LoggerWithContext {
    return new LoggerWithContext(this, context);
  }
}

class LoggerWithContext {
  constructor(
    private parent: Logger,
    private context: LogContext
  ) {}

  private mergeContext(additionalContext?: LogContext): LogContext {
    return { ...this.context, ...additionalContext };
  }

  public debug(message: string, context?: LogContext): void {
    this.parent.debug(message, this.mergeContext(context));
  }

  public info(message: string, context?: LogContext): void {
    this.parent.info(message, this.mergeContext(context));
  }

  public warn(message: string, context?: LogContext): void {
    this.parent.warn(message, this.mergeContext(context));
  }

  public error(message: string, error?: Error | any, context?: LogContext): void {
    this.parent.error(message, error, this.mergeContext(context));
  }

  public performance(message: string, metrics: PerformanceMetrics, context?: LogContext): void {
    this.parent.performance(message, metrics, this.mergeContext(context));
  }

  public startTimer(): () => PerformanceMetrics {
    return this.parent.startTimer();
  }

  public async withCorrelationId<T>(correlationId: string, fn: () => Promise<T>): Promise<T> {
    return this.parent.withCorrelationId(correlationId, fn);
  }

  public child(additionalContext: LogContext): LoggerWithContext {
    return new LoggerWithContext(this.parent, this.mergeContext(additionalContext));
  }
}

export const logger = new Logger();

export function createLogger(context: LogContext): LoggerWithContext {
  return logger.child(context);
}

/**
 * パフォーマンス計測デコレーター
 *
 * メソッドの実行時間とリソース使用量を自動的に記録します。
 *
 * @example
 * class MyService {
 *   @logPerformance('データ取得')
 *   async fetchData() {
 *     // 処理
 *   }
 * }
 */
export function logPerformance(label?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const methodName = label || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      const timer = logger.startTimer();
      const correlationId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

      try {
        const result = await logger.withCorrelationId(correlationId, async () => {
          return await originalMethod.apply(this, args);
        });

        const metrics = timer();
        logger.performance(`${methodName} 完了`, metrics, {
          correlationId,
          args: args.length > 0 ? args : undefined,
        });

        return result;
      } catch (error) {
        const metrics = timer();
        logger.error(`${methodName} エラー`, error as Error, {
          correlationId,
          performance: metrics,
          args: args.length > 0 ? args : undefined,
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * グローバルエラーハンドラーを設定
 */
export function setupGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    logger.error('未処理の例外が発生しました', error, {
      type: 'uncaughtException',
    });
    logger.flush().then(() => {
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('未処理のPromise拒否が発生しました', reason as Error, {
      type: 'unhandledRejection',
      promise: promise.toString(),
    });
  });

  process.on('warning', (warning) => {
    logger.warn('プロセス警告', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });
}

/**
 * 環境変数でログレベルを変更するヘルパー関数
 */
export function setLogLevelFromEnv(): void {
  const level = process.env.LOG_LEVEL?.toUpperCase();
  if (level && level in LogLevel) {
    logger.setLevel(LogLevel[level as keyof typeof LogLevel]);
  }
}
