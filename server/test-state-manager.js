#!/usr/bin/env node

import { StateManager } from './state-manager.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_STATUS_FILE = path.join(__dirname, '../test-status.json');
const TEST_TOOLS_FILE = path.join(__dirname, '../test-tools.json');

console.log('StateManager統合テストを開始します...\n');

/**
 * テスト用のステートマネージャーインスタンスを作成
 */
async function createTestStateManager() {
  // テストファイルをクリーンアップ
  try {
    await fs.unlink(TEST_STATUS_FILE);
  } catch (e) {}
  try {
    await fs.unlink(TEST_TOOLS_FILE);
  } catch (e) {}
  
  const stateManager = new StateManager(TEST_STATUS_FILE, TEST_TOOLS_FILE);
  await stateManager.initialize();
  return stateManager;
}

/**
 * テスト1: 基本的な状態の作成・更新・削除
 */
async function testBasicStateManagement() {
  console.log('テスト1: 基本的な状態管理');
  
  const stateManager = await createTestStateManager();
  
  // 状態を作成
  await stateManager.updateServerState('test-server', {
    status: 'updating',
    config: {
      command: 'test-command',
      args: ['arg1', 'arg2'],
      enabled: true
    }
  });
  
  // 状態を確認
  let state = stateManager.getServerState('test-server');
  console.log('  ✓ 状態作成:', state.status === 'updating' ? '成功' : '失敗');
  
  // 状態を更新
  await stateManager.updateServerState('test-server', {
    status: 'connected',
    error: undefined
  });
  
  state = stateManager.getServerState('test-server');
  console.log('  ✓ 状態更新:', state.status === 'connected' ? '成功' : '失敗');
  
  // 状態を削除
  await stateManager.deleteServerState('test-server');
  state = stateManager.getServerState('test-server');
  console.log('  ✓ 状態削除:', state === undefined ? '成功' : '失敗');
  
  console.log('');
}

/**
 * テスト2: トランザクション的な更新
 */
async function testTransactionalUpdate() {
  console.log('テスト2: トランザクション的な更新');
  
  const stateManager = await createTestStateManager();
  
  // 初期状態を作成
  await stateManager.updateServerState('tx-server', {
    status: 'connected',
    config: { command: 'test', enabled: true }
  });
  
  try {
    // 無効なステータスで更新を試みる
    await stateManager.updateServerState('tx-server', {
      status: 'invalid-status' // これは検証で失敗する
    });
    console.log('  ✗ トランザクション検証: 失敗（例外が発生しなかった）');
  } catch (error) {
    // エラーが発生し、状態がロールバックされることを確認
    const state = stateManager.getServerState('tx-server');
    console.log('  ✓ トランザクション検証:', state.status === 'connected' ? '成功' : '失敗');
  }
  
  console.log('');
}

/**
 * テスト3: イベント発行の確認
 */
async function testEventEmission() {
  console.log('テスト3: イベント発行');
  
  const stateManager = await createTestStateManager();
  
  let eventFired = false;
  let eventData = null;
  
  // イベントリスナーを設定
  stateManager.on('state-changed', (data) => {
    eventFired = true;
    eventData = data;
  });
  
  // 状態を更新
  await stateManager.updateServerState('event-server', {
    status: 'connected',
    config: { command: 'test', enabled: true }
  });
  
  // イベントが発行されたか確認
  console.log('  ✓ イベント発行:', eventFired ? '成功' : '失敗');
  console.log('  ✓ イベントタイプ:', eventData?.type === 'server-state-changed' ? '正常' : '異常');
  
  console.log('');
}

/**
 * テスト4: ファイル永続化の確認
 */
