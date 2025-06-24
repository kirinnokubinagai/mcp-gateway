#!/usr/bin/env node

/**
 * MCPプロキシサーバー
 * ホストで動作し、WebSocket経由でDockerコンテナとMCPサーバーを橋渡しする
 */

import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { createServer } from 'http';

const PORT = process.env.PORT || 9999;
const server = createServer();
const wss = new WebSocketServer({ server });

console.log('🚀 MCPプロキシサーバーを起動中...');

wss.on('connection', (ws) => {
  console.log('✅ 新しいWebSocket接続を受信');
  
  let mcpProcess = null;
  let config = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      // 初回メッセージは設定
      if (!mcpProcess && message.type === 'init') {
        config = message;
        console.log(`🔧 MCPサーバーを起動: ${config.command} ${(config.args || []).join(' ')}`);
        console.log(`🔍 環境変数:`, config.env);
        
        mcpProcess = spawn(config.command, config.args || [], {
          env: { ...process.env, ...config.env },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // プロセスエラーハンドリング
        mcpProcess.on('error', (error) => {
          console.error(`❌ プロセス起動エラー (${config.command}):`, error.message);
          ws.send(JSON.stringify({
            type: 'error',
            message: `プロセス起動エラー: ${error.message}`
          }));
        });

        // MCPサーバーからの出力をWebSocketに転送
        mcpProcess.stdout.on('data', (data) => {
          const output = data.toString();
          console.log(`📤 stdout from ${config.command}:`, output);
          ws.send(JSON.stringify({
            type: 'stdout',
            data: output
          }));
        });

        mcpProcess.stderr.on('data', (data) => {
          const errorMsg = data.toString();
          console.error(`❌ stderr from ${config.command}:`, errorMsg);
          // 環境変数関連のエラーを特別にログ
          if (errorMsg.includes('environment variable') || errorMsg.includes('OBSIDIAN')) {
            console.error('⚠️  環境変数エラー検出:', errorMsg);
          }
          ws.send(JSON.stringify({
            type: 'stderr',
            data: errorMsg
          }));
        });

        mcpProcess.on('exit', (code, signal) => {
          console.log(`MCPプロセス終了: code=${code}, signal=${signal}`);
          if (code === 143 || signal === 'SIGTERM') {
            console.log('⚠️  プロセスが強制終了されました (SIGTERM)');
          }
          ws.send(JSON.stringify({
            type: 'exit',
            code,
            signal
          }));
          ws.close();
        });

        ws.send(JSON.stringify({
          type: 'ready',
          message: 'MCPサーバーが起動しました'
        }));
      }
      // 通常のメッセージはMCPサーバーに転送
      else if (mcpProcess && message.type === 'stdin') {
        console.log(`📥 stdin to ${config.command}:`, message.data);
        mcpProcess.stdin.write(message.data);
      }
    } catch (e) {
      console.error('メッセージ処理エラー:', e);
      ws.send(JSON.stringify({
        type: 'error',
        message: e.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket接続が閉じられました');
    if (mcpProcess) {
      mcpProcess.kill();
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocketエラー:', error);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✨ MCPプロキシサーバーが起動しました`);
  console.log(`📍 WebSocket URL: ws://localhost:${PORT}`);
  console.log('');
  console.log('使用方法:');
  console.log('1. ホストでこのプロキシサーバーを起動');
  console.log('2. DockerコンテナからWebSocket接続');
  console.log('3. 初期化メッセージを送信:');
  console.log('   {"type":"init","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem"]}');
  console.log('4. stdin/stdoutをWebSocket経由で通信');
});