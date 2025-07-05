import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'WebSocketTransport' });

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
  enableCompression?: boolean;
  bufferSize?: number;
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
  private messageQueue: any[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  
  constructor(private options: WebSocketTransportOptions) {
    this.options.reconnectAttempts = this.options.reconnectAttempts ?? 5;
    this.options.reconnectDelay = this.options.reconnectDelay ?? 1000;
    this.options.maxReconnectDelay = this.options.maxReconnectDelay ?? 30000;
    this.options.pingInterval = this.options.pingInterval ?? 30000;
    this.options.enableCompression = this.options.enableCompression ?? true;
    this.options.bufferSize = this.options.bufferSize ?? 65536;
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
        logger.info(`接続試行 #${attemptNumber}`, { 
          url: this.options.url, 
          command: this.options.command, 
          args: this.options.args 
        });
        
        this.ws = new WebSocket(this.options.url);
        
        // タイムアウト設定（デフォルト30秒）
        const timeoutMs = this.options.timeout || 30000;
        const timeout = setTimeout(() => {
          if (!this.isConnected) {
            logger.warn(`接続タイムアウト`, { timeoutMs });
            this.ws?.close();
            this.handleConnectionFailure(reject, new Error(`WebSocket接続タイムアウト (${timeoutMs}ms): ${this.options.command}`));
          }
        }, timeoutMs);
        
        this.ws.addEventListener('open', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          const connectionDuration = Date.now() - this.connectionStartTime;
          logger.info(`接続成功`, { connectionDuration });
          
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
              logger.debug(`Pong受信`, { latency });
              return;
            }
            
            if (message.type === 'ready') {
              clearTimeout(timeout);
              logger.info(`MCPサーバー準備完了`);
              
              // メッセージハンドラーを設定
              this.setupMessageHandler();
              resolve();
              
            } else if (message.type === 'error') {
              clearTimeout(timeout);
              logger.error(`エラー受信: ${message.message}`);
              this.handleConnectionFailure(reject, new Error(message.message));
            }
          } catch (e) {
            logger.error(`メッセージ解析エラー`, e as Error);
          }
        });

        this.ws.addEventListener('error', (event: any) => {
          clearTimeout(timeout);
          const errorMessage = event.message || event.type || 'Connection failed';
          logger.error(`接続エラー: ${errorMessage}`);
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
          
          logger.info(`接続終了`, { code: event.code, reason: event.reason || 'なし' });
          
          // 残りのバッファを処理
          this.flushBuffer();
          
          if (!this.isClosing && this.reconnectAttempts < this.options.reconnectAttempts!) {
            logger.info(`再接続を試行します`);
            this.scheduleReconnect();
          } else {
            if (this.onclose) {
              this.onclose();
            }
          }
        });
      } catch (error) {
        logger.error(`接続セットアップエラー`, error as Error);
        this.handleConnectionFailure(reject, error as Error);
      }
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== 1) { // WebSocket.OPEN = 1
      throw new Error('WebSocket接続が閉じています');
    }

    const data = JSON.stringify(message) + '\n';
    
    // メッセージをキューに追加
    this.messageQueue.push({
      type: 'stdin',
      data: data
    });
    
    // バッチ送信のスケジュール
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flushMessageQueue(), 10);
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
          logger.debug(`Pong受信`, { latency });
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
          logger.warn(`stderr: ${msg.data}`);
        } else if (msg.type === 'exit') {
          logger.info(`プロセス終了`, { code: msg.code });
          this.isClosing = true;
          if (this.onclose) {
            this.onclose();
          }
        }
      } catch (e) {
        logger.error(`メッセージ処理エラー`, e as Error);
      }
    });
  }

  private handleConnectionFailure(reject: (error: Error) => void, error: Error): void {
    this.isConnected = false;
    
    if (this.reconnectAttempts < this.options.reconnectAttempts!) {
      logger.warn(`接続失敗、再試行予定`);
      this.scheduleReconnect();
    } else {
      logger.error(`最大再試行回数に到達しました`);
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
    
    logger.info(`${delay}ms後に再接続します`, { attempt: this.reconnectAttempts, maxAttempts: this.options.reconnectAttempts });
    
    setTimeout(() => {
      if (!this.isClosing) {
        this.connect().catch(error => {
          logger.error(`再接続失敗`, error as Error);
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
          logger.error(`Ping送信エラー`, error as Error);
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
        logger.error(`バッファフラッシュエラー`, e as Error);
      }
    }
    this.jsonBuffer = '';
  }
  
  private flushMessageQueue(): void {
    this.flushTimeout = null;
    
    if (this.messageQueue.length === 0 || !this.ws || this.ws.readyState !== 1) {
      return;
    }
    
    try {
      // 複数のメッセージをバッチで送信
      if (this.messageQueue.length === 1) {
        this.ws.send(JSON.stringify(this.messageQueue[0]));
      } else {
        // バッチメッセージとして送信
        this.ws.send(JSON.stringify({
          type: 'batch',
          messages: this.messageQueue
        }));
      }
      
      this.messageQueue = [];
    } catch (error) {
      logger.error(`バッチ送信エラー`, error as Error);
      // エラー時はキューを保持して再試行
      this.flushTimeout = setTimeout(() => this.flushMessageQueue(), 100);
    }
  }

  /**
   * 接続の健全性をチェック
   * 
   * WebSocket接続が正常に動作しているかを確認します。
   * 接続プールが死んだ接続を検出するために使用されます。
   * 
   * @returns 接続が健全な場合true、それ以外はfalse
   */
  async isHealthy(): Promise<boolean> {
    // WebSocketが接続されていない場合
    if (!this.ws || this.ws.readyState !== 1) {
      return false;
    }

    // 接続フラグをチェック
    if (!this.isConnected || this.isClosing) {
      return false;
    }

    // Ping/Pongによる簡易的な健全性チェック
    try {
      // Pingを送信して応答を待つ
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 5000); // 5秒のタイムアウト

        const originalLastPingTime = this.lastPingTime;
        this.lastPingTime = Date.now();

        // 一時的なメッセージハンドラーを設定
        const handleMessage = (event: any) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'pong') {
              clearTimeout(timeout);
              this.ws.removeEventListener('message', handleMessage);
              resolve(true);
            }
          } catch (e) {
            // 無視
          }
        };

        this.ws.addEventListener('message', handleMessage);

        // Pingを送信
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          clearTimeout(timeout);
          this.ws.removeEventListener('message', handleMessage);
          this.lastPingTime = originalLastPingTime;
          resolve(false);
        }
      });
    } catch (error) {
      logger.error(`健全性チェックエラー`, error as Error);
      return false;
    }
  }

  /**
   * 接続状態を取得
   * 
   * @returns 接続状態の詳細情報
   */
  getConnectionState(): {
    isConnected: boolean;
    isClosing: boolean;
    readyState: number | null;
    reconnectAttempts: number;
    lastPingTime: number;
    connectionDuration: number;
  } {
    return {
      isConnected: this.isConnected,
      isClosing: this.isClosing,
      readyState: this.ws?.readyState ?? null,
      reconnectAttempts: this.reconnectAttempts,
      lastPingTime: this.lastPingTime,
      connectionDuration: this.isConnected ? Date.now() - this.connectionStartTime : 0
    };
  }
}