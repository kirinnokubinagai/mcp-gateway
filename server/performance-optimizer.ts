/**
 * MCP Gateway パフォーマンス最適化モジュール
 *
 * このモジュールは以下の最適化を提供します:
 * 1. 非同期処理の最適化
 * 2. メモリ使用量の削減
 * 3. 起動処理の並列化
 * 4. キャッシュの実装
 * 5. 遅延読み込み
 */

import { performance } from 'perf_hooks';
import { LRUCache } from 'lru-cache';
import { setImmediate as setImmediatePromise } from 'timers/promises';
import { createLogger } from './logger.ts';

const logger = createLogger({ module: 'PerformanceOptimizer' });

/**
 * パフォーマンス測定用デコレータ
 */
export function measurePerformance(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    const start = performance.now();
    const memStart = process.memoryUsage();

    try {
      const result = await originalMethod.apply(this, args);
      const duration = performance.now() - start;
      const memEnd = process.memoryUsage();
      const memDelta = {
        heapUsed: memEnd.heapUsed - memStart.heapUsed,
        external: memEnd.external - memStart.external,
      };

      if (duration > 100) {
        // 100ms以上かかった場合のみログ
        logger.performance(`${propertyKey} 実行完了`, {
          duration,
          memory: {
            used: memDelta.heapUsed,
            total: memEnd.heapTotal,
          },
        });
      }

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      logger.error(`パフォーマンス計測中にエラー発生`, error as Error, {
        method: propertyKey,
        duration,
      });
      throw error;
    }
  };

  return descriptor;
}

/**
 * バッチ処理用ユーティリティ
 */
export class BatchProcessor<T, R> {
  private queue: Array<{
    item: T;
    resolve: (value: R) => void;
    reject: (error: any) => void;
  }> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private processor: (items: T[]) => Promise<R[]>,
    private batchSize: number = 10,
    private delayMs: number = 10
  ) {}

  async process(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });

      if (this.queue.length >= this.batchSize) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.delayMs);
      }
    });
  }

  private async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.batchSize);
    const items = batch.map((b) => b.item);

    try {
      const results = await this.processor(items);
      batch.forEach((b, i) => {
        const result = results[i];
        if (result !== undefined) {
          b.resolve(result);
        } else {
          b.reject(new Error(`バッチ処理の結果が不正です: index ${i}`));
        }
      });
    } catch (error) {
      batch.forEach((b) => b.reject(error));
    }
  }
}

/**
 * 接続プール管理
 */
export class ConnectionPool<T> {
  private available: T[] = [];
  private inUse = new Set<T>();
  private waiting: Array<(conn: T) => void> = [];

  constructor(
    private factory: () => Promise<T>,
    private destroyer: (conn: T) => Promise<void>,
    private maxSize: number = 10,
    private minSize: number = 2
  ) {
    // 最小接続数を事前に作成
    this.initialize();
  }

  private async initialize() {
    const promises = Array(this.minSize)
      .fill(null)
      .map(() => this.createConnection());
    await Promise.all(promises);
  }

  private async createConnection(): Promise<T> {
    const conn = await this.factory();
    this.available.push(conn);
    return conn;
  }

  async acquire(): Promise<T> {
    // 利用可能な接続があればすぐに返す
    if (this.available.length > 0) {
      const conn = this.available.pop()!;
      this.inUse.add(conn);
      return conn;
    }

    // プールサイズに余裕があれば新規作成
    if (this.inUse.size < this.maxSize) {
      const conn = await this.factory();
      this.inUse.add(conn);
      return conn;
    }

    // 接続が開放されるのを待つ
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  async release(conn: T) {
    this.inUse.delete(conn);

    // 待機中のリクエストがあれば渡す
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      this.inUse.add(conn);
      resolve(conn);
      return;
    }

    // プールに戻す
    this.available.push(conn);

    // 最大保持数を超えたら破棄
    if (this.available.length > this.minSize) {
      const excess = this.available.pop()!;
      await this.destroyer(excess).catch((error) =>
        logger.error(`リソースプール破棄エラー`, error as Error)
      );
    }
  }

  async destroy() {
    // すべての接続を破棄
    const allConnections = [...this.available, ...this.inUse];
    await Promise.all(allConnections.map((conn) => this.destroyer(conn)));
    this.available = [];
    this.inUse.clear();
    this.waiting = [];
  }
}

/**
 * 設定キャッシュ
 */
export class ConfigCache {
  private cache: LRUCache<string, any>;
  private fileWatchers = new Map<string, any>();

  constructor(maxSize: number = 100, ttl: number = 60000) {
    this.cache = new LRUCache({
      max: maxSize,
      ttl: ttl,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });
  }

  get(key: string): any | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: any, ttl?: number): void {
    if (ttl) {
      this.cache.set(key, value, { ttl });
    } else {
      this.cache.set(key, value);
    }
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // ファイル変更監視と自動キャッシュ無効化
  watchFile(filePath: string, key: string): void {
    if (this.fileWatchers.has(filePath)) return;

    const { watch } = require('fs');
    const watcher = watch(filePath, () => {
      this.delete(key);
      logger.info(`ファイル変更検出によりキャッシュをクリア`, {
        filePath,
        cacheKey: key,
      });
    });

    this.fileWatchers.set(filePath, watcher);
  }

  stopWatching(filePath: string): void {
    const watcher = this.fileWatchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(filePath);
    }
  }

  destroy(): void {
    this.clear();
    for (const [path, watcher] of this.fileWatchers) {
      watcher.close();
    }
    this.fileWatchers.clear();
  }
}