async function testFilePersistence() {
  console.log('テスト4: ファイル永続化');
  
  const stateManager1 = await createTestStateManager();
  
  // 複数の状態を作成
  await stateManager1.updateServerState('persist-server-1', {
    status: 'connected',
    config: { command: 'test1', enabled: true }
  });
  
  await stateManager1.updateServerState('persist-server-2', {
    status: 'error',
    config: { command: 'test2', enabled: false },
    error: 'テストエラー'
  });
  
  // ツールも追加
  await stateManager1.updateServerTools('persist-server-1', [
    { name: 'tool1', description: 'Test tool 1' },
    { name: 'tool2', description: 'Test tool 2' }
  ]);
  
  // 少し待つ（非同期保存のため）
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // ファイルが存在することを確認
  try {
    await fs.access(TEST_STATUS_FILE);
    console.log('  ✓ ステータスファイル作成: 成功');
  } catch {
    console.log('  ✗ ステータスファイル作成: 失敗');
  }
  
  try {
    await fs.access(TEST_TOOLS_FILE);
    console.log('  ✓ ツールファイル作成: 成功');
  } catch {
    console.log('  ✗ ツールファイル作成: 失敗');
  }
  
  // 新しいインスタンスで読み込み
  const stateManager2 = new StateManager(TEST_STATUS_FILE, TEST_TOOLS_FILE);
  await stateManager2.initialize();
  
  const states = stateManager2.getStates();
  const tools = stateManager2.getTools();
  
  console.log('  ✓ 状態の復元:', Object.keys(states).length === 2 ? '成功' : '失敗');
  console.log('  ✓ ツールの復元:', tools['persist-server-1']?.length === 2 ? '成功' : '失敗');
  
  console.log('');
}

/**
 * テスト5: 統計情報の確認
 */
async function testStatistics() {
  console.log('テスト5: 統計情報');
  
  const stateManager = await createTestStateManager();
  
  // 様々な状態のサーバーを作成
  await stateManager.updateServerState('stats-connected', {
    status: 'connected',
    config: { command: 'test', enabled: true }
  });
  
  await stateManager.updateServerState('stats-error', {
    status: 'error',
    config: { command: 'test', enabled: true },
    error: 'Test error'
  });
  
  await stateManager.updateServerState('stats-disabled', {
    status: 'disabled',
    config: { command: 'test', enabled: false }
  });
  
  await stateManager.updateServerState('stats-updating', {
    status: 'updating',
    config: { command: 'test', enabled: true }
  });
  
  // ツールを追加
  await stateManager.updateServerTools('stats-connected', [
    { name: 'tool1', description: 'Tool 1' },
    { name: 'tool2', description: 'Tool 2' },
    { name: 'tool3', description: 'Tool 3' }
  ]);
  
  const stats = stateManager.getStatistics();
  
  console.log('  統計情報:');
  console.log(`    - 総サーバー数: ${stats.totalServers}`);
  console.log(`    - 接続済み: ${stats.connectedServers}`);
  console.log(`    - エラー: ${stats.errorServers}`);
  console.log(`    - 無効: ${stats.disabledServers}`);
  console.log(`    - 更新中: ${stats.updatingServers}`);
  console.log(`    - 総ツール数: ${stats.totalTools}`);
  
  const correct = stats.totalServers === 4 && 
                  stats.connectedServers === 1 && 
                  stats.errorServers === 1 && 
                  stats.disabledServers === 1 && 
                  stats.updatingServers === 1 &&
                  stats.totalTools === 3;
  
  console.log(`  ✓ 統計情報の正確性: ${correct ? '成功' : '失敗'}`);
  
  console.log('');
}

/**
 * テスト6: 並行更新の処理
 */
async function testConcurrentUpdates() {
  console.log('テスト6: 並行更新の処理');
  
  const stateManager = await createTestStateManager();
  
  // 複数の更新を同時に実行
  const updates = [];
  for (let i = 0; i < 10; i++) {
    updates.push(
      stateManager.updateServerState(`concurrent-${i}`, {
        status: i % 2 === 0 ? 'connected' : 'error',
        config: { command: `test-${i}`, enabled: true }
      })
    );
  }
  
  // すべての更新が完了するまで待つ
  await Promise.all(updates);
  
  // 状態を確認
  const states = stateManager.getStates();
  const stateCount = Object.keys(states).length;
  
  console.log(`  ✓ 並行更新: ${stateCount === 10 ? '成功' : '失敗'} (${stateCount}/10)`);
  
  console.log('');
}

/**
 * クリーンアップ
 */
async function cleanup() {
  try {
    await fs.unlink(TEST_STATUS_FILE);
    await fs.unlink(TEST_TOOLS_FILE);
  } catch (e) {}
}

/**
 * メインテスト実行
 */
async function runTests() {
  try {
    await testBasicStateManagement();
    await testTransactionalUpdate();
    await testEventEmission();
    await testFilePersistence();
    await testStatistics();
    await testConcurrentUpdates();
    
    console.log('すべてのテストが完了しました！');
    
    await cleanup();
  } catch (error) {
    console.error('テストエラー:', error);
    process.exit(1);
  }
}

// テストを実行
runTests();