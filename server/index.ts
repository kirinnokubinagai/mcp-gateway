import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from 'fs/promises';
import { watch } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { StateManager, ServerState } from './state-manager.js';
import { WebSocketTransport } from './websocket-transport.js';
import {
  createErrorInfo,
  executeRecoveryStrategy,
  recordSuccess,
  recordFailure,
  getErrorStatus,
  resetCircuitBreaker,
  ErrorType,
  ErrorSeverity
} from './error-handler.js';
import { createLogger, setupGlobalErrorHandlers } from './logger.js';
import { ConnectionPool, ConnectionConfig } from './connection-pool.js';
import { ServerConfig, ProfileConfig, Config, MCPClientInfo, Tool } from './types.js';
import {
  measurePerformance,
  ParallelExecutor,
  configCache,
  debounce,
  AsyncQueue,
  LazyInitializer
} from './performance-optimizer.js';
import { configValidator } from './config-validator.js';

const logger = createLogger({ module: 'MCPGateway' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 接続プールのインスタンスを作成
const connectionPool = new ConnectionPool({
  maxConnectionsPerServer: 3,
  maxTotalConnections: 15,
  connectionTimeout: 30000,
  idleTimeout: 300000,
  healthCheckIntervalMs: 60000,
  maxHealthCheckFailures: 3,
  queueTimeout: 60000
});

// 接続プールのイベントリスナーを設定
connectionPool.on('connection:created', ({ key, connection }) => {
  logger.info(`[接続プール] 新規接続作成: ${key}`);
});

connectionPool.on('connection:reused', ({ key, connection }) => {
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

// MCPClientInfoの拡張型（Client型を含む）
interface MCPClientInfoExtended extends MCPClientInfo {
  client?: Client;
  pooledConnection?: any; // 接続プールからの参照
  transport?: any;
  tools?: Tool[];
  toolMapping?: Map<string, string>;
}

const CONFIG_FILE = path.join(__dirname, '../mcp-config.json');
const STATUS_FILE = path.join(__dirname, '../mcp-status.json');
const TOOLS_FILE = path.join(__dirname, '../mcp-tools.json');

export const mcpClients = new Map<string, MCPClientInfoExtended>();
export const stateManager = new StateManager(STATUS_FILE, TOOLS_FILE);

async function loadConfig(): Promise<Config> {
  const cacheKey = 'config';
  
  // キャッシュから取得を試みる
  const cached = configCache.get(cacheKey);
  if (cached) {
    return cached as Config;
  }
  
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const rawConfig = JSON.parse(data);
    
    // 設定ファイルの検証
    const validationResult = await configValidator.validateConfig(rawConfig, false);
    
    if (!validationResult.valid) {
      logger.error('設定ファイルの検証エラー', {
        errors: validationResult.errors,
        warnings: validationResult.warnings
      });
      
      // 自動修復を試みる
      const repairResult = await configValidator.repairConfig(rawConfig, false);
      if (repairResult.repaired) {
        logger.info('設定ファイルを自動修復しました', {
          changes: repairResult.changes
        });
        
        // 修復された設定を保存
        await fs.writeFile(CONFIG_FILE, JSON.stringify(repairResult.config, null, 2));
        
        return repairResult.config;
      }
      
      throw new Error('設定ファイルの検証に失敗しました');
    }
    
    // 警告がある場合はログに記録
    if (validationResult.warnings && validationResult.warnings.length > 0) {
      logger.warn('設定ファイルの警告', {
        warnings: validationResult.warnings
      });
    }
    
    const config = validationResult.normalized || rawConfig;
    
    // プロファイル設定がない場合は初期化
    if (!config.profiles) {
      config.profiles = {
        claude_code: {},
        claude_desktop: {},
        gemini_cli: {},
        default: {}
      };
    }
    
    // 環境変数でプロファイルを上書き
    if (process.env.MCP_PROFILE) {
      config.activeProfile = process.env.MCP_PROFILE;
      logger.info(`環境変数からプロファイルを設定: ${process.env.MCP_PROFILE}`, { profile: process.env.MCP_PROFILE });
    }
    
    // キャッシュに保存（5秒間有効）
    configCache.set(cacheKey, config, 5000);
    
    return config;
  } catch (error) {
    logger.error('設定ファイルの読み込みエラー', error as Error);
    // ファイルが存在しない場合は空の設定を返す（ファイルは作成しない）
    const defaultConfig = { 
      mcpServers: {},
      profiles: {
        claude_code: {},
        claude_desktop: {},
        gemini_cli: {},
        default: {}
      }
    };
    
    // デフォルト設定もキャッシュ
    configCache.set(cacheKey, defaultConfig, 5000);
    
    return defaultConfig;
  }
}

function isServerEnabledForProfile(serverName: string, config: Config): boolean {
  // WebUI経由の場合は常にすべてのサーバーを有効化
  if (!process.env.MCP_PROFILE) {
    return config.mcpServers[serverName]?.enabled ?? false;
  }
  
  // CLI経由（--profileフラグあり）の場合はプロファイルベースで制御
  if (!config.activeProfile || !config.profiles) {
    return config.mcpServers[serverName]?.enabled ?? false;
  }
  
  const profile = config.profiles[config.activeProfile];
  if (!profile) {
    return config.mcpServers[serverName]?.enabled ?? false;
  }
  
  // プロファイルに設定がある場合はそれを使用、なければ元のenabledフラグを使用
  if (serverName in profile) {
    return profile[serverName];
  }
  
  return config.mcpServers[serverName]?.enabled ?? false;
}

function expandEnvVariables<T>(obj: T): T {
  if (typeof obj === 'string') {
    return obj.replace(/\${([^}]+)}/g, (match, varName) => {
      return process.env[varName] || match;
    }) as unknown as T;
  } else if (Array.isArray(obj)) {
    return obj.map(item => expandEnvVariables(item)) as unknown as T;
  } else if (typeof obj === 'object' && obj !== null) {
    const expanded: any = {};
    for (const [key, value] of Object.entries(obj)) {
      expanded[key] = expandEnvVariables(value);
    }
    return expanded;
  }
  return obj;
}

/**
 * 設定オブジェクトのハッシュ値を計算する
 * 
 * ServerConfigオブジェクトの内容をJSON文字列化し、SHA256ハッシュを生成します。
 * このハッシュ値は設定の変更検出に使用されます。
 * 環境変数は展開前の状態でハッシュ化され、enabledフラグは含まれません。
 * 
 * @param config - ハッシュ値を計算する設定オブジェクト
 * @returns SHA256ハッシュ値の16進数文字列
 */
function calculateConfigHash(config: ServerConfig): string {
  // enabledフラグは除外（プロファイルで制御されるため）
  const normalizedConfig = {
    command: config.command,
    args: config.args || [],
    env: config.env || {}
  };
  
  // ソートされたキーで確定的なJSON文字列を生成
  const configString = JSON.stringify(normalizedConfig, null, 0);
  return createHash('sha256').update(configString).digest('hex');
}

/**
 * Dockerイメージ名を抽出する
 * 
 * Dockerコマンドの引数リストからイメージ名を抽出します。
 * オプションフラグとその値を正確にスキップし、イメージ名を特定します。
 * 
 * @param args - Dockerコマンドの引数リスト
 * @returns イメージ名、見つからない場合はnull
 */
function extractDockerImageName(args: string[]): string | null {
  if (!args) return null;
  
  // 'run'コマンドの位置を探す
  const runIndex = args.indexOf('run');
  if (runIndex === -1) return null;
  
  // 値を取るオプションのセット
  const optionsWithValue = new Set([
    '--name', '--memory', '--cpus', '--network', '--user',
    '-e', '--env', '-v', '--volume', '--workdir', '-w',
    '--entrypoint', '--hostname', '-h', '--label', '-l',
    '--log-driver', '--log-opt', '--mount', '--publish', '-p'
  ]);
  
  // 'run'以降の引数からイメージ名を探す
  for (let i = runIndex + 1; i < args.length; i++) {
    const arg = args[i];
    
    // オプションフラグはスキップ
    if (arg.startsWith('-')) {
      // 値を取るオプションの場合は次の引数もスキップ
      if (optionsWithValue.has(arg)) {
        i++;
      } else if (arg.includes('=')) {
        // --option=value 形式は単独でスキップ
        continue;
      }
      continue;
    }
    
    // ここに到達した最初の非オプション引数がイメージ名
    return arg;
  }
  
  return null;
}

// ステータス更新をデバウンス
const debouncedUpdateServerStatus = debounce(async () => {
  // 並列でステータスとツールを更新
  const updatePromises: Promise<void>[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    const serverState: Partial<ServerState> = {
      status: client.status,
      config: client.config,
      configHash: client.configHash,
      error: client.error,
      errorType: client.errorType,
      errorDetails: client.errorDetails,
      retryCount: client.retryCount
    };
    
    updatePromises.push(
      stateManager.updateServerState(serverName, serverState, false) // 非原子的更新でパフォーマンス優先
    );
    
    if (client.tools) {
      updatePromises.push(stateManager.updateServerTools(serverName, client.tools));
    } else if (client.status === 'error' || client.status === 'disabled') {
      updatePromises.push(stateManager.deleteServerTools(serverName));
    }
  }
  
  // 削除されたサーバーの状態もクリーンアップ
  const states = stateManager.getStates();
  for (const serverName of Object.keys(states)) {
    if (!mcpClients.has(serverName)) {
      updatePromises.push(stateManager.deleteServerState(serverName));
      updatePromises.push(stateManager.deleteServerTools(serverName));
    }
  }
  
  // すべての更新を並列実行
  await Promise.all(updatePromises);
}, 100);

export async function updateServerStatus() {
  debouncedUpdateServerStatus();
}

@measurePerformance
async function connectToMCPServer(name: string, config: ServerConfig, retryCount?: number): Promise<any> {
  
  try {
    // 既存の接続をクリーンアップ
    const existingClient = mcpClients.get(name);
    if (existingClient && existingClient.pooledConnection) {
      logger.debug(`既存のプール接続を返却: ${name}`, { serverName: name });
      connectionPool.release(existingClient.pooledConnection);
    }
    
    // 初回接続時のみログを出力
    if (!existingClient || existingClient.status !== 'error') {
      logger.info(`MCPサーバーに接続中: ${name}`, { serverName: name });
    }
    
    mcpClients.set(name, {
      config,
      configHash: calculateConfigHash(config),
      status: 'updating',
      statusMessage: '接続を確立しています...'
    });
    await updateServerStatus();
    
    let expandedConfig = {
      command: expandEnvVariables(config.command),
      args: expandEnvVariables(config.args || []),
      env: expandEnvVariables(config.env || {})
    };
    
    // 常にプロキシサーバー経由で接続
    const proxyPort = process.env.MCP_PROXY_PORT || '9999';
    const proxyHost = 'host.docker.internal';
    const proxyUrl = `ws://${proxyHost}:${proxyPort}`;
    
    // 接続プール用の設定を作成
    const connectionConfig: ConnectionConfig = {
      name,
      websocket: proxyUrl,
      command: expandedConfig.command,
      args: expandedConfig.args,
      env: expandedConfig.env,
      sessionId: `${name}-${Date.now()}`
    };
    
    // 接続プールから接続を取得
    const pooledConnection = await connectionPool.acquire(connectionConfig);
    const { client, transport } = pooledConnection;
    
    // WebSocket切断時の処理（プールが管理するため、ここでは最小限の処理）
    if (transport instanceof WebSocketTransport) {
      const originalOnClose = transport.onclose;
      transport.onclose = async () => {
        if (originalOnClose) {
          await originalOnClose();
        }
        
        logger.warn(`WebSocket接続が切断されました`, { serverName: name });
        const clientInfo = mcpClients.get(name);
        if (clientInfo && clientInfo.status === 'connected') {
          // プール接続を削除
          connectionPool.remove(pooledConnection);
          
          mcpClients.set(name, {
            ...clientInfo,
            status: 'error',
            error: 'コンテナが終了しました',
            pooledConnection: undefined
          });
          await updateServerStatus();
          
          // エラー情報を作成
          const errorInfo = createErrorInfo('コンテナが終了しました', name);
          recordFailure(name, errorInfo);
          
          // 復旧戦略を実行（サーキットブレーカーとバックオフ付き）
          if (errorInfo.retryable) {
            const errorStatus = getErrorStatus(name, 'コンテナが終了しました');
            if (errorStatus.canRetry) {
              // 指数バックオフによる再接続遅延
              const currentRetryCount = clientInfo.retryCount || 0;
              const delay = Math.min(1000 * Math.pow(2, currentRetryCount), 30000); // 最大30秒
              
              logger.info(`再接続を${delay}ms後に実行します`, { 
                serverName: name, 
                retryCount: currentRetryCount + 1,
                delay 
              });
              
              setTimeout(async () => {
                const currentConfig = await loadConfig();
                const serverConfig = currentConfig.mcpServers[name];
                if (serverConfig && isServerEnabledForProfile(name, currentConfig)) {
                  await connectToMCPServer(name, serverConfig, currentRetryCount + 1);
                }
              }, delay);
            } else {
              logger.warn(`サーキットブレーカーが開いているため再接続をスキップ`, { 
                serverName: name,
                errorCount: errorStatus.errorCount
              });
            }
          }
        }
      };
    }
    
    // 初回接続時のみログを出力
    if (!existingClient || existingClient.status !== 'error') {
      logger.info(`接続完了`, { serverName: name });
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    let tools: any[] = [];
    const toolMapping = new Map<string, string>();
    
    try {
      const response = await client.listTools();
      tools = response.tools || [];
      
      // 初回接続時のみ詳細ログを出力
      if (!existingClient || existingClient.status !== 'error') {
        logger.debug(`ツール取得成功: ${tools.length}個`, { serverName: name, toolCount: tools.length });
      }
      
      tools.forEach(tool => {
        const gatewayToolName = tool.name.startsWith(`${name}_`) 
          ? tool.name 
          : `${name}_${tool.name}`;
        
        toolMapping.set(gatewayToolName, tool.name);
      });
    } catch (error) {
      // エラーログは最小限に
    }
    
    mcpClients.set(name, {
      client,
      transport,
      config,
      configHash: calculateConfigHash(config),
      tools,
      toolMapping,
      status: 'connected',
      pooledConnection,
      retryCount: retryCount || 0
    });
    
    await updateServerStatus();
    
    return { success: true, tools };
  } catch (error) {
    const errorMessage = (error as Error).message;
    let errorType = 'unknown';
    let userFriendlyMessage = '';
    
    // エラーの種類を判定して、わかりやすいメッセージを設定
    if (errorMessage.includes('タイムアウト') || errorMessage.includes('timeout')) {
      errorType = 'timeout';
      userFriendlyMessage = `接続タイムアウト: ${config.command}が応答しません`;
      logger.error(userFriendlyMessage, error, { serverName: name, errorType: 'timeout' });
      
    } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      errorType = 'package_not_found';
      userFriendlyMessage = `パッケージが見つかりません: ${config.command} ${(config.args || []).join(' ')}`;
      logger.error(userFriendlyMessage, error, { serverName: name, errorType: 'package_not_found' });
    } else if (errorMessage.includes('spawn') || errorMessage.includes('ENOENT')) {
      errorType = 'command_not_found';
      userFriendlyMessage = `コマンドが見つかりません: ${config.command}`;
      logger.error(userFriendlyMessage, error, { serverName: name, errorType: 'command_not_found' });
    } else if (errorMessage.includes('ECONNREFUSED')) {
      errorType = 'connection_refused';
      userFriendlyMessage = 'プロキシサーバーに接続できません。プロキシサーバーが起動しているか確認してください。';
      logger.error(userFriendlyMessage, error, { serverName: name, errorType: 'connection_refused' });
    } else if (errorMessage.includes('permission') || errorMessage.includes('EACCES')) {
      errorType = 'permission_denied';
      userFriendlyMessage = '権限がありません。コマンドの実行権限を確認してください。';
      logger.error(userFriendlyMessage, error, { serverName: name, errorType: 'permission_denied' });
    } else {
      errorType = 'connection_failed';
      userFriendlyMessage = `接続に失敗しました: ${errorMessage}`;
      logger.error(userFriendlyMessage, error, { serverName: name, errorType: 'connection_failed' });
    }
    
    // リトライが終了したか、リトライ対象外のエラーの場合
    mcpClients.set(name, {
      config,
      configHash: calculateConfigHash(config),
      status: 'error',
      error: userFriendlyMessage,
      errorType,
      errorDetails: errorMessage
    });
    
    await updateServerStatus();
    
    return { success: false, error: userFriendlyMessage };
  }
}

const mcpServer = new Server(
  {
    name: "mcp-gateway",
    version: "3.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.debug(`ツールリストのリクエスト受信`);
  const tools: any[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    if (client.status === 'connected' && client.tools) {
      for (const tool of client.tools) {
        const gatewayToolName = tool.name.startsWith(`${serverName}_`) 
          ? tool.name 
          : `${serverName}_${tool.name}`;
        
        tools.push({
          name: gatewayToolName,
          description: `[${serverName}] ${tool.description}`,
          inputSchema: tool.inputSchema
        });
      }
    }
  }
  
  tools.push({
    name: "gateway_list_servers",
    description: "接続されたMCPサーバーの一覧を表示",
    inputSchema: { type: "object", properties: {} }
  });
  
  // ホストコマンド実行ツールを追加（汎用）
  tools.push({
    name: "host_execute_command",
    description: "[host] ホストマシンでコマンドを実行（say, osascript, open, notify-send など）",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "実行するコマンド名（say, osascript, open など）"
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "コマンドに渡す引数"
        }
      },
      required: ["command"]
    }
  });
  
  logger.debug(`合計ツール数: ${tools.length}`, { totalTools: tools.length });
  return { tools };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  logger.info(`ツール実行: ${name}`, { toolName: name });
  
  if (name === "gateway_list_servers") {
    const config = await loadConfig();
    const status: Record<string, any> = {};
    
    for (const [serverName, client] of mcpClients.entries()) {
      status[serverName] = {
        enabled: config.mcpServers[serverName]?.enabled || false,
        status: client.status,
        toolCount: client.tools?.length || 0,
        error: client.error
      };
    }
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(status, null, 2)
      }]
    };
  }
  
  const separatorIndex = name.indexOf('_');
  if (separatorIndex === -1) {
    throw new Error(`不正なツール名形式: ${name}`);
  }
  
  const serverName = name.substring(0, separatorIndex);
  
  // ホストコマンド実行の特別処理
  if (name === 'host_execute_command') {
    const commandName = args.command;
    const commandArgs = args.args || [];
    
    // 許可されたコマンドのホワイトリスト
    const allowedCommands = ['say', 'osascript', 'notify-send', 'open'];
    
    if (!allowedCommands.includes(commandName)) {
      throw new Error(`許可されていないコマンド: ${commandName}。許可されているコマンド: ${allowedCommands.join(', ')}`);
    }
    
    try {
      // WebSocketプロキシ経由でホストコマンド実行
      const WebSocket = (await import('ws')).default;
      const proxyUrl = process.env.DOCKER_ENV === 'true' 
        ? 'ws://host.docker.internal:9999'
        : 'ws://localhost:9999';
      
      const ws = new WebSocket(proxyUrl);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('ホストコマンド実行タイムアウト'));
        }, 10000);
        
        ws.on('open', () => {
          const hostCommand = {
            type: 'host-command',
            command: commandName,
            args: commandArgs
          };
          ws.send(JSON.stringify(hostCommand));
        });
        
        ws.on('message', (data: any) => {
          const response = JSON.parse(data.toString());
          if (response.type === 'host-command-result') {
            clearTimeout(timeout);
            ws.close();
            
            if (response.success) {
              resolve({
                content: [
                  {
                    type: "text",
                    text: response.data || `コマンド '${commandName}' が正常に実行されました`
                  }
                ]
              });
            } else {
              reject(new Error(response.message || 'コマンド実行失敗'));
            }
          }
        });
        
        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      logger.error(`ホストコマンド実行エラー`, error as Error);
      throw error;
    }
  }
  
  const client = mcpClients.get(serverName);
  
  if (!client || client.status !== 'connected' || !client.client) {
    throw new Error(`サーバー ${serverName} は接続されていません`);
  }
  
  let originalToolName: string;
  if (client.toolMapping && client.toolMapping.has(name)) {
    originalToolName = client.toolMapping.get(name)!;
  } else {
    const serverPrefix = `${serverName}_`;
    if (name.startsWith(serverPrefix)) {
      originalToolName = name.substring(serverPrefix.length);
    } else {
      originalToolName = name;
    }
  }
  
  try {
    const result = await client.client.callTool({
      name: originalToolName,
      arguments: args
    });
    
    return result;
  } catch (error) {
    logger.error(`ツール実行エラー`, error as Error, { toolName: name });
    return {
      content: [{
        type: "text",
        text: `エラー: ${(error as Error).message}`
      }]
    };
  }
});

