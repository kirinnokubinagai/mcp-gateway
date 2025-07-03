import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

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
  private jsonBuffer: string = '';
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  
  constructor(private options: WebSocketTransportOptions) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.url);
      
      // タイムアウト設定（10秒）
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket接続タイムアウト'));
      }, 10000);
      
      this.ws.addEventListener('open', () => {
        clearTimeout(timeout);
        
        // 初期化メッセージを送信
        this.ws!.send(JSON.stringify({
          type: 'init',
          command: this.options.command,
          args: this.options.args,
          env: this.options.env
        }));
      });

      this.ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'ready') {
            // 準備完了後、stdout/stderrメッセージを処理
            this.ws!.removeEventListener('message', () => {});
            this.ws!.addEventListener('message', (event) => {
              try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'stdout' && msg.data) {
                  // stdoutデータを処理
                  this.jsonBuffer += msg.data;
                  
                  // 改行で分割して処理
                  const lines = this.jsonBuffer.split('\n');
                  
                  // 最後の行は不完全な可能性があるので保持
                  this.jsonBuffer = lines.pop() || '';
                  
                  // 完全な行を処理
                  for (const line of lines) {
                    if (!line.trim()) continue;
                    
                    try {
                      const jsonRpcMessage = JSON.parse(line);
                      if (this.onmessage) {
                        this.onmessage(jsonRpcMessage);
                      }
                    } catch (e) {
                      // JSONパースエラーは無視（不完全なJSONの可能性）
                      this.jsonBuffer = line + '\n' + this.jsonBuffer;
                    }
                  }
                } else if (msg.type === 'stderr') {
                  // stderrは無視（ノイズが多いため）
                } else if (msg.type === 'exit') {
                  if (this.onclose) {
                    this.onclose();
                  }
                }
              } catch (e) {
                // メッセージ処理エラーは無視
              }
            });
            
            resolve();
          } else if (message.type === 'error') {
            clearTimeout(timeout);
            reject(new Error(message.message));
          }
        } catch (e) {
          // メッセージ解析エラーは無視
        }
      });

      this.ws.addEventListener('error', (event) => {
        clearTimeout(timeout);
        const error = new Error('WebSocket接続エラー');
        if (this.onerror) {
          this.onerror(error);
        }
        reject(error);
      });

      this.ws.addEventListener('close', (event) => {
        // 残りのバッファを処理
        if (this.jsonBuffer.trim()) {
          try {
            const jsonRpcMessage = JSON.parse(this.jsonBuffer);
            if (this.onmessage) {
              this.onmessage(jsonRpcMessage);
            }
          } catch (e) {
            // パースエラーは無視
          }
        }
        this.jsonBuffer = '';
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