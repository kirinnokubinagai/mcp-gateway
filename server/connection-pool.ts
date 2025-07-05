import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WebSocketTransport } from './websocket-transport.js';
import { createLogger } from './logger.js';
import { EventEmitter } from 'events';

const logger = createLogger({ module: 'ConnectionPool' });

/**
 * 接続設定
 * 
 * MCPサーバーへの接続に必要な設定情報を定義します。
 * プロキシサーバー経由でDockerコンテナ内のMCPサーバーに接続するための設定です。
 */
export interface ConnectionConfig {
  name: string;
  websocket: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  sessionId?: string;
}

/**
 * プール接続
 * 
 * 接続プール内で管理される個々の接続を表します。
 * MCPクライアント、トランスポート層、設定情報、使用状況を保持します。
 */
export interface PooledConnection {
  client: Client;
  transport: WebSocketTransport;
  config: ConnectionConfig;
  createdAt: number;
  lastUsedAt: number;
  usageCount: number;
  isHealthy: boolean;
  healthCheckFailures: number;
}

/**
 * 接続プールオプション
 * 
 * 接続プールの動作を制御するための設定オプションです。
 * 接続数の制限、タイムアウト、健全性チェックの設定を含みます。
 */
export interface ConnectionPoolOptions {
  maxConnectionsPerServer?: number;
  maxTotalConnections?: number;
  connectionTimeout?: number;
  idleTimeout?: number;
  healthCheckIntervalMs?: number;
  maxHealthCheckFailures?: number;
  queueTimeout?: number;
}

/**
 * 接続待機リクエスト
 * 
 * 接続プールが満杯の場合に待機するリクエストを表します。
 * 接続が利用可能になったときに解決されます。
 */
interface WaitingRequest {
  config: ConnectionConfig;
  resolve: (connection: PooledConnection) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * 接続プール統計情報
 * 
 * 接続プールの現在の状態を表す統計情報です。
 * 監視やデバッグに使用されます。
 */
export interface ConnectionPoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  connectionsByServer: Record<string, number>;
}

/**
 * 接続プール管理クラス
 * 
 * WebSocket接続の効率的な管理を行うクラスです。
 * 接続の再利用、健全性チェック、自動クリーンアップ機能を提供します。
 * 
 * 主な機能:
 * - 接続のプーリングと再利用
 * - サーバーごとの接続数制限
 * - アイドル接続の自動削除
 * - 健全性チェックによるデッドコネクション検出
 * - 接続待機キューの管理
 */
export class ConnectionPool extends EventEmitter {
  private connections: Map<string, PooledConnection[]> = new Map();
  private activeConnections: Set<PooledConnection> = new Set();
  private waitingQueue: WaitingRequest[] = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private options: Required<ConnectionPoolOptions>;

  constructor(options: ConnectionPoolOptions = {}) {
    super();
    this.options = {
      maxConnectionsPerServer: options.maxConnectionsPerServer ?? 5,
      maxTotalConnections: options.maxTotalConnections ?? 20,
      connectionTimeout: options.connectionTimeout ?? 30000,
      idleTimeout: options.idleTimeout ?? 300000,
      healthCheckIntervalMs: options.healthCheckIntervalMs ?? 60000,
      maxHealthCheckFailures: options.maxHealthCheckFailures ?? 3,
      queueTimeout: options.queueTimeout ?? 60000
    };

    this.startHealthCheck();
    this.startIdleCheck();
  }

  /**
   * 接続を取得または作成
   * 
   * 指定された設定に基づいて接続を取得します。
   * 既存の健全な接続があれば再利用し、なければ新規作成します。
   * 接続数が上限に達している場合はキューに入れて待機します。
   * 
   * @param config - 接続設定
   * @returns プールされた接続
   * @throws 接続タイムアウトまたはキュータイムアウトエラー
   */
  async acquire(config: ConnectionConfig): Promise<PooledConnection> {
    const key = this.getConnectionKey(config);
    
    // 既存の健全な接続を探す
    const existingConnections = this.connections.get(key) || [];
    const availableConnection = existingConnections.find(conn => 
      !this.activeConnections.has(conn) && conn.isHealthy
    );

    if (availableConnection) {
      this.activeConnections.add(availableConnection);
      availableConnection.lastUsedAt = Date.now();
      availableConnection.usageCount++;
      
      logger.debug(`接続を再利用: ${key}`, {
        usageCount: availableConnection.usageCount,
        connectionAge: Date.now() - availableConnection.createdAt
      });
      
      this.emit('connection:reused', { key, connection: availableConnection });
      return availableConnection;
    }

    // 接続数の上限チェック
    const totalConnections = this.getTotalConnectionCount();
    const serverConnections = existingConnections.length;

    if (totalConnections >= this.options.maxTotalConnections ||
        serverConnections >= this.options.maxConnectionsPerServer) {
      // キューに入れて待機
      return this.waitForConnection(config);
    }

    // 新規接続を作成
    return this.createConnection(config);
  }