/**
 * MCPサーバーから切断する
 * 
 * 指定されたMCPサーバーとの接続を終了し、関連するプロセスをクリーンアップします。
 * 接続プールに接続を返却します。
 * 
 * @param name - 切断するMCPサーバーの名前
 */
async function disconnectFromMCPServer(name: string) {
  const clientInfo = mcpClients.get(name);
  if (clientInfo) {
    try {
      logger.info(`MCPサーバーから切断中: ${name}`, { serverName: name });
      
      // 接続プールに返却
      if (clientInfo.pooledConnection) {
        connectionPool.release(clientInfo.pooledConnection);
      } else if (clientInfo.client) {
        // レガシー接続の場合は直接クローズ
        await clientInfo.client.close();
        
        if (clientInfo.transport && 'close' in clientInfo.transport) {
          await clientInfo.transport.close();
        }
      }
      
      mcpClients.delete(name);
      logger.debug(`切断完了`, { serverName: name });
    } catch (error) {
      logger.error(`切断エラー`, error as Error, { serverName: name });
    }
  }
}

/**
 * 設定ファイルとの同期を行う
 * 
 * 設定ファイルの内容と現在の接続状態を比較し、必要最小限の変更のみを適用します。
 * サーバー名の変更を検出し、不要な再接続を避けるため設定のハッシュ値を使用します。
 */
