import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

interface WebSocketTransportOptions {
  url: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  pingInterval?: number;
}

/**
 * WebSocket経由でMCPサーバーと通信するTransport
 * Dockerコンテナからホストのプロキシサーバー経由でMCPサーバーにアクセス
 * 
 * 機能:
 * - 自動再接続（指数バックオフ）
 * - 接続状態の追跡
 * - Ping/Pongによる健全性チェック
 * - 詳細なエラーハンドリング
 */
export class WebSocketTransport implements Transport {
  private ws: any = null;
  private jsonBuffer: string = '';
  private reconnectAttempts: number = 0;
  private isClosing: boolean = false;
  private isConnected: boolean = false;
  private pingInterval: any = null;
  private lastPingTime: number = 0;
  private connectionStartTime: number = 0;
  
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  
  constructor(private options: WebSocketTransportOptions) {
    this.options.reconnectAttempts = this.options.reconnectAttempts ?? 5;
    this.options.reconnectDelay = this.options.reconnectDelay ?? 1000;
    this.options.maxReconnectDelay = this.options.maxReconnectDelay ?? 30000;
    this.options.pingInterval = this.options.pingInterval ?? 30000;
  }

  async start(): Promise<void> {
    this.connectionStartTime = Date.now();
    this.isClosing = false;
    return this.connect();
  }

  private async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // Node.js環境ではwsパッケージを使用
        const WebSocket = typeof window !== 'undefined' && window.WebSocket 
          ? window.WebSocket 
          : (await import('ws')).default;
        
        const attemptNumber = this.reconnectAttempts + 1;
        console.error(`[WebSocketTransport] 接続試行 #${attemptNumber}: ${this.options.url}`);
        console.error(`[WebSocketTransport] コマンド: ${this.options.command} ${(this.options.args || []).join(' ')}`);
        
        this.ws = new WebSocket(this.options.url);
        
        // タイムアウト設定（デフォルト30秒）
        const timeoutMs = this.options.timeout || 30000;
        const timeout = setTimeout(() => {
          if (!this.isConnected) {
            console.error(`[WebSocketTransport] 接続タイムアウト (${timeoutMs}ms)`);
            this.ws?.close();
            this.handleConnectionFailure(reject, new Error(`WebSocket接続タイムアウト (${timeoutMs}ms): ${this.options.command}`));
          }
        }, timeoutMs);
        
        this.ws.addEventListener('open', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          const connectionDuration = Date.now() - this.connectionStartTime;
          console.error(`[WebSocketTransport] ✅ 接続成功 (${connectionDuration}ms)`);
          
          // Pingインターバルを開始
          this.startPingInterval();
          
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
            
            if (message.type === 'pong') {
              const latency = Date.now() - this.lastPingTime;
              console.error(`[WebSocketTransport] Pong受信 (latency: ${latency}ms)`);
              return;
            }
            
            if (message.type === 'ready') {
              clearTimeout(timeout);
              console.error('[WebSocketTransport] MCPサーバー準備完了');
              
              // メッセージハンドラーを設定
              this.setupMessageHandler();
              resolve();
              
            } else if (message.type === 'error') {
              clearTimeout(timeout);
              console.error(`[WebSocketTransport] エラー受信: ${message.message}`);
              this.handleConnectionFailure(reject, new Error(message.message));
            }
          } catch (e) {
            console.error('[WebSocketTransport] メッセージ解析エラー:', e);
          }
        });

        this.ws.addEventListener('error', (event: any) => {
          clearTimeout(timeout);
          const errorMessage = event.message || event.type || 'Connection failed';
          console.error(`[WebSocketTransport] ❌ 接続エラー: ${errorMessage}`);
          const error = new Error(`WebSocket接続エラー: ${errorMessage}`);
          
          if (!this.isConnected) {
            this.handleConnectionFailure(reject, error);
          } else if (this.onerror) {
            this.onerror(error);
          }
        });

        this.ws.addEventListener('close', (event) => {
          clearTimeout(timeout);
          this.isConnected = false;
          this.stopPingInterval();
          
          console.error(`[WebSocketTransport] 接続終了 (code: ${event.code}, reason: ${event.reason || 'なし'})`);
          
          // 残りのバッファを処理
          this.flushBuffer();
          
          if (!this.isClosing && this.reconnectAttempts < this.options.reconnectAttempts!) {
            console.error('[WebSocketTransport] 再接続を試行します...');
            this.scheduleReconnect();
          } else {
            if (this.onclose) {
              this.onclose();
            }
          }
        });
      } catch (error) {
        console.error('[WebSocketTransport] 接続セットアップエラー:', error);
        this.handleConnectionFailure(reject, error as Error);
      }
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== 1) { // WebSocket.OPEN = 1
      throw new Error('WebSocket接続が閉じています');
    }

    const data = JSON.stringify(message) + '\n';
    
    try {
      // MCPメッセージをstdinとして送信
      this.ws.send(JSON.stringify({
        type: 'stdin',
        data: data
      }));
    } catch (error) {
      console.error('[WebSocketTransport] 送信エラー:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.isClosing = true;
    this.stopPingInterval();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private setupMessageHandler(): void {
    if (!this.ws) return;
    
    this.ws.removeAllListeners?.('message') || this.ws.removeEventListener('message', () => {});
    
    this.ws.addEventListener('message', (event: any) => {
      try {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'pong') {
          const latency = Date.now() - this.lastPingTime;
          console.error(`[WebSocketTransport] Pong受信 (latency: ${latency}ms)`);
          return;
        }
        
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
        } else if (msg.type === 'stderr' && msg.data) {
          console.error(`[WebSocketTransport] stderr: ${msg.data}`);
        } else if (msg.type === 'exit') {
          console.error(`[WebSocketTransport] プロセス終了 (code: ${msg.code})`);
          this.isClosing = true;
          if (this.onclose) {
            this.onclose();
          }
        }
      } catch (e) {
        console.error('[WebSocketTransport] メッセージ処理エラー:', e);
      }
    });
  }

  private handleConnectionFailure(reject: (error: Error) => void, error: Error): void {
    this.isConnected = false;
    
    if (this.reconnectAttempts < this.options.reconnectAttempts!) {
      console.error(`[WebSocketTransport] 接続失敗、再試行予定...`);
      this.scheduleReconnect();
    } else {
      console.error(`[WebSocketTransport] 最大再試行回数に到達しました`);
      if (this.onerror) {
        this.onerror(error);
      }
      reject(error);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    
    // 指数バックオフ
    const baseDelay = this.options.reconnectDelay!;
    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.options.maxReconnectDelay!
    );
    
    console.error(`[WebSocketTransport] ${delay}ms後に再接続します (試行 ${this.reconnectAttempts}/${this.options.reconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.isClosing) {
        this.connect().catch(error => {
          console.error('[WebSocketTransport] 再接続失敗:', error);
        });
      }
    }, delay);
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.lastPingTime = Date.now();
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error('[WebSocketTransport] Ping送信エラー:', error);
        }
      }
    }, this.options.pingInterval!);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private flushBuffer(): void {
    if (this.jsonBuffer.trim()) {
      try {
        const jsonRpcMessage = JSON.parse(this.jsonBuffer);
        if (this.onmessage) {
          this.onmessage(jsonRpcMessage);
        }
      } catch (e) {
        console.error('[WebSocketTransport] バッファフラッシュエラー:', e);
      }
    }
    this.jsonBuffer = '';
  }
}