  /**
   * 接続を返却
   * 
   * 使用済みの接続をプールに返却します。
   * 接続は再利用のためにプール内で保持されます。
   * 
   * @param connection - 返却する接続
   */
  release(connection: PooledConnection): void {
    this.activeConnections.delete(connection);
    connection.lastUsedAt = Date.now();
    
    const key = this.getConnectionKey(connection.config);
    logger.debug(`接続を返却: ${key}`);
    
    // 待機中のリクエストがあれば処理
    this.processWaitingQueue();
  }

  /**
   * 接続を削除
   * 
   * 指定された接続をプールから完全に削除します。
   * エラーが発生した接続や不要になった接続の削除に使用します。
   * 
   * @param connection - 削除する接続
   */
  async remove(connection: PooledConnection): Promise<void> {
    const key = this.getConnectionKey(connection.config);
    const connections = this.connections.get(key) || [];
    
    const index = connections.indexOf(connection);
    if (index !== -1) {
      connections.splice(index, 1);
      if (connections.length === 0) {
        this.connections.delete(key);
      }
    }
    
    this.activeConnections.delete(connection);
    
    try {
      await connection.client.close();
      await connection.transport.close();
    } catch (error) {
      logger.error(`接続のクローズ中にエラー: ${key}`, error as Error);
    }
    
    logger.info(`接続を削除: ${key}`);
    this.emit('connection:removed', { key });
    
    // 待機中のリクエストを処理
    this.processWaitingQueue();
  }

  /**
   * すべての接続を閉じる
   * 
   * プール内のすべての接続を閉じて、リソースを解放します。
   * アプリケーションのシャットダウン時に使用します。
   */
  async closeAll(): Promise<void> {
    logger.info(`すべての接続を閉じています...`);
    
    // 健全性チェックとアイドルチェックを停止
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
    
    // 待機中のリクエストを拒否
    for (const request of this.waitingQueue) {
      request.reject(new Error('接続プールがシャットダウンしました'));
    }
    this.waitingQueue = [];
    
    // すべての接続を閉じる
    const closePromises: Promise<void>[] = [];
    
    for (const [key, connections] of this.connections) {
      for (const connection of connections) {
        closePromises.push(
          Promise.resolve().then(async () => {
            try {
              await connection.client.close();
              await connection.transport.close();
            } catch (error) {
              logger.error(`接続のクローズ中にエラー: ${key}`, error as Error);
            }
          })
        );
      }
    }
    
    await Promise.all(closePromises);
    
    this.connections.clear();
    this.activeConnections.clear();
    
    logger.info(`すべての接続を閉じました`);
  }

  /**
   * 統計情報を取得
   * 
   * 接続プールの現在の状態を統計情報として返します。
   * 
   * @returns 接続プールの統計情報
   */
  getStats(): ConnectionPoolStats {
    const connectionsByServer: Record<string, number> = {};
    let totalConnections = 0;
    
    for (const [key, connections] of this.connections) {
      connectionsByServer[key] = connections.length;
      totalConnections += connections.length;
    }
    
    return {
      totalConnections,
      activeConnections: this.activeConnections.size,
      idleConnections: totalConnections - this.activeConnections.size,
      waitingRequests: this.waitingQueue.length,
      connectionsByServer
    };
  }

  /**
   * 新規接続を作成
   * 
   * @param config - 接続設定
   * @returns 新規作成された接続
   * @throws 接続作成エラー
   */
  private async createConnection(config: ConnectionConfig): Promise<PooledConnection> {
    const key = this.getConnectionKey(config);
    logger.info(`新規接続を作成: ${key}`);
    
    try {
      const transport = new WebSocketTransport({
        url: config.websocket,
        command: config.command,
        args: config.args,
        env: config.env,
        timeout: this.options.connectionTimeout,
        reconnectAttempts: 0, // プール管理下では自動再接続を無効化
        pingInterval: 30000,
        enableCompression: true
      });
      
      const client = new Client({ name: config.name }, { capabilities: {} });
      await client.connect(transport);
      
      const connection: PooledConnection = {
        client,
        transport,
        config,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        usageCount: 1,
        isHealthy: true,
        healthCheckFailures: 0
      };
      
      // 接続をプールに追加
      const connections = this.connections.get(key) || [];
      connections.push(connection);
      this.connections.set(key, connections);
      
      this.activeConnections.add(connection);
      
      logger.info(`新規接続を作成しました: ${key}`);
      this.emit('connection:created', { key, connection });
      
      return connection;
    } catch (error) {
      logger.error(`接続作成エラー: ${key}`, error as Error);
      this.emit('connection:error', { key, error });
      throw error;
    }
  }