@measurePerformance
async function syncWithConfig() {
  const config = await loadConfig();
  const currentServers = new Set(mcpClients.keys());
  const configServers = new Set(Object.keys(config.mcpServers));
  
  logger.info(`設定同期開始`, { 
    currentConnections: currentServers.size,
    configServers: configServers.size 
  });
  
  // 並列処理用のタスクリスト（AsyncQueueで管理）
  const taskQueue = new AsyncQueue<() => Promise<any>>(async (task) => {
    try {
      await task();
    } catch (error) {
      logger.error('タスク実行エラー', error as Error);
    }
  });
  
  const disconnectTasks: Promise<void>[] = [];
  const connectTasks: Promise<any>[] = [];
  const updateTasks: { name: string, action: () => Promise<any> }[] = [];
  
  // 1. サーバー名の変更を検出（ハッシュ値とDockerイメージ名で比較）
  const renamedServers = new Map<string, string>(); // oldName -> newName
  const processedConfigs = new Set<string>(); // 処理済みの設定名を追跡
  
  // 設定のハッシュマップを事前に計算
  const configHashMap = new Map<string, string>();
  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    configHashMap.set(name, calculateConfigHash(serverConfig));
  }
  
  for (const [currentName, clientInfo] of mcpClients.entries()) {
    if (!configServers.has(currentName)) {
      // 現在の名前が設定に存在しない場合、同じ設定を持つサーバーを探す
      for (const [configName, serverConfig] of Object.entries(config.mcpServers)) {
        // すでに接続があるか、処理済みの設定はスキップ
        if (mcpClients.has(configName) || processedConfigs.has(configName)) {
          continue;
        }
        
        // Dockerコンテナの場合は特別な処理
        if (clientInfo.config.command === 'docker' && serverConfig.command === 'docker' &&
            clientInfo.config.args?.includes('run') && serverConfig.args?.includes('run')) {
          const currentImage = extractDockerImageName(clientInfo.config.args || []);
          const configImage = extractDockerImageName(serverConfig.args || []);
          
          if (currentImage && configImage && currentImage === configImage) {
            logger.info(`名前変更検出 - Docker`, {
              oldName: currentName,
              newName: configName,
              dockerImage: currentImage
            });
            renamedServers.set(currentName, configName);
            processedConfigs.add(configName);
            break;
          }
        } else {
          // 通常のサーバーはハッシュ値で比較
          const configHash = configHashMap.get(configName)!;
          if (clientInfo.configHash === configHash) {
            logger.info(`名前変更検出`, {
              oldName: currentName,
              newName: configName,
              reason: '設定が同一'
            });
            renamedServers.set(currentName, configName);
            processedConfigs.add(configName);
            break;
          }
        }
      }
    }
  }
  
  // 2. 名前変更されたサーバーの接続を移行（即座に実行）
  if (renamedServers.size > 0) {
    logger.info(`名前変更されたサーバーの移行開始`, { count: renamedServers.size });
    for (const [oldName, newName] of renamedServers.entries()) {
      const clientInfo = mcpClients.get(oldName)!;
      const newConfig = config.mcpServers[newName];
      const newHash = configHashMap.get(newName)!;
      
      // 設定が実際に変更されているか確認
      const configChanged = clientInfo.configHash !== newHash;
      
      mcpClients.delete(oldName);
      mcpClients.set(newName, {
        ...clientInfo,
        config: newConfig,
        configHash: newHash
      });
      
      logger.info(`サーバー名変更を処理`, {
        oldName,
        newName,
        configChanged,
        action: configChanged ? '再接続が必要' : '名前のみ変更'
      });
      
      // 設定が変更されている場合は再接続が必要
      if (configChanged && isServerEnabledForProfile(newName, config)) {
        updateTasks.push({
          name: newName,
          action: async () => {
            await disconnectFromMCPServer(newName);
            await connectToMCPServer(newName, newConfig, 0);
          }
        });
      }
    }
  }
  
  // 3. 削除されたサーバーの切断
  const serversToDelete = Array.from(currentServers).filter(
    name => !configServers.has(name) && !renamedServers.has(name)
  );
  
  if (serversToDelete.length > 0) {
    logger.info(`削除されたサーバーを検出`, { 
      servers: serversToDelete,
      count: serversToDelete.length 
    });
    for (const name of serversToDelete) {
      disconnectTasks.push(disconnectFromMCPServer(name));
    }
  }
  
  // 4. 各サーバーの接続状態を確認
  const statusChanges = {
    toDisable: [] as string[],
    toAdd: [] as string[],
    toUpdate: [] as string[],
    toReconnect: [] as string[],
    unchanged: [] as string[]
  };
  
  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    // 名前変更で処理済みのサーバーはスキップ
    if (processedConfigs.has(name) && !updateTasks.some(t => t.name === name)) {
      continue;
    }
    
    const currentClient = mcpClients.get(name);
    const isEnabled = isServerEnabledForProfile(name, config);
    
    if (!isEnabled && currentClient) {
      statusChanges.toDisable.push(name);
      disconnectTasks.push(disconnectFromMCPServer(name));
      continue;
    }
    
    if (isEnabled) {
      const newConfigHash = configHashMap.get(name)!;
      
      // 新規接続が必要な場合
      if (!currentClient) {
        statusChanges.toAdd.push(name);
        connectTasks.push(
          connectToMCPServer(name, serverConfig, 0).catch(error => {
            logger.error(`サーバー接続失敗`, error as Error, { serverName: name });
          })
        );
      }
      // 設定が変更された場合（ハッシュ値で比較）
      else if (currentClient.configHash !== newConfigHash) {
        statusChanges.toUpdate.push(name);
        updateTasks.push({
          name,
          action: async () => {
            await disconnectFromMCPServer(name);
            await connectToMCPServer(name, serverConfig, 0).catch(error => {
              logger.error(`再接続に失敗`, error as Error, { serverName: name });
            });
          }
        });
      }
      // 設定は同じだがエラー状態の場合
      else if (currentClient.status === 'error') {
        statusChanges.toReconnect.push(name);
        // サーキットブレーカーをリセットして再接続を試行
        resetCircuitBreaker(name);
        connectTasks.push(
          connectToMCPServer(name, serverConfig, 0).catch(error => {
            logger.error(`再接続に失敗`, error as Error, { serverName: name });
          })
        );
      }
      // 設定が同じで接続も正常な場合
      else {
        statusChanges.unchanged.push(name);
        // enabled フラグのみ更新（プロファイル変更対応）
        if (currentClient.config.enabled !== serverConfig.enabled) {
          currentClient.config.enabled = serverConfig.enabled;
          // 状態マネージャーにも反映
          stateManager.updateServerState(name, {
            config: currentClient.config
          }, false);
        }
      }
    }
  }
  
  // 変更サマリーを表示
  logger.info(`変更サマリー`);
  if (statusChanges.toDisable.length > 0) {
    logger.info(`[無効化] ${statusChanges.toDisable.join(', ')}`);
  }
  if (statusChanges.toAdd.length > 0) {
    logger.info(`[新規追加] ${statusChanges.toAdd.join(', ')}`);
  }
  if (statusChanges.toUpdate.length > 0) {
    logger.info(`[設定変更] ${statusChanges.toUpdate.join(', ')}`);
  }
  if (statusChanges.toReconnect.length > 0) {
    logger.info(`[再接続] ${statusChanges.toReconnect.join(', ')}`);
  }
  if (statusChanges.unchanged.length > 0) {
    logger.info(`[変更なし] ${statusChanges.unchanged.length}個のサーバー`);
  }
  
  // 5. すべてのタスクを実行
  const totalTasks = disconnectTasks.length + connectTasks.length + updateTasks.length;
  
  if (totalTasks === 0) {
    logger.info(`変更はありません`);
  } else {
    logger.info(`実行するタスク: 合計 ${totalTasks}個`);
    
    // 切断タスクを先に実行
    if (disconnectTasks.length > 0) {
      logger.info(`切断タスクを実行中... (${disconnectTasks.length}個)`);
      await Promise.all(disconnectTasks);
    }
    
    // 更新タスク（切断→再接続）を順次実行
    if (updateTasks.length > 0) {
      logger.info(`更新タスクを実行中... (${updateTasks.length}個)`);
      for (const task of updateTasks) {
        await task.action();
      }
    }
    
    // 新規接続タスクを並列実行（同時実行数を制限）
    if (connectTasks.length > 0) {
      logger.info(`接続タスクを実行中... (${connectTasks.length}個)`);
      // CPU コア数に基づいて同時実行数を決定
      const os = await import('os');
      const concurrency = Math.max(2, Math.min(os.cpus().length, 8));
      
      await ParallelExecutor.mapConcurrent(
        connectTasks,
        async (task) => await task,
        concurrency
      );
    }
  }
  
  await updateServerStatus();
  logger.info(`設定同期完了`);
}


