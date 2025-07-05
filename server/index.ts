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
import { saveStatus, saveTools } from './status-manager.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface ProfileConfig {
  [serverName: string]: boolean;
}

interface Config {
  profiles?: Record<string, ProfileConfig>;
  activeProfile?: string;
  mcpServers: Record<string, ServerConfig>;
}

interface MCPClientInfo {
  client?: Client;
  transport?: WebSocketTransport | any;
  config: ServerConfig;
  configHash?: string;
  tools?: any[];
  toolMapping?: Map<string, string>;
  status: 'connected' | 'error' | 'disabled' | 'updating';
  error?: string;
  errorType?: string;
  statusMessage?: string;
  errorDetails?: any;
  retryCount?: number;
  lastRetryTime?: Date;
}

const CONFIG_FILE = path.join(__dirname, '../mcp-config.json');
export const mcpClients = new Map<string, MCPClientInfo>();

async function loadConfig(): Promise<Config> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);
    
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
      console.error(`環境変数からプロファイルを設定: ${process.env.MCP_PROFILE}`);
    }
    
    return config;
  } catch (error) {
    console.error('設定ファイルの読み込みエラー:', error);
    // ファイルが存在しない場合は空の設定を返す（ファイルは作成しない）
    return { 
      mcpServers: {},
      profiles: {
        claude_code: {},
        claude_desktop: {},
        gemini_cli: {},
        default: {}
      }
    };
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

export async function updateServerStatus() {
  const status: Record<string, any> = {};
  const allTools: Record<string, any[]> = {};
  
  for (const [serverName, client] of mcpClients.entries()) {
    status[serverName] = {
      enabled: client.config.enabled,
      status: client.status,
      toolCount: client.tools?.length || 0,
      error: client.error
    };
    
    if (client.tools) {
      allTools[serverName] = client.tools;
    }
  }
  
  await saveStatus(status);
  await saveTools(allTools);
}

async function connectToMCPServer(name: string, config: ServerConfig): Promise<any> {
  
  try {
    // 既存の接続をクリーンアップ
    const existingClient = mcpClients.get(name);
    if (existingClient) {
      console.error(`既存の接続をクリーンアップ: ${name}`);
      if (existingClient.client) {
        try {
          await existingClient.client.close();
        } catch (e) {
          // エラーは無視
        }
      }
      if (existingClient.transport) {
        try {
          await existingClient.transport.close();
        } catch (e) {
          // エラーは無視
        }
      }
    }
    
    // 初回接続時のみログを出力
    if (!existingClient || existingClient.status !== 'error') {
      console.error(`MCPサーバーに接続中: ${name}`);
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
    
    console.error(`プロキシ設定:`, {
      proxyHost,
      proxyUrl,
      command: expandedConfig.command
    });
    
    const timeout = parseInt(process.env.MCP_CONNECTION_TIMEOUT || '30000', 10);
    console.error(`WebSocketTransportを使用: ${proxyUrl}`);
    const transport = new WebSocketTransport({
      url: proxyUrl,
      command: expandedConfig.command,
      args: expandedConfig.args,
      env: expandedConfig.env,
      timeout: timeout,
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      pingInterval: 30000
    });
    
    // WebSocket切断時の処理
    transport.onclose = async () => {
      console.error(`${name}: WebSocket接続が切断されました`);
      const clientInfo = mcpClients.get(name);
      if (clientInfo && clientInfo.status === 'connected') {
        mcpClients.set(name, {
          ...clientInfo,
          status: 'error',
          error: 'コンテナが終了しました'
        });
        await updateServerStatus();
        
        // エラー情報を作成
        const errorInfo = createErrorInfo('コンテナが終了しました', name);
        recordFailure(name, errorInfo);
        
        // 復旧戦略を実行
        if (errorInfo.retryable) {
          executeRecoveryStrategy(name, errorInfo, clientInfo.retryCount || 0, async () => {
            const currentConfig = await loadConfig();
            const serverConfig = currentConfig.mcpServers[name];
            if (serverConfig && isServerEnabledForProfile(name, currentConfig)) {
              console.error(`${name}: 自動再接続を開始します`);
              await connectToMCPServer(name, serverConfig, (clientInfo.retryCount || 0) + 1);
            }
          });
        }
      }
    };
    
    const client = new Client(
      { name: `gateway-to-${name}`, version: "1.0.0" },
      { capabilities: {} }
    );
    
    // タイムアウトなしで接続を待つ
    await client.connect(transport);
    
    // 初回接続時のみログを出力
    if (!existingClient || existingClient.status !== 'error') {
      console.error(`${name}: 接続完了`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    let tools: any[] = [];
    const toolMapping = new Map<string, string>();
    
    try {
      const response = await client.listTools();
      tools = response.tools || [];
      
      // 初回接続時のみ詳細ログを出力
      if (!existingClient || existingClient.status !== 'error') {
        console.error(`${name}のツール取得成功: ${tools.length}個`);
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
      status: 'connected'
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
      console.error(`${name}: ${userFriendlyMessage}`);
      
    } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      errorType = 'package_not_found';
      userFriendlyMessage = `パッケージが見つかりません: ${config.command} ${(config.args || []).join(' ')}`;
      console.error(`${name}: ${userFriendlyMessage}`);
    } else if (errorMessage.includes('spawn') || errorMessage.includes('ENOENT')) {
      errorType = 'command_not_found';
      userFriendlyMessage = `コマンドが見つかりません: ${config.command}`;
      console.error(`${name}: ${userFriendlyMessage}`);
    } else if (errorMessage.includes('ECONNREFUSED')) {
      errorType = 'connection_refused';
      userFriendlyMessage = 'プロキシサーバーに接続できません。プロキシサーバーが起動しているか確認してください。';
      console.error(`${name}: ${userFriendlyMessage}`);
    } else if (errorMessage.includes('permission') || errorMessage.includes('EACCES')) {
      errorType = 'permission_denied';
      userFriendlyMessage = '権限がありません。コマンドの実行権限を確認してください。';
      console.error(`${name}: ${userFriendlyMessage}`);
    } else {
      errorType = 'connection_failed';
      userFriendlyMessage = `接続に失敗しました: ${errorMessage}`;
      console.error(`${name}: ${userFriendlyMessage}`);
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
  console.error(`\n=== ツールリストのリクエスト受信 ===`);
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
  
  console.error(`合計ツール数: ${tools.length}`);
  return { tools };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  console.error(`\n=== ツール実行: ${name} ===`);
  
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
      console.error(`ホストコマンド実行エラー:`, error);
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
    console.error(`ツール実行エラー (${name}):`, (error as Error).message);
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
 * WebSocket接続の場合はWebSocketも閉じます。
 * 
 * @param name - 切断するMCPサーバーの名前
 */
async function disconnectFromMCPServer(name: string) {
  const clientInfo = mcpClients.get(name);
  if (clientInfo && clientInfo.client) {
    try {
      console.error(`MCPサーバーから切断中: ${name}`);
      await clientInfo.client.close();
      
      if (clientInfo.transport && 'close' in clientInfo.transport) {
        await clientInfo.transport.close();
      }
      
      mcpClients.delete(name);
      console.error(`${name}: 切断完了`);
    } catch (error) {
      console.error(`切断エラー ${name}:`, error);
    }
  }
}

/**
 * 設定ファイルとの同期を行う
 * 
 * 設定ファイルの内容と現在の接続状態を比較し、必要最小限の変更のみを適用します。
 * サーバー名の変更を検出し、不要な再接続を避けるため設定のハッシュ値を使用します。
 */
async function syncWithConfig() {
  const config = await loadConfig();
  const currentServers = new Set(mcpClients.keys());
  const configServers = new Set(Object.keys(config.mcpServers));
  
  console.error("\n=== 設定同期開始 ===");
  console.error(`現在の接続数: ${currentServers.size}`);
  console.error(`設定のサーバー数: ${configServers.size}`);
  
  // 並列処理用のタスクリスト
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
            console.error(`  [名前変更] Docker: ${currentName} → ${configName} (イメージ: ${currentImage})`);
            renamedServers.set(currentName, configName);
            processedConfigs.add(configName);
            break;
          }
        } else {
          // 通常のサーバーはハッシュ値で比較
          const configHash = configHashMap.get(configName)!;
          if (clientInfo.configHash === configHash) {
            console.error(`  [名前変更] ${currentName} → ${configName} (設定が同一)`);
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
    console.error("\n名前変更されたサーバーの移行:");
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
      
      console.error(`  ${oldName} → ${newName} ${configChanged ? '(設定も変更あり)' : '(名前のみ変更)'}`);
      
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
    console.error("\n削除されたサーバー:");
    for (const name of serversToDelete) {
      console.error(`  [削除] ${name}`);
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
            console.error(`${name} の接続に失敗:`, error);
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
              console.error(`${name} の再接続に失敗:`, error);
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
            console.error(`${name} の再接続に失敗:`, error);
          })
        );
      }
      // 設定が同じで接続も正常な場合
      else {
        statusChanges.unchanged.push(name);
        // enabled フラグのみ更新（プロファイル変更対応）
        if (currentClient.config.enabled !== serverConfig.enabled) {
          currentClient.config.enabled = serverConfig.enabled;
        }
      }
    }
  }
  
  // 変更サマリーを表示
  console.error("\n変更サマリー:");
  if (statusChanges.toDisable.length > 0) {
    console.error(`  [無効化] ${statusChanges.toDisable.join(', ')}`);
  }
  if (statusChanges.toAdd.length > 0) {
    console.error(`  [新規追加] ${statusChanges.toAdd.join(', ')}`);
  }
  if (statusChanges.toUpdate.length > 0) {
    console.error(`  [設定変更] ${statusChanges.toUpdate.join(', ')}`);
  }
  if (statusChanges.toReconnect.length > 0) {
    console.error(`  [再接続] ${statusChanges.toReconnect.join(', ')}`);
  }
  if (statusChanges.unchanged.length > 0) {
    console.error(`  [変更なし] ${statusChanges.unchanged.length}個のサーバー`);
  }
  
  // 5. すべてのタスクを実行
  const totalTasks = disconnectTasks.length + connectTasks.length + updateTasks.length;
  
  if (totalTasks === 0) {
    console.error("\n変更はありません。");
  } else {
    console.error(`\n実行するタスク: 合計 ${totalTasks}個`);
    
    // 切断タスクを先に実行
    if (disconnectTasks.length > 0) {
      console.error(`切断タスクを実行中... (${disconnectTasks.length}個)`);
      await Promise.all(disconnectTasks);
    }
    
    // 更新タスク（切断→再接続）を順次実行
    if (updateTasks.length > 0) {
      console.error(`更新タスクを実行中... (${updateTasks.length}個)`);
      for (const task of updateTasks) {
        await task.action();
      }
    }
    
    // 新規接続タスクを並列実行
    if (connectTasks.length > 0) {
      console.error(`接続タスクを実行中... (${connectTasks.length}個)`);
      await Promise.all(connectTasks);
    }
  }
  
  await updateServerStatus();
  console.error("\n=== 設定同期完了 ===");
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
        console.error("設定ファイルが変更されました。再読み込み中...");
        await syncWithConfig();
      }, 1000);
    }
  });
}

// API経由で設定が変更されたときの通知を受け取る
export async function notifyConfigChange() {
  console.error("API経由で設定が変更されました。再読み込み中...");
  await syncWithConfig();
}

async function main() {
  console.error("MCP Gateway Server 起動中...");
  
  // コマンドライン引数からプロファイルを取得
  const args = process.argv.slice(2);
  const profileIndex = args.findIndex(arg => arg === '--profile' || arg === '-p');
  if (profileIndex !== -1 && args[profileIndex + 1]) {
    const profile = args[profileIndex + 1];
    process.env.MCP_PROFILE = profile;
    console.error(`コマンドライン引数からプロファイルを設定: ${profile}`);
  }
  
  // syncWithConfigは内部でエラーハンドリングするので、ここでは待つだけ
  await syncWithConfig();
  
  // 設定ファイル監視を開始
  startConfigWatcher();
  
  // 標準のstdioモード（claude-codeコンテナから使用）
  console.error("stdioモードで起動します...");
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  
  
  console.error("MCP Gateway Server 起動完了");
}

main().catch((error) => {
  console.error("起動エラー:", error);
  process.exit(1);
});