  /**
   * 接続が利用可能になるまで待機
   * 
   * @param config - 接続設定
   * @returns 利用可能になった接続
   * @throws キュータイムアウトエラー
   */
  private async waitForConnection(config: ConnectionConfig): Promise<PooledConnection> {
    const key = this.getConnectionKey(config);
    logger.info(`接続待機キューに追加: ${key}`);
    
    return new Promise((resolve, reject) => {
      const request: WaitingRequest = {
        config,
        resolve,
        reject,
        timestamp: Date.now()
      };
      
      this.waitingQueue.push(request);
      
      // タイムアウトを設定
      setTimeout(() => {
        const index = this.waitingQueue.indexOf(request);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
          reject(new Error(`接続待機タイムアウト: ${this.options.queueTimeout}ms`));
        }
      }, this.options.queueTimeout);
    });
  }

  /**
   * 待機中のリクエストを処理
   */
  private processWaitingQueue(): void {
    if (this.waitingQueue.length === 0) return;
    
    const totalConnections = this.getTotalConnectionCount();
    if (totalConnections >= this.options.maxTotalConnections) return;
    
    // 最も古いリクエストから処理
    const request = this.waitingQueue.shift();
    if (!request) return;
    
    // 再利用可能な接続を探す
    const key = this.getConnectionKey(request.config);
    const connections = this.connections.get(key) || [];
    const availableConnection = connections.find(conn => 
      !this.activeConnections.has(conn) && conn.isHealthy
    );
    
    if (availableConnection) {
      this.activeConnections.add(availableConnection);
      availableConnection.lastUsedAt = Date.now();
      availableConnection.usageCount++;
      request.resolve(availableConnection);
    } else if (connections.length < this.options.maxConnectionsPerServer) {
      // 新規接続を作成
      this.createConnection(request.config)
        .then(connection => request.resolve(connection))
        .catch(error => request.reject(error));
    } else {
      // キューに戻す
      this.waitingQueue.unshift(request);
    }
  }

  /**
   * 健全性チェックを開始
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      for (const [key, connections] of this.connections) {
        for (const connection of connections) {
          if (this.activeConnections.has(connection)) continue;
          
          try {
            // WebSocketの状態を確認
            const isHealthy = await this.checkConnectionHealth(connection);
            
            if (!isHealthy) {
              connection.healthCheckFailures++;
              connection.isHealthy = false;
              
              logger.warn(`健全性チェック失敗: ${key}`, {
                failures: connection.healthCheckFailures,
                maxFailures: this.options.maxHealthCheckFailures
              });
              
              this.emit('health-check:failed', { connection, failures: connection.healthCheckFailures });
              
              // 最大失敗回数を超えたら削除
              if (connection.healthCheckFailures >= this.options.maxHealthCheckFailures) {
                await this.remove(connection);
              }
            } else {
              connection.healthCheckFailures = 0;
              connection.isHealthy = true;
            }
          } catch (error) {
            logger.error(`健全性チェックエラー: ${key}`, error as Error);
            connection.healthCheckFailures++;
            connection.isHealthy = false;
          }
        }
      }
    }, this.options.healthCheckIntervalMs);
  }

  /**
   * アイドル接続のチェックを開始
   */
  private startIdleCheck(): void {
    this.idleCheckInterval = setInterval(async () => {
      const now = Date.now();
      
      for (const [key, connections] of this.connections) {
        const idleConnections = connections.filter(conn => 
          !this.activeConnections.has(conn) &&
          (now - conn.lastUsedAt) > this.options.idleTimeout
        );
        
        for (const connection of idleConnections) {
          logger.info(`アイドル接続を削除: ${key}`, {
            idleTime: now - connection.lastUsedAt
          });
          await this.remove(connection);
        }
      }
    }, 60000); // 1分ごとにチェック
  }

  /**
   * 接続の健全性をチェック
   * 
   * @param connection - チェックする接続
   * @returns 接続が健全な場合true
   */
  private async checkConnectionHealth(connection: PooledConnection): Promise<boolean> {
    try {
      // WebSocketTransportのisHealthyメソッドを呼び出す
      if (connection.transport && typeof connection.transport.isHealthy === 'function') {
        return await connection.transport.isHealthy();
      }
      
      // フォールバック: クライアントでツールリストを取得してみる
      await connection.client.listTools();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 接続キーを生成
   * 
   * @param config - 接続設定
   * @returns 一意な接続キー
   */
  private getConnectionKey(config: ConnectionConfig): string {
    return `${config.name}:${config.command}:${config.sessionId || 'default'}`;
  }

  /**
   * 総接続数を取得
   * 
   * @returns プール内の総接続数
   */
  private getTotalConnectionCount(): number {
    let total = 0;
    for (const connections of this.connections.values()) {
      total += connections.length;
    }
    return total;
  }
}