import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import { createLogger } from './logger.js';
import { ServerConfig, Tool } from './types.js';

const logger = createLogger({ module: 'StateManager' });

/**
 * サーバーの状態を表す型
 */
export interface ServerState {
  status: 'connected' | 'error' | 'disabled' | 'updating';
  config: ServerConfig;
  configHash?: string;
  error?: string;
  errorType?: string;
  errorDetails?: string;
  lastUpdate?: Date;
  retryCount?: number;
}

/**
 * 状態変更イベントの型定義
 */
export interface StateChangeEvent {
  type: 'server-state-changed' | 'server-tools-changed' | 'server-deleted';
  serverName: string;
  state?: ServerState;
  tools?: Tool[];
}

/**
 * 統一された状態管理クラス
 * 
 * MCP Gatewayの全ての状態を一元管理し、状態の一貫性を保証します。
 * メモリとファイルの二重管理を解消し、イベント駆動で状態を同期します。
 */
export class StateManager extends EventEmitter {
  private serverStates: Map<string, ServerState> = new Map();
  private serverTools: Map<string, Tool[]> = new Map();
  private statusFilePath: string;
  private toolsFilePath: string;
  private saveQueue: AsyncSaveQueue;
  private initialized: boolean = false;
  private pendingStateUpdates: Map<string, Partial<ServerState>> = new Map();
  private pendingToolUpdates: Map<string, Tool[]> = new Map();
  private batchUpdateTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_UPDATE_MS = 50;

  constructor(statusFilePath: string, toolsFilePath: string) {
    super();
    this.statusFilePath = statusFilePath;
    this.toolsFilePath = toolsFilePath;
    this.saveQueue = new AsyncSaveQueue();
  }

  /**
   * 状態管理を初期化する
   * 
   * ファイルから既存の状態を読み込み、メモリに展開します。
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // ステータスファイルの読み込み
      await this.loadStatesFromFile();
      
      // ツールファイルの読み込み
      await this.loadToolsFromFile();
      
      this.initialized = true;
      logger.info('状態管理の初期化が完了しました');
    } catch (error) {
      logger.error('状態管理の初期化エラー', error as Error);
      // 初期化エラーでも続行（空の状態から開始）
      this.initialized = true;
    }
  }

  /**
   * サーバーの状態を更新する（トランザクション的）
   * 
   * @param serverName - サーバー名
   * @param state - 新しい状態
   * @param atomic - 原子性を保証するかどうか
   */
  async updateServerState(serverName: string, state: Partial<ServerState>, atomic: boolean = true): Promise<void> {
    const startTime = Date.now();
    
    try {
      if (atomic) {
        // 既存の状態を保持（ロールバック用）
        const previousState = this.serverStates.get(serverName);
        
        try {
          // 状態を検証
          this.validateServerState(serverName, state);
          
          // メモリ上の状態を更新
          const currentState = this.serverStates.get(serverName) || {
            status: 'disabled',
            config: {} as ServerConfig
          };
          
          const newState: ServerState = {
            ...currentState,
            ...state,
            lastUpdate: new Date()
          };
          
          this.serverStates.set(serverName, newState);
          
          // ファイルに保存（非同期）
          this.saveQueue.enqueue(() => this.saveStatesToFile());
          
          // イベントを発行
          this.emit('state-changed', {
            type: 'server-state-changed',
            serverName,
            state: newState
          } as StateChangeEvent);
          
          // WebSocket通知
          await this.notifyWebSocketClients();
          
          logger.debug(`サーバー状態更新完了: ${serverName}`, {
            serverName,
            status: newState.status,
            duration: Date.now() - startTime
          });
          
        } catch (error) {
          // エラー時はロールバック
          if (previousState) {
            this.serverStates.set(serverName, previousState);
          } else {
            this.serverStates.delete(serverName);
          }
          throw error;
        }
      } else {
        // 非原子的更新（パフォーマンス優先）
        const currentState = this.serverStates.get(serverName) || {
          status: 'disabled',
          config: {} as ServerConfig
        };
        
        const newState: ServerState = {
          ...currentState,
          ...state,
          lastUpdate: new Date()
        };
        
        this.serverStates.set(serverName, newState);
        this.saveQueue.enqueue(() => this.saveStatesToFile());
        
        this.emit('state-changed', {
          type: 'server-state-changed',
          serverName,
          state: newState
        } as StateChangeEvent);
      }
    } catch (error) {
      logger.error(`サーバー状態更新エラー: ${serverName}`, error as Error);
      throw error;
    }
  }

