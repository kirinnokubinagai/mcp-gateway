import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import WebSocket from 'ws';

interface WebSocketTransportOptions {
  url: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * WebSocket経由でMCPサーバーと通信するTransport
 * Dockerコンテナからホストのプロキシサーバー経由でMCPサーバーにアクセス
 */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  
  constructor(private options: WebSocketTransportOptions) {}

  async start(): Promise<void> {
    console.error(`WebSocketプロキシに接続中: ${this.options.url}`);
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.url);
      
      // タイムアウト設定（30秒）
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout after 30s'));
      }, 30000);
      
      this.ws.on('open', () => {
        console.error('WebSocket接続成功、MCPサーバーを初期化中...');
        clearTimeout(timeout);
        
        // 初期化メッセージを送信
        this.ws!.send(JSON.stringify({
          type: 'init',
          command: this.options.command,
          args: this.options.args,
          env: this.options.env
        }));
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'ready') {
            console.error('MCPサーバーの準備完了');
            
            // 準備完了後、stdout/stderrメッセージを処理
            this.ws!.removeAllListeners('message');
            this.ws!.on('message', (data) => {
              try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'stdout' && msg.data) {
                  // stdoutデータをJSON-RPCメッセージとして解析
                  const lines = msg.data.split('\n').filter((line: string) => line.trim());
                  for (const line of lines) {
                    try {
                      const jsonRpcMessage = JSON.parse(line);
                      console.error('JSON-RPCメッセージ受信:', JSON.stringify(jsonRpcMessage));
                      if (this.onmessage) {
                        this.onmessage(jsonRpcMessage);
                      }
                    } catch (e) {
                      // JSON以外の行は無視
                      if (line.trim()) {
                        console.error('非JSONメッセージ:', line);
                      }
                    }
                  }
                } else if (msg.type === 'stderr') {
                  console.error('MCPサーバーエラー:', msg.data);
                } else if (msg.type === 'exit') {
                  console.error('MCPプロセス終了:', msg.code);
                  if (this.onclose) {
                    this.onclose();
                  }
                }
              } catch (e) {
                console.error('メッセージ処理エラー:', e);
              }
            });
            
            resolve();
          } else if (message.type === 'error') {
            clearTimeout(timeout);
            reject(new Error(message.message));
          }
        } catch (e) {
          console.error('メッセージ解析エラー:', e);
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error('WebSocketエラー:', error);
        if (this.onerror) {
          this.onerror(error);
        }
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.error(`WebSocket接続が閉じられました: code=${code}, reason=${reason}`);
        if (this.onclose) {
          this.onclose();
        }
      });
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket接続が閉じています');
    }

    const data = JSON.stringify(message) + '\n';
    console.error('JSON-RPCメッセージ送信:', data.trim());
    
    // MCPメッセージをstdinとして送信
    this.ws.send(JSON.stringify({
      type: 'stdin',
      data: data
    }));
  }

  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}