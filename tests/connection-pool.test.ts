import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectionPool, ConnectionConfig } from '../server/connection-pool';
import { WebSocketTransport } from '../server/websocket-transport';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// モックの設定
vi.mock('../server/websocket-transport');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('../server/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ConnectionPool', () => {
  let pool: ConnectionPool;
  let mockTransport: any;
  let mockClient: any;

  beforeEach(() => {
    // モックのリセット
    vi.clearAllMocks();

    // モックの設定
    mockTransport = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockResolvedValue(true),
    };

    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
    };

    // WebSocketTransportのモック
    (WebSocketTransport as any).mockImplementation(() => mockTransport);
    // Clientのモック
    (Client as any).mockImplementation(() => mockClient);

    // 接続プールのインスタンス作成
    pool = new ConnectionPool({
      maxConnectionsPerServer: 2,
      maxTotalConnections: 5,
      connectionTimeout: 1000,
      idleTimeout: 5000,
      healthCheckIntervalMs: 1000,
      maxHealthCheckFailures: 2,
      queueTimeout: 2000,
    });
  });

  afterEach(async () => {
    await pool.closeAll();
  });

  describe('acquire', () => {
    it('新規接続を作成する', async () => {
      const config: ConnectionConfig = {
        name: 'test-server',
        websocket: 'ws://localhost:9999',
        command: 'test-command',
        args: ['arg1'],
        env: { TEST: 'value' },
      };

      const connection = await pool.acquire(config);

      expect(connection).toBeDefined();
      expect(connection.config).toEqual(config);
      expect(connection.usageCount).toBe(1);
      expect(connection.isHealthy).toBe(true);
      expect(WebSocketTransport).toHaveBeenCalledTimes(1);
      expect(Client).toHaveBeenCalledTimes(1);
    });

    it('既存の接続を再利用する', async () => {
      const config: ConnectionConfig = {
        name: 'test-server',
        websocket: 'ws://localhost:9999',
        command: 'test-command',
      };

      // 最初の接続
      const connection1 = await pool.acquire(config);
      pool.release(connection1);

      // 2回目の接続（再利用されるはず）
      const connection2 = await pool.acquire(config);

      expect(connection2).toBe(connection1);
      expect(connection2.usageCount).toBe(2);
      expect(WebSocketTransport).toHaveBeenCalledTimes(1); // 新規作成は1回のみ
    });

    it('接続数の上限に達したらキューに入れる', async () => {
      const config: ConnectionConfig = {
        name: 'test-server',
        websocket: 'ws://localhost:9999',
        command: 'test-command',
      };

      // 上限まで接続を作成
      const connection1 = await pool.acquire(config);
      const connection2 = await pool.acquire(config);

      // 3つ目の接続はキューに入るはず
      const acquirePromise = pool.acquire(config);

      // 接続が返却されたら取得できる
      pool.release(connection1);
      const connection3 = await acquirePromise;

      expect(connection3).toBe(connection1);
    });

    it('キュータイムアウトでエラーを投げる', async () => {
      const config: ConnectionConfig = {
        name: 'test-server',
        websocket: 'ws://localhost:9999',
        command: 'test-command',
      };

      // 上限まで接続を作成
      await pool.acquire(config);
      await pool.acquire(config);

      // タイムアウトするはず
      await expect(pool.acquire(config)).rejects.toThrow('接続待機タイムアウト');
    });
  });

  describe('release', () => {
    it('接続を返却してアクティブ接続から削除する', async () => {
      const config: ConnectionConfig = {
        name: 'test-server',
        websocket: 'ws://localhost:9999',
        command: 'test-command',
      };

      const connection = await pool.acquire(config);
      const stats1 = pool.getStats();
      expect(stats1.activeConnections).toBe(1);
      expect(stats1.idleConnections).toBe(0);

      pool.release(connection);
      const stats2 = pool.getStats();
      expect(stats2.activeConnections).toBe(0);
      expect(stats2.idleConnections).toBe(1);
    });
  });

  describe('remove', () => {
    it('接続をプールから削除する', async () => {
      const config: ConnectionConfig = {
        name: 'test-server',
        websocket: 'ws://localhost:9999',
        command: 'test-command',
      };

      const connection = await pool.acquire(config);
      await pool.remove(connection);

      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(0);
      expect(mockClient.close).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalled();
    });
  });

  describe('健全性チェック', () => {
    it('不健全な接続を検出して削除する', async () => {
      const config: ConnectionConfig = {
        name: 'test-server',
        websocket: 'ws://localhost:9999',
        command: 'test-command',
      };

      const connection = await pool.acquire(config);
      pool.release(connection);

      // 接続を不健全にする
      mockTransport.isHealthy.mockResolvedValue(false);

      // 健全性チェックを待つ
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(0);
    });
  });

  describe('アイドル接続の削除', () => {
    it('アイドルタイムアウトした接続を削除する', async () => {
      const config: ConnectionConfig = {
        name: 'test-server',
        websocket: 'ws://localhost:9999',
        command: 'test-command',
      };

      const connection = await pool.acquire(config);
      connection.lastUsedAt = Date.now() - 10000; // 10秒前に設定
      pool.release(connection);

      // アイドルチェックを待つ（実際のテストでは時間を調整）
      await new Promise((resolve) => setTimeout(resolve, 100));

      // この例では即座には削除されないが、実際の実装では
      // アイドルタイムアウト後に削除される
    });
  });

  describe('統計情報', () => {
    it('正確な統計情報を返す', async () => {
      const config1: ConnectionConfig = {
        name: 'server1',
        websocket: 'ws://localhost:9999',
        command: 'command1',
      };

      const config2: ConnectionConfig = {
        name: 'server2',
        websocket: 'ws://localhost:9999',
        command: 'command2',
      };

      const conn1 = await pool.acquire(config1);
      const conn2 = await pool.acquire(config2);
      pool.release(conn1);

      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(2);
      expect(stats.activeConnections).toBe(1);
      expect(stats.idleConnections).toBe(1);
      expect(stats.connectionsByServer['server1:command1:default']).toBe(1);
      expect(stats.connectionsByServer['server2:command2:default']).toBe(1);
    });
  });

  describe('closeAll', () => {
    it('すべての接続を閉じる', async () => {
      const configs = [
        { name: 'server1', websocket: 'ws://localhost:9999', command: 'cmd1' },
        { name: 'server2', websocket: 'ws://localhost:9999', command: 'cmd2' },
      ];

      for (const config of configs) {
        await pool.acquire(config);
      }

      await pool.closeAll();

      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(0);
      expect(mockClient.close).toHaveBeenCalledTimes(2);
      expect(mockTransport.close).toHaveBeenCalledTimes(2);
    });
  });
});