  /**
   * サーバーのツールを更新する
   * 
   * @param serverName - サーバー名
   * @param tools - ツールのリスト
   */
  async updateServerTools(serverName: string, tools: Tool[]): Promise<void> {
    try {
      this.serverTools.set(serverName, tools);
      
      // ファイルに保存（非同期）
      this.saveQueue.enqueue(() => this.saveToolsToFile());
      
      // イベントを発行
      this.emit('state-changed', {
        type: 'server-tools-changed',
        serverName,
        tools
      } as StateChangeEvent);
      
      logger.debug(`ツール更新完了: ${serverName}, ツール数: ${tools.length}`);
    } catch (error) {
      logger.error(`ツール更新エラー: ${serverName}`, error as Error);
      throw error;
    }
  }

  /**
   * サーバーの状態を削除する
   * 
   * @param serverName - サーバー名
   */
  async deleteServerState(serverName: string): Promise<void> {
    try {
      this.serverStates.delete(serverName);
      
      // ファイルに保存（非同期）
      this.saveQueue.enqueue(() => this.saveStatesToFile());
      
      // イベントを発行
      this.emit('state-changed', {
        type: 'server-deleted',
        serverName
      } as StateChangeEvent);
      
      logger.debug(`サーバー状態削除: ${serverName}`);
    } catch (error) {
      logger.error(`サーバー状態削除エラー: ${serverName}`, error as Error);
      throw error;
    }
  }

  /**
   * サーバーのツールを削除する
   * 
   * @param serverName - サーバー名
   */
  async deleteServerTools(serverName: string): Promise<void> {
    try {
      this.serverTools.delete(serverName);
      
      // ファイルに保存（非同期）
      this.saveQueue.enqueue(() => this.saveToolsToFile());
      
      logger.debug(`ツール削除: ${serverName}`);
    } catch (error) {
      logger.error(`ツール削除エラー: ${serverName}`, error as Error);
      throw error;
    }
  }

  /**
   * 全てのサーバー状態を取得する
   */
  getStates(): Record<string, ServerState> {
    const states: Record<string, ServerState> = {};
    for (const [name, state] of this.serverStates) {
      states[name] = { ...state };
    }
    return states;
  }

  /**
   * 特定のサーバー状態を取得する
   */
  getServerState(serverName: string): ServerState | undefined {
    const state = this.serverStates.get(serverName);
    return state ? { ...state } : undefined;
  }

  /**
   * 全てのツールを取得する
   */
  getTools(): Record<string, Tool[]> {
    const tools: Record<string, Tool[]> = {};
    for (const [name, toolList] of this.serverTools) {
      tools[name] = [...toolList];
    }
    return tools;
  }

  /**
   * 特定のサーバーのツールを取得する
   */
  getServerTools(serverName: string): Tool[] {
    const tools = this.serverTools.get(serverName);
    return tools ? [...tools] : [];
  }

  /**
   * 状態をファイルから読み込む
   */
  private async loadStatesFromFile(): Promise<void> {
    try {
      const data = await fs.readFile(this.statusFilePath, 'utf-8');
      const states = JSON.parse(data);
      
      // 簡易的な状態表現から完全な状態オブジェクトに変換
      for (const [serverName, simpleState] of Object.entries(states as Record<string, any>)) {
        const state: ServerState = {
          status: simpleState.status || 'disabled',
          config: simpleState.config || {},
          error: simpleState.error,
          errorType: simpleState.errorType,
          errorDetails: simpleState.errorDetails,
          lastUpdate: simpleState.lastUpdate ? new Date(simpleState.lastUpdate) : undefined
        };
        this.serverStates.set(serverName, state);
      }
      
      logger.debug(`状態をファイルから読み込みました: ${this.serverStates.size}個のサーバー`);
    } catch (error) {
      // ファイルが存在しない場合は空の状態から開始
      if ((error as any).code !== 'ENOENT') {
        logger.error('状態ファイル読み込みエラー', error as Error);
      }
    }
  }

  /**
   * ツールをファイルから読み込む
   */
  private async loadToolsFromFile(): Promise<void> {
    try {
      const data = await fs.readFile(this.toolsFilePath, 'utf-8');
      const tools = JSON.parse(data);
      
      for (const [serverName, toolList] of Object.entries(tools as Record<string, Tool[]>)) {
        this.serverTools.set(serverName, toolList);
      }
      
      logger.debug(`ツールをファイルから読み込みました: ${this.serverTools.size}個のサーバー`);
    } catch (error) {
      // ファイルが存在しない場合は空の状態から開始
      if ((error as any).code !== 'ENOENT') {
        logger.error('ツールファイル読み込みエラー', error as Error);
      }
    }
  }

