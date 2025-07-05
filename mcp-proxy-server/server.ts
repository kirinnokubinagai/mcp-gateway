#!/usr/bin/env bun

/**
 * MCPプロキシサーバー
 * ホストで動作し、WebSocket経由でDockerコンテナとMCPサーバーを橋渡しする
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';

interface InitMessage {
  type: 'init';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  dockerOptions?: {
    restart?: 'no' | 'always' | 'on-failure' | 'unless-stopped';
    memory?: string;
    cpus?: string;
  };
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
  type: 'stdout' | 'stderr' | 'error' | 'exit' | 'ready' | 'host-command-result' | 'container-status' | 'pong';
  data?: string;
  message?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  success?: boolean;
  status?: 'running' | 'stopped' | 'error';
  containerName?: string;
}

interface PingMessage {
  type: 'ping';
}

type IncomingMessage = InitMessage | StdinMessage | HostCommandMessage | PingMessage;

// 接続情報の管理
interface ConnectionInfo {
  ws: any;
  mcpProcess: ChildProcess | null;
  config: InitMessage | null;
  lastActivity: number;
  connectionId: string;
}

const connections = new Map<string, ConnectionInfo>();
let connectionCounter = 0;

const PORT = Number(process.env.MCP_PROXY_PORT || process.env.PORT) || 9999;

console.error('🚀 MCPプロキシサーバーを起動中...');

// コンテナの健全性チェック用マップ
const containerMonitors = new Map<string, NodeJS.Timeout>();

/**
 * Dockerコンテナの状態を確認する
 * 
 * docker inspectコマンドを使用してコンテナの現在の状態を取得します。
 * 
 * @param containerName - 確認するコンテナの名前
 * @returns コンテナの状態（running, exited, notfound など）
 */
function checkContainerStatus(containerName: string): string {
  try {
    const result = execSync(`docker inspect -f '{{.State.Status}}' ${containerName} 2>/dev/null`, {
      encoding: 'utf-8'
    }).trim();
    return result;
  } catch (e) {
    return 'notfound';
  }
}

/**
 * コンテナの健全性チェックを開始する
 * 
 * 定期的にコンテナの状態を確認し、停止している場合はWebSocketで通知します。
 * 
 * @param ws - WebSocketインスタンス
 * @param containerName - 監視するコンテナの名前
 */
function startContainerMonitoring(ws: any, containerName: string) {
  // 既存のモニターがあれば停止
  const existingMonitor = containerMonitors.get(containerName);
  if (existingMonitor) {
    clearInterval(existingMonitor);
  }
  
  // 5秒ごとにコンテナの状態を確認
  const monitor = setInterval(() => {
    const status = checkContainerStatus(containerName);
    
    if (status !== 'running') {
      console.log(`⚠️  コンテナ ${containerName} が停止しました: ${status}`);
      
      // WebSocketで状態変更を通知
      const statusMessage: OutputMessage = {
        type: 'container-status',
        status: status === 'exited' ? 'stopped' : 'error',
        containerName,
        message: `コンテナが停止しました: ${status}`
      };
      
      try {
        ws.send(JSON.stringify(statusMessage));
      } catch (e) {
        // WebSocketが閉じている場合は無視
      }
      
      // モニタリングを停止
      clearInterval(monitor);
      containerMonitors.delete(containerName);
    }
  }, 5000);
  
  containerMonitors.set(containerName, monitor);
}

/**
 * コンテナの健全性チェックを停止する
 * 
 * @param containerName - 監視を停止するコンテナの名前
 */
