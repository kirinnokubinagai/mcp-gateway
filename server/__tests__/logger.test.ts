import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger, LogLevel, logPerformance } from '../logger.js';
import fs from 'fs';
import path from 'path';

describe('Logger', () => {
  let logger: ReturnType<typeof createLogger>;
  const logDir = path.join(process.cwd(), 'logs');

  beforeEach(() => {
    // ログレベルをDEBUGに設定
    process.env.LOG_LEVEL = 'DEBUG';
    logger = createLogger({ module: 'TestModule' });
  });

  afterEach(async () => {
    // ログをフラッシュ
    await (logger as any).parent.flush();
  });

  describe('ログレベル', () => {
    it('DEBUGレベルですべてのログが出力される', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.debug('デバッグメッセージ');
      logger.info('情報メッセージ');
      logger.warn('警告メッセージ');
      logger.error('エラーメッセージ');

      expect(consoleSpy).toHaveBeenCalledTimes(4);
      consoleSpy.mockRestore();
    });

    it('INFOレベルでDEBUGログが出力されない', () => {
      process.env.LOG_LEVEL = 'INFO';
      const testLogger = createLogger({ module: 'TestModule' });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      testLogger.debug('デバッグメッセージ');
      testLogger.info('情報メッセージ');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });
  });

  describe('コンテキスト情報', () => {
    it('モジュール情報が含まれる', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.info('テストメッセージ');

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('TestModule');
      consoleSpy.mockRestore();
    });

    it('追加のコンテキストがマージされる', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.info('テストメッセージ', { userId: 123, action: 'test' });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('123');
      expect(output).toContain('test');
      consoleSpy.mockRestore();
    });

    it('子ロガーのコンテキストが継承される', () => {
      const childLogger = logger.child({ requestId: 'req-123' });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      childLogger.info('子ロガーメッセージ', { additional: 'data' });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('TestModule');
      expect(output).toContain('req-123');
      expect(output).toContain('data');
      consoleSpy.mockRestore();
    });
  });

  describe('エラー処理', () => {
    it('エラーオブジェクトが正しく記録される', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = new Error('テストエラー');

      logger.error('エラーが発生しました', error);

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('エラーが発生しました');
      expect(output).toContain('テストエラー');
      consoleSpy.mockRestore();
    });

    it('エラーのスタックトレースが含まれる', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = new Error('スタックトレーステスト');

      logger.error('エラー', error);

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('Error: スタックトレーステスト');
      consoleSpy.mockRestore();
    });
  });

  describe('パフォーマンス計測', () => {
    it('タイマーが正しく動作する', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const timer = logger.startTimer('テスト処理');

      // 少し待機
      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = timer();
      logger.performance('処理完了', metrics);

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('処理完了');
      expect(metrics.duration).toBeGreaterThan(90);
      expect(metrics.memory).toBeDefined();
      expect(metrics.cpu).toBeDefined();
      consoleSpy.mockRestore();
    });

    it('閾値を超えた場合に警告レベルで出力される', () => {
      process.env.LOG_PERF_THRESHOLD = '50';
      const testLogger = createLogger({ module: 'PerfTest' });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      testLogger.performance('遅い処理', {
        duration: 100,
        memory: { used: 1000, total: 2000 },
      });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('[WARN]');
      expect(output).toContain('処理時間が閾値');
      consoleSpy.mockRestore();
    });
  });

  describe('相関ID', () => {
    it('相関IDが正しく設定される', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await logger.withCorrelationId('test-correlation-id', async () => {
        logger.info('相関IDテスト');
      });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('test-correlation-id');
      consoleSpy.mockRestore();
    });

    it('ネストされた相関IDが維持される', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await logger.withCorrelationId('outer-id', async () => {
        logger.info('外側のログ');

        await logger.withCorrelationId('inner-id', async () => {
          logger.info('内側のログ');
        });
      });

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      const outerOutput = consoleSpy.mock.calls[0][0];
      const innerOutput = consoleSpy.mock.calls[1][0];

      expect(outerOutput).toContain('outer-id');
      expect(innerOutput).toContain('inner-id');
      consoleSpy.mockRestore();
    });
  });

  describe('ファイル出力', () => {
    it('ログディレクトリが作成される', () => {
      expect(fs.existsSync(logDir)).toBe(true);
    });

    it('ログファイルが作成される', async () => {
      logger.info('ファイル出力テスト');

      // フラッシュして書き込みを確実に
      await (logger as any).parent.flush();

      const files = fs.readdirSync(logDir);
      const logFiles = files.filter((f) => f.startsWith('mcp-gateway-') && f.endsWith('.log'));
      expect(logFiles.length).toBeGreaterThan(0);
    });
  });

  describe('デコレーター', () => {
    it('logPerformanceデコレーターが動作する', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      class TestService {
        @logPerformance('テストメソッド')
        async testMethod() {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 'result';
        }
      }

      const service = new TestService();
      const result = await service.testMethod();

      expect(result).toBe('result');
      expect(consoleSpy).toHaveBeenCalled();

      const output = consoleSpy.mock.calls.find((call) => call[0].includes('テストメソッド 完了'));
      expect(output).toBeDefined();
      consoleSpy.mockRestore();
    });

    it('エラー時もパフォーマンスが記録される', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      class TestService {
        @logPerformance('エラーメソッド')
        async errorMethod() {
          await new Promise((resolve) => setTimeout(resolve, 50));
          throw new Error('テストエラー');
        }
      }

      const service = new TestService();

      await expect(service.errorMethod()).rejects.toThrow('テストエラー');

      const errorOutput = consoleSpy.mock.calls.find((call) =>
        call[0].includes('エラーメソッド エラー')
      );
      expect(errorOutput).toBeDefined();
      consoleSpy.mockRestore();
    });
  });

  describe('カラー出力', () => {
    it('ログレベルごとに異なる色が使用される', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.debug('デバッグ');
      logger.info('情報');
      logger.warn('警告');
      logger.error('エラー');

      const outputs = consoleSpy.mock.calls.map((call) => call[0]);

      // ANSIカラーコードの確認
      expect(outputs[0]).toContain('\x1b[36m'); // Cyan for DEBUG
      expect(outputs[1]).toContain('\x1b[32m'); // Green for INFO
      expect(outputs[2]).toContain('\x1b[33m'); // Yellow for WARN
      expect(outputs[3]).toContain('\x1b[31m'); // Red for ERROR

      consoleSpy.mockRestore();
    });
  });
});
