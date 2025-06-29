#!/usr/bin/env node

/**
 * mcp-config.jsonの変更を監視し、プロキシサーバーを自動再起動する
 */

import fs from 'fs';
import { spawn, exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, '../mcp-config.json');
const DEBOUNCE_DELAY = 1000; // 1秒のデバウンス

let proxyProcess = null;
let debounceTimer = null;

/**
 * プロキシサーバーを起動
 */
function startProxy() {
  console.log('🚀 プロキシサーバーを起動しています...');
  
  proxyProcess = spawn('bun', ['run', 'proxy'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env }
  });
  
  proxyProcess.on('error', (error) => {
    console.error('❌ プロキシサーバーエラー:', error);
  });
  
  proxyProcess.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM') {
      console.log(`⚠️  プロキシサーバーが終了しました (code: ${code}, signal: ${signal})`);
    }
  });
}

/**
 * プロキシサーバーを停止
 */
function stopProxy() {
  if (proxyProcess) {
    console.log('🛑 プロキシサーバーを停止しています...');
    proxyProcess.kill('SIGTERM');
    proxyProcess = null;
  }
}

/**
 * プロキシサーバーを再起動
 */
function restartProxy() {
  stopProxy();
  setTimeout(() => {
    startProxy();
  }, 500);
}

/**
 * 設定ファイルの変更を処理
 */
function handleConfigChange() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  
  debounceTimer = setTimeout(() => {
    console.log('📝 mcp-config.jsonが変更されました。プロキシサーバーを再起動します...');
    restartProxy();
    
    // Dockerコンテナも再起動（オプション）
    exec('docker-compose restart mcp-gateway-server', (error) => {
      if (error) {
        console.log('ℹ️  Dockerコンテナの再起動をスキップしました');
      } else {
        console.log('✅ Dockerコンテナを再起動しました');
      }
    });
  }, DEBOUNCE_DELAY);
}

// 初回起動
startProxy();

// ファイル監視開始
console.log(`👀 ${CONFIG_FILE} を監視しています...`);
fs.watchFile(CONFIG_FILE, { interval: 1000 }, (curr, prev) => {
  if (curr.mtime !== prev.mtime) {
    handleConfigChange();
  }
});

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n👋 監視を終了します...');
  stopProxy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopProxy();
  process.exit(0);
});

console.log('✨ 設定ファイル監視が開始されました');
console.log('ℹ️  Ctrl+C で終了します');