// 設定ファイル監視とリロード機能
let configWatcher: any = null;
let reloadTimeout: NodeJS.Timeout | null = null;

function startConfigWatcher() {
  if (configWatcher) return;
  
  configWatcher = watch(CONFIG_FILE, async (eventType) => {
    if (eventType === 'change') {
      // デバウンス処理
      if (reloadTimeout) {
        clearTimeout(reloadTimeout);
      }
      
      reloadTimeout = setTimeout(async () => {
        logger.info(`設定ファイルが変更されました。検証と再読み込み中...`);
        
        // キャッシュをクリア
        configCache.delete('config');
        
        // 変更された設定を検証
        const validationResult = await configValidator.validateConfig(CONFIG_FILE);
        
        if (!validationResult.valid) {
          logger.error(`変更された設定ファイルに問題があります`, undefined, {
            errors: validationResult.errors,
            warnings: validationResult.warnings,
            formattedResult: configValidator.formatValidationResult(validationResult)
          });
          
          // 致命的なエラーがある場合は再読み込みをスキップ
          const criticalErrors = validationResult.errors.filter(error => 
            error.type === 'schema' || error.type === 'dependency'
          );
          
          if (criticalErrors.length > 0) {
            logger.error(`致命的なエラーのため設定の再読み込みをスキップします`);
            return;
          }
        } else if (validationResult.warnings.length > 0) {
          logger.warn(`変更された設定ファイルに警告があります`, {
            warnings: validationResult.warnings,
            formattedResult: configValidator.formatValidationResult(validationResult)
          });
        }
        
        await syncWithConfig();
      }, 1000);
    }
  });
}