function stopContainerMonitoring(containerName: string) {
  const monitor = containerMonitors.get(containerName);
  if (monitor) {
    clearInterval(monitor);
    containerMonitors.delete(containerName);
  }
}

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
      const connectionId = `conn-${++connectionCounter}`;
      console.log(`✅ 新しいWebSocket接続を受信: ${connectionId}`);
      
      // 接続情報を管理
      const connectionInfo: ConnectionInfo = {
        ws,
        mcpProcess: null,
        config: null,
        lastActivity: Date.now(),
        connectionId
      };
      
      connections.set(connectionId, connectionInfo);
      (ws as any).connectionId = connectionId;
      
      console.log(`[ProxyServer] 現在の接続数: ${connections.size}`);
    },
    
    message(ws, data) {
      try {
        const message = JSON.parse(data.toString()) as IncomingMessage;
        const connectionId = (ws as any).connectionId;
        const connectionInfo = connections.get(connectionId);
        
        if (connectionInfo) {
          connectionInfo.lastActivity = Date.now();
        }
        
        // Pingメッセージの処理
        if (message.type === 'ping') {
          const pongMessage: OutputMessage = {
            type: 'pong'
          };
          ws.send(JSON.stringify(pongMessage));
          return;
        }
        
        // 初回メッセージは設定
        if (!connectionInfo?.mcpProcess && message.type === 'init') {
          const config = message;
          if (connectionInfo) {
            connectionInfo.config = config;
          }
          
          console.log(`🔧 MCPサーバーを起動: ${config.command} ${(config.args || []).join(' ')}`);
          console.log(`🔍 環境変数:`, config.env);
          
          // Dockerコンテナの場合は既存のコンテナをチェック
          let args = config.args || [];
          if (config.command === 'docker' && args.includes('run')) {
            // --rm フラグを削除（手動でコンテナ管理するため）
            args = args.filter(arg => arg !== '--rm');
            
            const imageIndex = args.findIndex(arg => arg.includes(':') && !arg.startsWith('-'));
            if (imageIndex !== -1) {
              const imageName = args[imageIndex];
              // イメージ名からコンテナ名を生成（スラッシュとコロンを削除）
              const baseName = imageName.replace(/[/:]/g, '-').replace(/^-+|-+$/g, '');
              const containerName = `mcp-proxy-${baseName}`;
              
              console.log(`🐳 Dockerコンテナ管理: ${containerName}`);
              
              // 既存のコンテナを削除
              try {
                const { execSync } = require('child_process');
                // 同じ名前のコンテナがあれば停止して削除
                execSync(`docker stop ${containerName} 2>/dev/null || true`, { stdio: 'ignore' });
                execSync(`docker rm ${containerName} 2>/dev/null || true`, { stdio: 'ignore' });
                console.log(`🗑️  既存のコンテナを削除しました: ${containerName}`);
              } catch (e) {
                // エラーは無視
              }
              
              // --name フラグと --restart フラグを追加
              const newArgs = [...args];
              const runIndex = newArgs.indexOf('run');
              const nameIndex = newArgs.indexOf('--name');
              if (nameIndex !== -1) {
                newArgs[nameIndex + 1] = containerName;
              } else {
                newArgs.splice(runIndex + 1, 0, '--name', containerName);
              }
              
              // --restart フラグを追加（存在しない場合）
              const restartIndex = newArgs.indexOf('--restart');
              if (restartIndex === -1) {
                const restartPolicy = config.dockerOptions?.restart || process.env.MCP_DOCKER_RESTART || 'unless-stopped';
                newArgs.splice(runIndex + 1, 0, '--restart', restartPolicy);
              }
              
              // メモリ制限を追加（存在しない場合）
              const memoryIndex = newArgs.indexOf('--memory');
              if (memoryIndex === -1 && (config.dockerOptions?.memory || process.env.MCP_DOCKER_MEMORY)) {
                const memoryLimit = config.dockerOptions?.memory || process.env.MCP_DOCKER_MEMORY;
                newArgs.splice(runIndex + 1, 0, '--memory', memoryLimit);
              }
              
              // CPU制限を追加（存在しない場合）
              const cpusIndex = newArgs.indexOf('--cpus');
              if (cpusIndex === -1 && (config.dockerOptions?.cpus || process.env.MCP_DOCKER_CPUS)) {
                const cpusLimit = config.dockerOptions?.cpus || process.env.MCP_DOCKER_CPUS;
                newArgs.splice(runIndex + 1, 0, '--cpus', cpusLimit);
              }
              
              args = newArgs;
            }
          }
          
          const mcpProcess = spawn(config.command, args, {
            env: { ...process.env, ...config.env },
            stdio: ['pipe', 'pipe', 'pipe']
          });
          
          if (connectionInfo) {
            connectionInfo.mcpProcess = mcpProcess;
          }

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
          
          // Dockerコンテナの場合は健全性チェックを開始
          if (config.command === 'docker' && args.includes('run')) {
            const imageIndex = args.findIndex(arg => arg.includes(':') && !arg.startsWith('-'));
            if (imageIndex !== -1) {
              const imageName = args[imageIndex];
              const baseName = imageName.replace(/[/:]/g, '-').replace(/^-+|-+$/g, '');
              const containerName = `mcp-proxy-${baseName}`;
              
              // コンテナの起動を待つ
              setTimeout(() => {
                const status = checkContainerStatus(containerName);
                if (status === 'running') {
                  console.log(`🏥 コンテナ ${containerName} の健全性チェックを開始`);
                  startContainerMonitoring(ws, containerName);
                }
              }, 2000);
            }
          }
        }
        // 通常のメッセージはMCPサーバーに転送
        else if (connectionInfo?.mcpProcess && message.type === 'stdin') {
          const config = connectionInfo.config;
          if (config) {
            console.log(`📥 stdin to ${config.command}:`, message.data);
            connectionInfo.mcpProcess.stdin?.write(message.data);
          }
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
      const connectionId = (ws as any).connectionId;
      const connectionInfo = connections.get(connectionId);
      
      console.log(`[ProxyServer] WebSocket接続が閉じられました: ${connectionId}`);
      
      if (connectionInfo) {
        const { mcpProcess, config } = connectionInfo;
        
        if (mcpProcess) {
          console.log(`[ProxyServer] プロセスを終了します: ${config?.command}`);
          mcpProcess.kill();
        
        // Dockerコンテナの場合は追加のクリーンアップ
        if (config && config.command === 'docker' && config.args?.includes('run')) {
          const args = config.args || [];
          const imageIndex = args.findIndex((arg: string) => arg.includes(':') && !arg.startsWith('-'));
          if (imageIndex !== -1) {
            const imageName = args[imageIndex];
            const baseName = imageName.replace(/[/:]/g, '-').replace(/^-+|-+$/g, '');
            const containerName = `mcp-proxy-${baseName}`;
            
            console.log(`🧹 Dockerコンテナをクリーンアップ: ${containerName}`);
            
            // 健全性チェックを停止
            stopContainerMonitoring(containerName);
            
            try {
              // コンテナの現在の状態を確認
              const status = checkContainerStatus(containerName);
              
              if (status !== 'notfound') {
                console.log(`📦 コンテナ ${containerName} の状態: ${status}`);
                
                // コンテナを停止
                if (status === 'running') {
                  execSync(`docker stop ${containerName} 2>/dev/null || true`, { stdio: 'ignore' });
                  console.log(`⏹️  コンテナ ${containerName} を停止しました`);
                }
                
                // コンテナを削除（--restartフラグに関係なく）
                execSync(`docker rm -f ${containerName} 2>/dev/null || true`, { stdio: 'ignore' });
                console.log(`🗑️  コンテナ ${containerName} を削除しました`);
              }
            } catch (e) {
              console.error(`コンテナクリーンアップエラー: ${e}`);
            }
          }
        }
        
        // 接続情報をクリア
        connections.delete(connectionId);
        console.log(`[ProxyServer] 接続を削除しました: ${connectionId}, 残り接続数: ${connections.size}`);
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

// 定期的な接続健全性チェック（60秒ごと）
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000; // 5分間アクティビティがない接続はクリーンアップ
  
  for (const [connectionId, info] of connections.entries()) {
    if (now - info.lastActivity > timeout) {
      console.log(`[ProxyServer] 非アクティブな接続をクリーンアップ: ${connectionId}`);
      if (info.ws && typeof info.ws.close === 'function') {
        info.ws.close();
      }
    }
  }
}, 60000);