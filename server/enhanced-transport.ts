import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface EnhancedError {
  message: string;
  type: 'command_not_found' | 'package_not_found' | 'network_error' | 'timeout' | 'connection_closed' | 'unknown';
  details?: string;
}

export class EnhancedStdioTransport extends EventEmitter {
  private process?: ChildProcess;
  private startupTimeout?: NodeJS.Timeout;
  
  constructor(
    private config: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  ) {
    super();
  }
  
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let startupComplete = false;
      let stderrBuffer = '';
      
      // スタートアップタイムアウト（30秒）
      this.startupTimeout = setTimeout(() => {
        if (!startupComplete) {
          this.cleanup();
          reject({
            message: 'Server startup timeout',
            type: 'timeout',
            details: stderrBuffer
          } as EnhancedError);
        }
      }, 30000);
      
      try {
        this.process = spawn(this.config.command, this.config.args || [], {
          env: { ...process.env, ...this.config.env },
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // プロセス起動エラー（コマンドが見つからない等）
        this.process.on('error', (error: any) => {
          clearTimeout(this.startupTimeout);
          let enhancedError: EnhancedError;
          
          if (error.code === 'ENOENT') {
            enhancedError = {
              message: `Command not found: ${this.config.command}`,
              type: 'command_not_found',
              details: error.message
            };
          } else if (error.code === 'EACCES') {
            enhancedError = {
              message: `Permission denied: ${this.config.command}`,
              type: 'command_not_found',
              details: error.message
            };
          } else {
            enhancedError = {
              message: error.message,
              type: 'unknown',
              details: error.stack
            };
          }
          
          reject(enhancedError);
        });
        
        // 標準エラー出力を監視
        this.process.stderr?.on('data', (data) => {
          const chunk = data.toString();
          stderrBuffer += chunk;
          console.error(`[${this.config.command}] stderr:`, chunk);
          
          // npmエラーの検出
          if (chunk.includes('npm error code E404') || chunk.includes('404 Not Found')) {
            clearTimeout(this.startupTimeout);
            this.cleanup();
            reject({
              message: 'Package not found',
              type: 'package_not_found',
              details: stderrBuffer
            } as EnhancedError);
          }
          
          // ネットワークエラーの検出
          if (chunk.includes('ECONNREFUSED') || chunk.includes('getaddrinfo ENOTFOUND')) {
            clearTimeout(this.startupTimeout);
            this.cleanup();
            reject({
              message: 'Network connection failed',
              type: 'network_error',
              details: stderrBuffer
            } as EnhancedError);
          }
        });
        
        // プロセスの早期終了を検出
        this.process.on('exit', (code, signal) => {
          if (!startupComplete) {
            clearTimeout(this.startupTimeout);
            
            let enhancedError: EnhancedError;
            if (code === 127) {
              enhancedError = {
                message: 'Command not found in PATH',
                type: 'command_not_found',
                details: stderrBuffer
              };
            } else if (stderrBuffer.includes('404') || stderrBuffer.includes('Not Found')) {
              enhancedError = {
                message: 'Package or resource not found',
                type: 'package_not_found',
                details: stderrBuffer
              };
            } else {
              enhancedError = {
                message: `Process exited with code ${code}`,
                type: 'connection_closed',
                details: stderrBuffer
              };
            }
            
            reject(enhancedError);
          }
        });
        
        // MCPサーバーの準備完了を待つ
        this.process.stdout?.on('data', (data) => {
          console.error(`[${this.config.command}] stdout:`, data.toString());
          // MCPサーバーが準備完了したことを示すパターンを検出
          if (!startupComplete) {
            startupComplete = true;
            clearTimeout(this.startupTimeout);
            resolve();
          }
        });
        
        // 念のため、一定時間後に成功とみなす
        setTimeout(() => {
          if (!startupComplete && this.process && !this.process.killed) {
            startupComplete = true;
            clearTimeout(this.startupTimeout);
            resolve();
          }
        }, 3000);
        
      } catch (error: any) {
        clearTimeout(this.startupTimeout);
        reject({
          message: error.message,
          type: 'unknown',
          details: error.stack
        } as EnhancedError);
      }
    });
  }
  
  private cleanup() {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
    }
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }
  
  async close() {
    this.cleanup();
  }
}