#!/usr/bin/env node

/**
 * MCPプロキシサーバー
 * ホストで動作し、WebSocket経由でDockerコンテナとMCPサーバーを橋渡しする
 */

import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'http';

interface InitMessage {
  type: 'init';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface StdinMessage {
  type: 'stdin';
  data: string;
}

interface OutputMessage {
  type: 'stdout' | 'stderr' | 'error' | 'exit' | 'ready';
  data?: string;
  message?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
}

type IncomingMessage = InitMessage | StdinMessage;

const PORT = Number(process.env.PORT) || 9999;
const server = createServer();
const wss = new WebSocketServer({ server });

console.log('🚀 MCPプロキシサーバーを起動中...');

wss.on('connection', (ws: WebSocket) => {
  console.log('✅ 新しいWebSocket接続を受信');
  
  let mcpProcess: ChildProcess | null = null;
  let config: InitMessage | null = null;

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString()) as IncomingMessage;
      
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
        mcpProcess.on('error', (error: Error) => {
          console.error(`❌ プロセス起動エラー (${config!.command}):`, error.message);
          const errorMessage: OutputMessage = {
            type: 'error',
            message: `プロセス起動エラー: ${error.message}`
          };
          ws.send(JSON.stringify(errorMessage));
        });

        // MCPサーバーからの出力をWebSocketに転送
        mcpProcess.stdout?.on('data', (data: Buffer) => {
          const output = data.toString();
          console.log(`📤 stdout from ${config!.command}:`, output);
          const outputMessage: OutputMessage = {
            type: 'stdout',
            data: output
          };
          ws.send(JSON.stringify(outputMessage));
        });

        mcpProcess.stderr?.on('data', (data: Buffer) => {
          const errorMsg = data.toString();
          console.error(`❌ stderr from ${config!.command}:`, errorMsg);
          // 環境変数関連のエラーを特別にログ
          if (errorMsg.includes('environment variable') || errorMsg.includes('OBSIDIAN')) {
            console.error('⚠️  環境変数エラー検出:', errorMsg);
          }
          const errorMessage: OutputMessage = {
            type: 'stderr',
            data: errorMsg
          };
          ws.send(JSON.stringify(errorMessage));
        });

        mcpProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
          console.log(`MCPプロセス終了: code=${code}, signal=${signal}`);
          if (code === 143 || signal === 'SIGTERM') {
            console.log('⚠️  プロセスが強制終了されました (SIGTERM)');
          }
          const exitMessage: OutputMessage = {
            type: 'exit',
            code,
            signal
          };
          ws.send(JSON.stringify(exitMessage));
          ws.close();
        });

        const readyMessage: OutputMessage = {
          type: 'ready',
          message: 'MCPサーバーが起動しました'
        };
        ws.send(JSON.stringify(readyMessage));
      }
      // 通常のメッセージはMCPサーバーに転送
      else if (mcpProcess && message.type === 'stdin') {
        console.log(`📥 stdin to ${config!.command}:`, message.data);
        mcpProcess.stdin?.write(message.data);
      }
    } catch (e) {
      console.error('メッセージ処理エラー:', e);
      const errorMessage: OutputMessage = {
        type: 'error',
        message: (e as Error).message
      };
      ws.send(JSON.stringify(errorMessage));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket接続が閉じられました');
    if (mcpProcess) {
      mcpProcess.kill();
    }
  });

  ws.on('error', (error: Error) => {
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