  /**
   * 状態をファイルに保存する
   */
  private async saveStatesToFile(): Promise<void> {
    try {
      // UI表示用の簡易的な状態表現に変換
      const simpleStates: Record<string, any> = {};
      
      for (const [serverName, state] of this.serverStates) {
        simpleStates[serverName] = {
          enabled: state.config?.enabled ?? false,
          status: state.status,
          toolCount: this.serverTools.get(serverName)?.length || 0,
          error: state.error,
          errorType: state.errorType,
          errorDetails: state.errorDetails,
          lastUpdate: state.lastUpdate?.toISOString()
        };
      }
      
      await fs.writeFile(this.statusFilePath, JSON.stringify(simpleStates, null, 2));
      logger.debug('状態をファイルに保存しました');
    } catch (error) {
      logger.error('状態ファイル保存エラー', error as Error);
    }
  }

  /**
   * ツールをファイルに保存する
   */
  private async saveToolsToFile(): Promise<void> {
    try {
      const tools = this.getTools();
      await fs.writeFile(this.toolsFilePath, JSON.stringify(tools, null, 2));
      logger.debug('ツールをファイルに保存しました');
    } catch (error) {
      logger.error('ツールファイル保存エラー', error as Error);
    }
  }

  /**
   * WebSocketクライアントに状態変更を通知する
   */
  private async notifyWebSocketClients(): Promise<void> {
    try {
      // web-serverモジュールを動的インポート（循環依存を避けるため）
      const webServer = await import('./web-server.js' as any);
      if (webServer.broadcastStatusUpdate) {
        await webServer.broadcastStatusUpdate();
      }
    } catch (error) {
      // web-serverが起動していない場合は無視
    }
  }

  /**
   * サーバー状態を検証する
   */
  private validateServerState(serverName: string, state: Partial<ServerState>): void {
    if (!serverName || typeof serverName !== 'string') {
      throw new Error('サーバー名が無効です');
    }
    
    if (state.status && !['connected', 'error', 'disabled', 'updating'].includes(state.status)) {
      throw new Error(`無効なステータス: ${state.status}`);
    }
    
    // その他の検証ロジックを追加可能
  }

  /**
   * 統計情報を取得する
   */
  getStatistics(): {
    totalServers: number;
    connectedServers: number;
    errorServers: number;
    disabledServers: number;
    updatingServers: number;
    totalTools: number;
  } {
    let connectedServers = 0;
    let errorServers = 0;
    let disabledServers = 0;
    let updatingServers = 0;
    let totalTools = 0;

    for (const state of this.serverStates.values()) {
      switch (state.status) {
        case 'connected':
          connectedServers++;
          break;
        case 'error':
          errorServers++;
          break;
        case 'disabled':
          disabledServers++;
          break;
        case 'updating':
          updatingServers++;
          break;
      }
    }

    for (const tools of this.serverTools.values()) {
      totalTools += tools.length;
    }

    return {
      totalServers: this.serverStates.size,
      connectedServers,
      errorServers,
      disabledServers,
      updatingServers,
      totalTools
    };
  }
}

/**
 * 非同期保存キュー
 * 
 * ファイル保存操作をキューイングし、重複する保存要求を統合します。
 */
class AsyncSaveQueue {
  private queue: (() => Promise<void>)[] = [];
  private processing: boolean = false;
  private pendingSave: Map<string, () => Promise<void>> = new Map();

  /**
   * 保存操作をキューに追加する
   */
  enqueue(saveFunc: () => Promise<void>): void {
    // 同じ関数の重複を防ぐ
    const funcKey = saveFunc.toString();
    this.pendingSave.set(funcKey, saveFunc);
    
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * キューを処理する
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.pendingSave.size === 0) return;
    
    this.processing = true;
    
    try {
      // ペンディングの保存操作を取得してクリア
      const saveFuncs = Array.from(this.pendingSave.values());
      this.pendingSave.clear();
      
      // 各保存操作を順次実行
      for (const saveFunc of saveFuncs) {
        try {
          await saveFunc();
          // 保存間隔を空ける（ファイルシステムの負荷軽減）
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          logger.error('保存キュー処理エラー', error as Error);
        }
      }
    } finally {
      this.processing = false;
      
      // 新しい保存要求がある場合は再度処理
      if (this.pendingSave.size > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }
}