#!/usr/bin/env node

/**
 * WebSocket接続の安定性テスト
 * 
 * このスクリプトは以下をテストします：
 * - 長時間接続の維持
 * - 自動再接続
 * - Ping/Pongメカニズム
 * - エラーハンドリング
 */

const WebSocket = require('ws');

const TEST_DURATION = 60000; // 1分間のテスト
const PROXY_URL = 'ws://localhost:9999';

let connectionCount = 0;
let reconnectCount = 0;
let pingCount = 0;
let pongCount = 0;
let errorCount = 0;

function createTestClient() {
  const ws = new WebSocket(PROXY_URL);
  connectionCount++;
  
  console.log(`[${new Date().toISOString()}] 接続試行 #${connectionCount}`);
  
  ws.on('open', () => {
    console.log(`[${new Date().toISOString()}] ✅ 接続成功`);
    
    // 初期化メッセージを送信
    ws.send(JSON.stringify({
      type: 'init',
      command: 'echo',
      args: ['WebSocket Stability Test']
    }));
    
    // 定期的にPingを送信
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        pingCount++;
        console.log(`[${new Date().toISOString()}] 📤 Ping送信 #${pingCount}`);
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 10000); // 10秒ごと
    
    ws.on('close', () => {
      clearInterval(pingInterval);
    });
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'pong') {
        pongCount++;
        console.log(`[${new Date().toISOString()}] 📥 Pong受信 #${pongCount}`);
      } else if (message.type === 'ready') {
        console.log(`[${new Date().toISOString()}] ✅ サーバー準備完了`);
      } else if (message.type === 'error') {
        console.error(`[${new Date().toISOString()}] ❌ エラー: ${message.message}`);
        errorCount++;
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] ❌ メッセージ解析エラー:`, e);
    }
  });
  
  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] ❌ WebSocketエラー:`, error.message);
    errorCount++;
  });
  
  ws.on('close', (code, reason) => {
    console.log(`[${new Date().toISOString()}] 🔌 接続終了 (code: ${code}, reason: ${reason || 'なし'})`);
    
    // 自動再接続（テスト期間中のみ）
    if (Date.now() - startTime < TEST_DURATION) {
      reconnectCount++;
      console.log(`[${new Date().toISOString()}] 🔄 再接続を試行 #${reconnectCount}`);
      setTimeout(() => {
        createTestClient();
      }, 2000);
    }
  });
  
  return ws;
}

console.log('=== WebSocket接続安定性テスト開始 ===');
console.log(`テスト期間: ${TEST_DURATION / 1000}秒`);
console.log(`プロキシURL: ${PROXY_URL}`);
console.log('');

const startTime = Date.now();
const ws = createTestClient();

// テスト終了処理
setTimeout(() => {
  console.log('\n=== テスト結果 ===');
  console.log(`接続試行回数: ${connectionCount}`);
  console.log(`再接続回数: ${reconnectCount}`);
  console.log(`Ping送信数: ${pingCount}`);
  console.log(`Pong受信数: ${pongCount}`);
  console.log(`エラー数: ${errorCount}`);
  console.log('');
  
  const successRate = pongCount > 0 ? (pongCount / pingCount * 100).toFixed(1) : 0;
  console.log(`Ping/Pong成功率: ${successRate}%`);
  
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  
  process.exit(0);
}, TEST_DURATION);

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n\nテストを中断しています...');
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  process.exit(0);
});