/**
 * 並列実行ヘルパー
 */
export class ParallelExecutor {
  static async mapConcurrent<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
    concurrency: number = 5
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const executing: Promise<void>[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === undefined) continue;

      const promise = mapper(item, i).then((result) => {
        results[i] = result;
      });

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        const index = executing.findIndex((p) => p === promise);
        if (index !== -1) {
          executing.splice(index, 1);
        }
      }
    }

    await Promise.all(executing);
    return results;
  }

  static async *mapConcurrentGenerator<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
    concurrency: number = 5
  ): AsyncGenerator<R> {
    const queue = items.map((item, index) => ({ item, index }));
    const executing = new Map<number, Promise<R>>();

    while (queue.length > 0 || executing.size > 0) {
      // キューから取り出して実行
      while (queue.length > 0 && executing.size < concurrency) {
        const next = queue.shift();
        if (!next) break;
        const { item, index } = next;
        const promise = mapper(item, index);
        executing.set(index, promise);
      }

      // 完了を待つ
      if (executing.size > 0) {
        const [index, result] = await Promise.race(
          Array.from(executing.entries()).map(async ([idx, promise]) => {
            const res = await promise;
            return [idx, res] as [number, R];
          })
        );

        executing.delete(index);
        yield result;
      }
    }
  }
}

/**
 * メモリ管理ヘルパー
 */
export class MemoryManager {
  private static readonly MEMORY_CHECK_INTERVAL = 30000; // 30秒
  private static readonly MEMORY_THRESHOLD = 0.85; // 85%
  private static timer: NodeJS.Timeout | null = null;
  private static callbacks: Array<() => Promise<void>> = [];

  static startMonitoring() {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.checkMemory();
    }, this.MEMORY_CHECK_INTERVAL);
  }

  static stopMonitoring() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  static onHighMemory(callback: () => Promise<void>) {
    this.callbacks.push(callback);
  }

  private static async checkMemory() {
    const usage = process.memoryUsage();
    const heapUsedRatio = usage.heapUsed / usage.heapTotal;

    if (heapUsedRatio > this.MEMORY_THRESHOLD) {
      logger.warn(`高メモリ使用率を検出`, {
        usagePercent: (heapUsedRatio * 100).toFixed(1),
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
      });

      // ガベージコレクションを強制実行
      if (global.gc) {
        global.gc();
        logger.info(`ガベージコレクション実行`);
      }

      // コールバックを実行
      await Promise.all(
        this.callbacks.map((cb) =>
          cb().catch((error) => logger.error(`メモリ管理コールバックエラー`, error as Error))
        )
      );
    }
  }

  static getMemoryInfo() {
    const usage = process.memoryUsage();
    return {
      heapUsed: (usage.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
      heapTotal: (usage.heapTotal / 1024 / 1024).toFixed(2) + 'MB',
      external: (usage.external / 1024 / 1024).toFixed(2) + 'MB',
      rss: (usage.rss / 1024 / 1024).toFixed(2) + 'MB',
      heapUsedRatio: ((usage.heapUsed / usage.heapTotal) * 100).toFixed(1) + '%',
    };
  }
}

/**
 * 遅延初期化ヘルパー
 */
export class LazyInitializer<T> {
  private value?: T;
  private initializing = false;
  private initPromise?: Promise<T>;

  constructor(private initializer: () => Promise<T>) {}

  async get(): Promise<T> {
    if (this.value !== undefined) {
      return this.value;
    }

    if (this.initializing) {
      return this.initPromise!;
    }

    this.initializing = true;
    this.initPromise = this.initializer();

    try {
      this.value = await this.initPromise;
      return this.value;
    } finally {
      this.initializing = false;
    }
  }

  isInitialized(): boolean {
    return this.value !== undefined;
  }

  reset(): void {
    this.value = undefined;
    this.initializing = false;
    this.initPromise = undefined;
  }
}

/**
 * デバウンス付き関数実行
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function (this: any, ...args: Parameters<T>) {
    const context = this;
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      func.apply(context, args);
    }, wait);
  };
}

/**
 * スロットリング付き関数実行
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function (this: any, ...args: Parameters<T>) {
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * 非同期キュー
 */
export class AsyncQueue<T> {
  private queue: T[] = [];
  private processing = false;
  private processor?: (item: T) => Promise<void>;

  constructor(processor?: (item: T) => Promise<void>) {
    this.processor = processor;
  }

  push(item: T): void {
    this.queue.push(item);
    if (this.processor && !this.processing) {
      this.process();
    }
  }

  async pop(): Promise<T | undefined> {
    return this.queue.shift();
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }

  private async process() {
    if (!this.processor || this.processing) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await this.processor(item);
      } catch (error) {
        logger.error(`非同期キュー処理エラー`, error as Error);
      }

      // CPUを他のタスクに譲る
      await setImmediatePromise();
    }

    this.processing = false;
  }
}

// グローバルインスタンス
export const configCache = new ConfigCache();
export const memoryManager = MemoryManager;

// 起動時にメモリ監視を開始
memoryManager.startMonitoring();

// プロセス終了時のクリーンアップ
process.on('exit', () => {
  memoryManager.stopMonitoring();
  configCache.destroy();
});
