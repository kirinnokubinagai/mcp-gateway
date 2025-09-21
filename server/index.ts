import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { ConfigManagerImpl } from './config-manager';
import { ConnectionPool } from './connection-pool';
import { createLogger, setupGlobalErrorHandlers } from './logger';
import { MCPClientManagerImpl } from './mcp-client-manager';
import { MCPServerImpl } from './mcp-server';
import { measurePerformance } from './performance-optimizer';
import { ProfileSwitcherImpl } from './profile-switcher';
import { SignalManagerImpl, SignalData } from './signal-manager';
import { StateManager } from './state-manager';
import { ServerConfig, Config, Tool } from './types';

// 新しいモジュールをインポート

const logger = createLogger({ module: 'MCPGateway' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// プロセスロックファイル
const LOCK_FILE = path.join(__dirname, '../.mcp-gateway.lock');

// プロセスロックを確認（改善版）
function checkProcessLock(): void {
  try {
    // Claude Desktop/Code経由の場合はロックファイルチェックをスキップ
    const isStdio = !process.stdin.isTTY && !process.stdout.isTTY;
    if (isStdio) {
      logger.info('stdio接続検出 - ロックファイルチェックをスキップ');
      return;
    }

    if (fs.existsSync(LOCK_FILE)) {
      const pid = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
      // プロセスが実行中か確認
      try {
        process.kill(parseInt(pid), 0); // プロセスの存在チェック
        // 追加チェック：同じコマンドで実行されているか確認
        const isRunning = require('child_process')
          .execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8' })
          .includes('server/index.ts');

        if (isRunning) {
          logger.error(`MCP Gatewayは既に実行中です (PID: ${pid})`);
          process.exit(1);
        } else {
          // 別のプロセスが同じPIDを使用している
          logger.warn(`PID ${pid}は別のプロセスです。ロックファイルを更新`);
          fs.unlinkSync(LOCK_FILE);
        }
      } catch {
        // プロセスが存在しない場合は古いロックファイルを削除
        logger.warn(`古いロックファイルを削除します (PID: ${pid})`);
        fs.unlinkSync(LOCK_FILE);
      }
    }
    // ロックファイルを作成
    fs.writeFileSync(LOCK_FILE, process.pid.toString());
  } catch (error) {
    logger.error('プロセスロックの確認に失敗しました', error as Error);
  }
}

// プロセス終了時にロックファイルを削除
function removeLockFile(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const pid = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
      if (pid === process.pid.toString()) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch (error) {
    logger.error('ロックファイルの削除に失敗しました', error as Error);
  }
}

// プロセス終了時のクリーンアップ
process.on('exit', removeLockFile);
process.on('SIGINT', () => {
  removeLockFile();
  process.exit(0);
});
process.on('SIGTERM', () => {
  removeLockFile();
  process.exit(0);
});

// プロセスロックを確認
checkProcessLock();

// 接続プールのインスタンスを作成 - タイムアウト設定を統一
const connectionPool = new ConnectionPool({
  maxConnectionsPerServer: 1, // 1サーバー1接続で十分
  maxTotalConnections: 50, // 多くのMCPサーバーに対応
  connectionTimeout: 5000, // 5秒に短縮して高速化
  idleTimeout: 300000, // 5分で十分
  healthCheckIntervalMs: 120000, // 2分間隔で健全性チェック
  maxHealthCheckFailures: 3, // デフォルト値
  queueTimeout: 5000, // 5秒に短縮
});

// 状態管理の初期化
const STATUS_FILE = path.join(__dirname, '../mcp-status.json');
const TOOLS_FILE = path.join(__dirname, '../mcp-tools.json');
const stateManager = new StateManager(STATUS_FILE, TOOLS_FILE);

// マネージャーのインスタンスを作成
const configManager = new ConfigManagerImpl();
const signalManager = new SignalManagerImpl();
const clientManager = new MCPClientManagerImpl(connectionPool, stateManager);
const profileSwitcher = new ProfileSwitcherImpl(stateManager, clientManager);
const mcpServer = new MCPServerImpl(clientManager, stateManager);

// グローバル変数
let config: Config | null = null;
let activeProfile = process.env.MCP_PROFILE || 'default';
const profileStates: Record<string, boolean> = {};
let initialized = false;

// 接続プールのイベントリスナーを設定
connectionPool.on('connection:created', ({ key, connection: _connection }) => {
  logger.info(`[接続プール] 新規接続作成: ${key}`);
});

connectionPool.on('connection:reused', ({ key, connection: _connection }) => {
  logger.debug(`[接続プール] 接続再利用: ${key}`);
});

connectionPool.on('connection:error', ({ key, error }) => {
  logger.error(`[接続プール] 接続エラー: ${key}`, error);
});

connectionPool.on('connection:removed', ({ key }) => {
  logger.info(`[接続プール] 接続削除: ${key}`);
});

connectionPool.on('health-check:failed', ({ connection, failures }) => {
  logger.warn(`[接続プール] ヘルスチェック失敗: ${connection.config.name} (失敗回数: ${failures})`);
});

// 設定ファイルの読み込み
async function loadConfig(): Promise<Config> {
  const result = await measurePerformance('設定ファイル読み込み', async () => {
    return await configManager.loadConfig();
  });

  return result.data;
}

// MCPサーバーへの接続
async function connectToMCPServer(
  serverName: string,
  serverConfig: ServerConfig,
  retryCount: number
): Promise<void> {
  await clientManager.connectToMCPServer(serverName, serverConfig, retryCount);
}

// MCPサーバーからの切断
async function disconnectFromMCPServer(
  serverName: string,
  cleanup: boolean = false
): Promise<void> {
  await clientManager.disconnectFromMCPServer(serverName, cleanup);
}

// 利用可能なツールの取得
async function getAvailableTools(): Promise<Tool[]> {
  return await clientManager.getAvailableTools();
}

// すべてのサーバーを同期
async function syncAllServers(): Promise<void> {
  if (!config) {
    logger.warn('設定が読み込まれていません');
    return;
  }

  logger.info('すべてのサーバーを同期中...');

  // 新しい構造: profiles配列から有効なサーバーリストを取得
  const currentProfileServers = config.profiles?.[activeProfile];
  if (!currentProfileServers) {
    logger.warn(`プロファイル ${activeProfile} が見つかりません`);
    return;
  }

  logger.debug('Config in syncAllServers:', {
    configType: typeof config,
    hasProfiles: !!config?.profiles,
    hasMcpServers: !!config?.mcpServers,
    currentProfile: activeProfile,
    serverCount: currentProfileServers.length,
  });

  logger.debug('Profile servers:', { servers: currentProfileServers.join(', '), count: currentProfileServers.length });
  logger.debug('Passing to switchProfile:', {
    serverCount: currentProfileServers.length,
    activeProfile: activeProfile || 'none',
    configType: typeof config,
    hasProfiles: !!config?.profiles,
  });

  // ProfileSwitcherを使用してプロファイルを切り替え
  try {
    await profileSwitcher.switchProfile(activeProfile, config);
    await updateServerStatus();
    logger.info('すべてのサーバーの同期が完了しました');
  } catch (error) {
    logger.error('プロファイル切り替え中にエラーが発生しましたが、システムは継続します:', error);
    // エラーが発生してもMCP Gateway全体は継続
  }
}

// 特定のサーバーのみを同期
async function syncServersWithProfile(
  serverNames: string[],
  profileName: string,
  profileStates: Record<string, boolean>,
  config: Record<string, unknown>,
  _mcpServers: Record<string, unknown>
): Promise<void> {
  await profileSwitcher.syncServersWithProfile(
    serverNames,
    profileName,
    profileName,
    profileStates,
    config
  );
  await updateServerStatus();
}

// プロファイルの切り替え
async function switchProfile(profileName: string): Promise<void> {
  if (!config) {
    throw new Error('設定が読み込まれていません');
  }

  await profileSwitcher.switchProfile(profileName, config);
  activeProfile = profileName;

  await updateServerStatus();
}

// サーバーステータスの更新
async function updateServerStatus(): Promise<void> {
  await mcpServer.updateServerStatus();
}

// 設定変更通知の処理
export async function notifyConfigChange(affectedServers?: string[]): Promise<void> {
  logger.info(`API経由で設定が変更されました。再読み込み中...`, {
    affectedServers: affectedServers?.join(', ') || 'all',
    count: affectedServers?.length || 0,
  });

  try {
    // 設定を再読み込み
    config = await loadConfig();

    if (affectedServers && affectedServers.length > 0) {
      logger.info(`影響を受けるサーバーのみ同期: ${affectedServers.join(', ')}`);

      // 変更されたサーバーを一旦切断してから再接続
      await disconnectServers(affectedServers);

      // 少し待ってから再接続（安定性のため）
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 影響を受けるサーバーのみを再接続
      await reconnectServers(affectedServers);
    } else {
      logger.info('すべてのサーバーを同期');
      // すべてのサーバーを同期（フォールバック）
      await syncAllServers();
    }

    logger.info('設定変更の同期が完了しました');
  } catch (error) {
    logger.error('設定変更の同期に失敗しました', error as Error);
  }
}

/**
 * 特定のサーバーのみを再接続する
 */
export async function reconnectServers(serverNames: string[]): Promise<void> {
  if (!config || !serverNames || serverNames.length === 0) {
    return;
  }

  logger.info(`特定のサーバーを再接続します: ${serverNames.join(', ')}`);

  try {
    // 影響を受けるサーバーのみを同期
    await syncServersWithProfile(
      serverNames,
      activeProfile,
      profileStates,
      config as Record<string, unknown>,
      config?.mcpServers || {}
    );

    logger.info(`サーバーの再接続が完了しました: ${serverNames.join(', ')}`);
  } catch (error) {
    logger.error('サーバーの再接続に失敗しました', error as Error);
  }
}

/**
 * サーバーを切断する（再接続のため）
 */
export async function disconnectServers(serverNames: string[]): Promise<void> {
  if (!serverNames || serverNames.length === 0) {
    return;
  }

  logger.info(`サーバーを切断します: ${serverNames.join(', ')}`);

  try {
    // 各サーバーを切断
    for (const serverName of serverNames) {
      try {
        await disconnectFromMCPServer(serverName);
        logger.debug(`サーバーを切断しました: ${serverName}`);
      } catch (error) {
        const err = error as Error;
        logger.warn(`サーバーの切断に失敗しました: ${serverName}`, {
          error: err.message,
          stack: err.stack,
          serverName,
        });
      }
    }
  } catch (error) {
    const err = error as Error;
    logger.error('サーバーの切断中にエラーが発生しました', {
      error: err.message,
      stack: err.stack,
    });
  }
}

// プロファイル切り替え通知の処理
export async function notifyProfileSwitch(
  profileName: string,
  affectedServers?: string[]
): Promise<void> {
  logger.info(`プロファイル切り替え通知を受け取りました: ${profileName}`, {
    affectedServers: affectedServers?.join(', ') || 'all',
    count: affectedServers?.length || 0,
  });

  try {
    const previousProfile = activeProfile;
    await switchProfile(profileName);

    logger.info(`プロファイルを ${previousProfile} から ${profileName} に切り替えました`);
  } catch (error) {
    const err = error as Error;
    logger.error('プロファイルの切り替えに失敗しました', {
      error: err.message,
      stack: err.stack,
      profileName,
    });
  }
}

// シグナルファイル監視のコールバック
async function handleSignal(signal: SignalData): Promise<void> {
  logger.info('設定変更シグナルを処理します', {
    signalType: signal.type,
    timestamp: signal.timestamp,
    profile: signal.profile,
    affectedServers: signal.affectedServers?.join(', ') || 'none',
  });

  try {
    switch (signal.type) {
      case 'config-update':
        await notifyConfigChange(signal.affectedServers);
        break;
      case 'profile-update':
        if (signal.profile) {
          await notifyProfileSwitch(signal.profile, signal.affectedServers);
        }
        break;
      case 'profile-switch-only':
        if (signal.profile) {
          activeProfile = signal.profile;
          logger.info(
            `プロファイルを ${signal.previousProfile} から ${signal.profile} に切り替えました`
          );
        }
        break;
      default:
        logger.warn('未知のシグナルタイプ', { signal });
    }
  } catch (error) {
    logger.error('シグナルの処理に失敗しました', error as Error);
  }
}

// 初期化処理
async function initialize(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    logger.info('MCP Gatewayを初期化中...');

    // 設定を読み込み
    config = await loadConfig();
    logger.info('設定を読み込みました', {
      configType: typeof config,
      hasMcpServers: !!config?.mcpServers,
      serverCount: Object.keys(config?.mcpServers || {}).length,
    });

    // シグナル監視を開始
    signalManager.startSignalWatcher(handleSignal);

    // 初回同期を実行
    await syncAllServers();

    initialized = true;
    logger.info('MCP Gatewayの初期化が完了しました');
  } catch (error) {
    logger.error('MCP Gatewayの初期化に失敗しました', error as Error);
    throw error;
  }
}

// クリーンアップ処理
async function cleanup(): Promise<void> {
  logger.info('MCP Gatewayをクリーンアップ中...');

  try {
    // シグナル監視を停止
    signalManager.stopSignalWatcher();

    // すべての接続をクリーンアップ
    await clientManager.cleanupAllConnections();

    // 接続プールをクリーンアップ
    if (typeof connectionPool.closeAll === 'function') {
      await connectionPool.closeAll();
    }

    // 接続プールのdestroyメソッドを呼び出してWebSocket接続を確実にクリーンアップ
    if (typeof connectionPool.destroy === 'function') {
      connectionPool.destroy();
    }

    // 状態マネージャーのリソースをクリーンアップ
    if (typeof stateManager.destroy === 'function') {
      stateManager.destroy();
    }

    // パフォーマンスオプティマイザーのメモリ監視を停止
    try {
      const { MemoryManager } = await import('./performance-optimizer');
      MemoryManager.stopMonitoring();
    } catch (error) {
      // performance-optimizerが利用できない場合は無視
    }

    // パフォーマンス最適化のリソースをクリーンアップ
    try {
      const { cleanup } = await import('./performance-optimizer');
      if (typeof cleanup === 'function') {
        cleanup();
      }
    } catch (error) {
      // performance-optimizerが利用できない場合は無視
    }

    // エラーハンドラーのリソースをクリーンアップ
    try {
      const { ErrorHandler } = await import('./error-handler');
      if (typeof ErrorHandler.destroy === 'function') {
        ErrorHandler.destroy();
      }
    } catch (error) {
      // error-handlerが利用できない場合は無視
    }

    // ロガーリソースをクリーンアップ
    if (typeof logger.cleanup === 'function') {
      logger.cleanup();
    }

    // APIサーバーのリソースをクリーンアップ
    try {
      const { cleanupAPIServer } = await import('./api-server');
      if (typeof cleanupAPIServer === 'function') {
        cleanupAPIServer();
      }
    } catch (error) {
      // APIサーバーが利用できない場合は無視
    }

    logger.info('MCP Gatewayのクリーンアップが完了しました');
  } catch (error) {
    logger.error('クリーンアップ中にエラーが発生しました', error as Error);
  }
}

// メイン処理
async function main(): Promise<void> {
  const startTime = Date.now();
  const startTimeString = new Date(startTime).toISOString();
  
  try {
    // プロセス開始時刻をログに記録
    logger.info(`MCP Gateway起動開始: ${startTimeString}`);
    
    // グローバルエラーハンドラーを設定
    setupGlobalErrorHandlers();

    // 先にサーバー接続を開始
    // Claude Desktopがtools/listを送信する前に接続を開始する
    await initialize();

    // MCPサーバーのハンドラーを設定
    // MCPサーバーの初期化（ハンドラーを設定）
    await mcpServer.initialize();

    // ハンドラー設定後にstdio通信を開始
    const { server } = mcpServer as any;
    if (server) {
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
      const transport = new StdioServerTransport();

      console.error('[MCP Gateway] Connecting transport to server with handlers already set');
      
      // デバッグ: transport をインターセプト
      const originalOnData = transport.onData;
      transport.onData = (data: any) => {
        console.error('[MCP Gateway] RECEIVED REQUEST:', JSON.stringify(data));
        return originalOnData.call(transport, data);
      };
      
      await server.connect(transport);

      // ログはstderrのみに出力（stdoutはMCPプロトコル専用）
      console.error('[MCP Gateway] Server connected via stdio, ready to receive requests');
    }

    // プロセスを維持（stdio接続を維持するため）
    process.stdin.resume();

    // プロセス終了時のクリーンアップ
    process.on('SIGINT', async () => {
      logger.error('SIGINT受信: プロセスが中断されました (Ctrl+C)');
      await cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.error('SIGTERM受信: プロセスがタイムアウトまたは外部から終了されました');
      
      // 即座にタイムアウト情報をログ出力
      const uptime = Math.floor(process.uptime());
      const currentTime = new Date().toISOString();
      const elapsedMs = Date.now() - startTime;
      
      logger.error(`プロセス実行時間: ${uptime}秒 (${elapsedMs}ms)`);
      logger.error(`開始: ${startTimeString} → 終了: ${currentTime}`);

      if (uptime >= 30) {
        logger.error(`30秒制限によるタイムアウトの可能性が高いです`);
      } else {
        logger.error(`手動終了またはその他の理由による終了`);
      }
      
      // クリーンアップを非同期で実行し、5秒でタイムアウト
      const cleanupPromise = cleanup();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('クリーンアップタイムアウト')), 5000);
      });
      
      try {
        await Promise.race([cleanupPromise, timeoutPromise]);
        logger.info('クリーンアップが完了しました');
      } catch (error) {
        logger.error('クリーンアップがタイムアウトしました', error as Error);
        console.error('クリーンアップがタイムアウトしました', error);
      }
      
      process.exit(0);
    });

    process.on('uncaughtException', async (error) => {
      console.error('[FATAL] Uncaught exception:', error);
      logger.error('未捕捉の例外が発生しました', error);
      await cleanup();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      console.error('[FATAL] Unhandled rejection:', reason);
      logger.error('未処理のPromise拒否が発生しました', { reason, promise });
      await cleanup();
      process.exit(1);
    });

    logger.info('MCP Gatewayが起動しました');
  } catch (error) {
    logger.error('MCP Gatewayの起動に失敗しました', error as Error);
    process.exit(1);
  }
}

// スクリプトとして直接実行された場合のみメイン処理を実行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('致命的なエラーが発生しました', error);
    process.exit(1);
  });
}

// エクスポート
export {
  clientManager,
  configManager,
  signalManager,
  profileSwitcher,
  mcpServer,
  stateManager,
  connectionPool,
  initialize,
  cleanup,
  loadConfig,
  connectToMCPServer,
  disconnectFromMCPServer,
  getAvailableTools,
  syncAllServers,
  syncServersWithProfile,
  switchProfile,
  updateServerStatus,
};