// API経由で設定が変更されたときの通知を受け取る
export async function notifyConfigChange() {
  logger.info(`API経由で設定が変更されました。再読み込み中...`);
  // キャッシュをクリア
  configCache.delete('config');
  await syncWithConfig();
}

async function main() {
  logger.info(`MCP Gateway Server 起動中...`);
  
  // グローバルエラーハンドラーを設定
  setupGlobalErrorHandlers();
  
  // メモリ管理の設定
  memoryManager.onHighMemory(async () => {
    logger.warn('高メモリ使用率を検出しました。クリーンアップを実行します');
    
    // 設定キャッシュをクリア
    configCache.clear();
    
    // 未使用の接続をクリーンアップ
    const stats = connectionPool.getStats();
    if (stats.idleConnections > 5) {
      logger.info(`アイドル接続をクリーンアップ: ${stats.idleConnections}個`);
      // 接続プールが自動的に管理
    }
    
    // ガベージコレクションのヒント
    if (global.gc) {
      global.gc();
    }
  });
  
  // 状態管理を初期化
  await stateManager.initialize();
  
  // コマンドライン引数からプロファイルを取得
  const args = process.argv.slice(2);
  const profileIndex = args.findIndex(arg => arg === '--profile' || arg === '-p');
  if (profileIndex !== -1 && args[profileIndex + 1]) {
    const profile = args[profileIndex + 1];
    process.env.MCP_PROFILE = profile;
    logger.info(`コマンドライン引数からプロファイルを設定: ${profile}`, { profile });
  }
  
  // 設定ファイルの検証を実行
  logger.info(`設定ファイルを検証中...`);
  const validationResult = await configValidator.validateConfig(CONFIG_FILE);
  
  if (!validationResult.valid) {
    logger.error(`設定ファイルに問題があります`, undefined, {
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      formattedResult: configValidator.formatValidationResult(validationResult)
    });
    
    // 致命的なエラーがある場合は起動を中止
    const criticalErrors = validationResult.errors.filter(error => 
      error.type === 'schema' || error.type === 'dependency'
    );
    
    if (criticalErrors.length > 0) {
      logger.error(`致命的なエラーのため起動を中止します`);
      process.exit(1);
    }
  } else if (validationResult.warnings.length > 0 || validationResult.suggestions.length > 0) {
    logger.warn(`設定ファイルの検証で警告または提案があります`, {
      warnings: validationResult.warnings,
      suggestions: validationResult.suggestions,
      formattedResult: configValidator.formatValidationResult(validationResult)
    });
  } else {
    logger.info(`設定ファイルの検証が完了しました: 問題なし`);
  }
  
  // syncWithConfigは内部でエラーハンドリングするので、ここでは待つだけ
  await syncWithConfig();
  
  // 設定ファイル監視を開始
  startConfigWatcher();
  
  // シャットダウン時の処理
  const cleanup = async () => {
    logger.info('シャットダウン中...');
    
    // 監視タイマーをクリア
    clearInterval(monitoringInterval);
    if (configWatcher) {
      configWatcher.close();
    }
    
    // メモリ監視を停止
    memoryManager.stopMonitoring();
    
    // キャッシュをクリア
    configCache.destroy();
    
    // 接続プールをクローズ
    await connectionPool.closeAll();
    
    process.exit(0);
  };
  
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  // 定期的に接続プールの統計情報を出力とメモリ情報
  const monitoringInterval = setInterval(() => {
    const stats = connectionPool.getStats();
    const memInfo = memoryManager.getMemoryInfo();
    
    logger.debug(`[接続プール統計] 総接続数: ${stats.totalConnections}, アクティブ: ${stats.activeConnections}, アイドル: ${stats.idleConnections}, 待機中: ${stats.waitingRequests}`);
    logger.debug(`[メモリ使用状況] ヒープ: ${memInfo.heapUsed}/${memInfo.heapTotal} (${memInfo.heapUsedRatio}), RSS: ${memInfo.rss}`);
  }, 60000); // 1分ごと
  
  // 標準のstdioモード（claude-codeコンテナから使用）
  logger.info(`stdioモードで起動します...`);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  
  
  logger.info(`MCP Gateway Server 起動完了`);
}

main().catch((error) => {
  logger.error(`起動エラー`, error as Error);
  process.exit(1);
});