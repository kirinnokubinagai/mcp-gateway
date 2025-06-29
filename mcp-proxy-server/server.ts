#!/usr/bin/env bun

/**
 * MCPプロキシサーバー
 * ホストで動作し、WebSocket経由でDockerコンテナとMCPサーバーを橋渡しする
 */

import { spawn } from 'child_process';

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

interface HostCommandMessage {
  type: 'host-command';
  command: string;
  args?: string[];
}

interface OutputMessage {
  type: 'stdout' | 'stderr' | 'error' | 'exit' | 'ready' | 'host-command-result';
  data?: string;
  message?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  success?: boolean;
}

type IncomingMessage = InitMessage | StdinMessage | HostCommandMessage;

const PORT = Number(process.env.MCP_PROXY_PORT || process.env.PORT) || 9999;

console.error('🚀 MCPプロキシサーバーを起動中...');

// Bunのネイティブサーバー
Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  
  fetch(req, server) {
    // WebSocketアップグレード
    if (server.upgrade(req)) {
      return; // WebSocketハンドラーで処理
    }
    return new Response('WebSocket接続が必要です', { status: 400 });
  },
  
  websocket: {
    open(ws) {
      console.log('✅ 新しいWebSocket接続を受信');
      
      // WebSocketにプロパティを追加
      (ws as any).mcpProcess = null;
      (ws as any).config = null;
    },
    
    message(ws, data) {
      try {
        const message = JSON.parse(data.toString()) as IncomingMessage;
        
        // 初回メッセージは設定
        if (!(ws as any).mcpProcess && message.type === 'init') {
          const config = message;
          (ws as any).config = config;
          
          console.log(`🔧 MCPサーバーを起動: ${config.command} ${(config.args || []).join(' ')}`);
          console.log(`🔍 環境変数:`, config.env);
          
          const mcpProcess = spawn(config.command, config.args || [], {
            env: { ...process.env, ...config.env },
            stdio: ['pipe', 'pipe', 'pipe']
          });
          
          (ws as any).mcpProcess = mcpProcess;

          // プロセスエラーハンドリング
          mcpProcess.on('error', (error: Error) => {
            console.error(`❌ プロセス起動エラー (${config.command}):`, error.message);
            const errorMessage: OutputMessage = {
              type: 'error',
              message: `プロセス起動エラー: ${error.message}`
            };
            ws.send(JSON.stringify(errorMessage));
          });

          // MCPサーバーからの出力をWebSocketに転送
          mcpProcess.stdout?.on('data', (data: Buffer) => {
            const output = data.toString();
            console.log(`📤 stdout from ${config.command}:`, output);
            const outputMessage: OutputMessage = {
              type: 'stdout',
              data: output
            };
            ws.send(JSON.stringify(outputMessage));
          });

          mcpProcess.stderr?.on('data', (data: Buffer) => {
            const errorMsg = data.toString();
            console.error(`❌ stderr from ${config.command}:`, errorMsg);
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
        else if ((ws as any).mcpProcess && message.type === 'stdin') {
          const config = (ws as any).config;
          console.log(`📥 stdin to ${config.command}:`, message.data);
          (ws as any).mcpProcess.stdin?.write(message.data);
        }
        // ホストコマンドの実行
        else if (message.type === 'host-command') {
          console.log(`🖥️  ホストコマンド実行: ${message.command} ${(message.args || []).join(' ')}`);
          
          // 許可されたコマンドのホワイトリスト
          const allowedCommands = ['say', 'osascript', 'notify-send', 'open'];
          
          if (!allowedCommands.includes(message.command)) {
            const errorMessage: OutputMessage = {
              type: 'host-command-result',
              success: false,
              message: `許可されていないコマンド: ${message.command}`
            };
            ws.send(JSON.stringify(errorMessage));
            return;
          }
          
          const hostProcess = spawn(message.command, message.args || [], {
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          
          let stdout = '';
          let stderr = '';
          
          hostProcess.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
          });
          
          hostProcess.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
          
          hostProcess.on('close', (code: number | null) => {
            const resultMessage: OutputMessage = {
              type: 'host-command-result',
              success: code === 0,
              data: stdout,
              message: stderr || undefined,
              code
            };
            ws.send(JSON.stringify(resultMessage));
          });
          
          hostProcess.on('error', (error: Error) => {
            const errorMessage: OutputMessage = {
              type: 'host-command-result',
              success: false,
              message: `コマンド実行エラー: ${error.message}`
            };
            ws.send(JSON.stringify(errorMessage));
          });
        }
      } catch (e) {
        console.error('メッセージ処理エラー:', e);
        const errorMessage: OutputMessage = {
          type: 'error',
          message: (e as Error).message
        };
        ws.send(JSON.stringify(errorMessage));
      }
    },
    
    close(ws) {
      console.log('WebSocket接続が閉じられました');
      const mcpProcess = (ws as any).mcpProcess;
      if (mcpProcess) {
        mcpProcess.kill();
      }
    }
  }
});

console.error(`✨ MCPプロキシサーバーが起動しました`);
console.log(`📍 WebSocket URL: ws://localhost:${PORT}`);
console.log('');
console.log('使用方法:');
console.log('1. ホストでこのプロキシサーバーを起動');
console.log('2. DockerコンテナからWebSocket接続');
console.log('3. 初期化メッセージを送信:');
console.log('   {"type":"init","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem"]}');
console.log('4. stdin/stdoutをWebSocket経由で通信');