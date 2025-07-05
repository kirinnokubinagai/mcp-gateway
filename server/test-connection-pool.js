#!/usr/bin/env node

/**
 * 接続プールの動作確認スクリプト
 * 
 * 接続プールが正しく動作しているかを確認するためのテストスクリプトです。
 * 接続の作成、再利用、健全性チェック、統計情報の表示を行います。
 */

import { ConnectionPool } from './connection-pool.js';
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'TestConnectionPool' });

async function testConnectionPool() {
  logger.info('接続プールのテストを開始します');

  // 接続プールを作成
  const pool = new ConnectionPool({
    maxConnectionsPerServer: 3,
    maxTotalConnections: 10,
    connectionTimeout: 30000,
    idleTimeout: 60000,
    healthCheckIntervalMs: 10000,
    maxHealthCheckFailures: 2
  });

  // イベントリスナーを設定
  pool.on('connection:created', ({ key }) => {
    logger.info(`[イベント] 新規接続作成: ${key}`);
  });

  pool.on('connection:reused', ({ key, connection }) => {
    logger.info(`[イベント] 接続再利用: ${key} (使用回数: ${connection.usageCount})`);
  });

  pool.on('connection:error', ({ key, error }) => {
    logger.error(`[イベント] 接続エラー: ${key}`, error);
  });

  pool.on('connection:removed', ({ key }) => {
    logger.info(`[イベント] 接続削除: ${key}`);
  });

  pool.on('health-check:failed', ({ connection, failures }) => {
    logger.warn(`[イベント] ヘルスチェック失敗: ${connection.config.name} (失敗回数: ${failures})`);
  });

  try {
    // テスト1: 新規接続の作成
    logger.info('\n=== テスト1: 新規接続の作成 ===');
    const config1 = {
      name: 'test-server-1',
      websocket: 'ws://host.docker.internal:9999',
      command: 'echo',
      args: ['test1'],
      sessionId: 'session-1'
    };

    const conn1 = await pool.acquire(config1);
    logger.info(`接続1を取得しました: ${conn1.config.name}`);
    
    // 統計情報を表示
    let stats = pool.getStats();
    logger.info(`統計: 総接続数=${stats.totalConnections}, アクティブ=${stats.activeConnections}, アイドル=${stats.idleConnections}`);

    // テスト2: 接続の返却と再利用
    logger.info('\n=== テスト2: 接続の返却と再利用 ===');
    pool.release(conn1);
    logger.info('接続1を返却しました');

    stats = pool.getStats();
    logger.info(`統計: 総接続数=${stats.totalConnections}, アクティブ=${stats.activeConnections}, アイドル=${stats.idleConnections}`);

    // 同じ設定で再度取得（再利用されるはず）
    const conn1_reused = await pool.acquire(config1);
    logger.info(`接続を再取得しました: 使用回数=${conn1_reused.usageCount}`);

    // テスト3: 複数の接続
    logger.info('\n=== テスト3: 複数の接続 ===');
    const config2 = {
      name: 'test-server-2',
      websocket: 'ws://host.docker.internal:9999',
      command: 'echo',
      args: ['test2'],
      sessionId: 'session-2'
    };

    const config3 = {
      name: 'test-server-3',
      websocket: 'ws://host.docker.internal:9999',
      command: 'echo',
      args: ['test3'],
      sessionId: 'session-3'
    };

    const conn2 = await pool.acquire(config2);
    const conn3 = await pool.acquire(config3);

    logger.info('3つの接続を取得しました');
    stats = pool.getStats();
    logger.info(`統計: 総接続数=${stats.totalConnections}, アクティブ=${stats.activeConnections}`);
    logger.info('サーバーごとの接続数:', stats.connectionsByServer);

    // 接続を返却
    pool.release(conn1_reused);
    pool.release(conn2);
    pool.release(conn3);

    // テスト4: 接続の削除
    logger.info('\n=== テスト4: 接続の削除 ===');
    await pool.remove(conn3);
    
    stats = pool.getStats();
    logger.info(`統計: 総接続数=${stats.totalConnections}, アクティブ=${stats.activeConnections}`);

    // 10秒待って健全性チェックを観察
    logger.info('\n=== 健全性チェックを観察（10秒待機）===');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 最終統計
    logger.info('\n=== 最終統計 ===');
    stats = pool.getStats();
    logger.info(`統計: 総接続数=${stats.totalConnections}, アクティブ=${stats.activeConnections}, アイドル=${stats.idleConnections}`);
    logger.info('サーバーごとの接続数:', stats.connectionsByServer);

  } catch (error) {
    logger.error('テスト中にエラーが発生しました', error);
  } finally {
    // クリーンアップ
    logger.info('\n=== クリーンアップ ===');
    await pool.closeAll();
    logger.info('すべての接続を閉じました');
  }

  process.exit(0);
}

// エラーハンドリング
process.on('unhandledRejection', (error) => {
  logger.error('未処理のPromise拒否', error);
  process.exit(1);
});

// メイン処理を実行
testConnectionPool().catch(error => {
  logger.error('テストスクリプトエラー', error);
  process.exit(1);
});