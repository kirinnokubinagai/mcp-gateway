import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocketTransport } from './websocket-transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveStatus, loadStatus, saveTools, loadTools } from './status-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Types
interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface Config {
  servers: Record<string, ServerConfig>;
}

interface MCPClientInfo {
  client?: Client;
  transport?: StdioClientTransport | WebSocketTransport;
  config: ServerConfig;
  tools?: any[];
  toolMapping?: Map<string, string>; // ゲートウェイツール名 -> 元のツール名
  status: 'connected' | 'error' | 'disabled' | 'updating';
  error?: string;
}

const CONFIG_FILE = path.join(__dirname, '../mcp-config.json');
const mcpClients = new Map<string, MCPClientInfo>();

// 設定の読み込み
async function loadConfig(): Promise<Config> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    const defaultConfig: Config = { servers: {} };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
}

// 環境変数を展開
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

// ステータスとツールの更新
async function updateServerStatus() {
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

// MCPクライアントの作成と接続
async function connectToMCPServer(name: string, config: ServerConfig) {
  try {
    console.error(`MCPサーバーに接続中: ${name}`);
    
    // 更新中ステータスを設定
    mcpClients.set(name, {
      config,
      status: 'updating'
    });
    await updateServerStatus();
    
    const expandedConfig = {
      command: expandEnvVariables(config.command),
      args: expandEnvVariables(config.args || []),
      env: expandEnvVariables(config.env || {})
    };
    
    let transport;
    
    // WebSocketプロキシ経由での接続
    if (process.env.MCP_PROXY_URL) {
      console.error(`WebSocketプロキシ経由で接続: ${process.env.MCP_PROXY_URL}`);
      transport = new WebSocketTransport({
        url: process.env.MCP_PROXY_URL,
        command: expandedConfig.command,
        args: expandedConfig.args,
        env: expandedConfig.env
      });
    } else {
      // 通常のStdio接続（ローカル開発用）
      transport = new StdioClientTransport({
        command: expandedConfig.command,
        args: expandedConfig.args,
        env: { 
          ...process.env, 
          ...expandedConfig.env,
          PATH: process.env.HOST_PATH || process.env.PATH
        } as Record<string, string>,
      });
    }
    
    const client = new Client(
      { name: `gateway-to-${name}`, version: "1.0.0" },
      { capabilities: {} }
    );
    
    // 接続を確立
    await client.connect(transport);
    console.error(`${name}: 接続完了`);
    
    // 少し待機（安定性のため）
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // ツールリストを取得
    let tools: any[] = [];
    const toolMapping = new Map<string, string>();
    
    try {
      console.error(`${name}のツールリストを取得中...`);
      // タイムアウトを短くして再試行
      const response = await Promise.race([
        client.listTools(),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('ツールリスト取得タイムアウト')), 30000)
        )
      ]);
      tools = response.tools || [];
      console.error(`${name}のツール取得成功: ${tools.length}個`);
      
      // ツールマッピングを作成
      tools.forEach(tool => {
        // ゲートウェイでのツール名（プレフィックスを確実に付ける）
        const gatewayToolName = tool.name.startsWith(`${name}_`) 
          ? tool.name 
          : `${name}_${tool.name}`;
        
        // マッピングを保存（ゲートウェイ名 -> 元のツール名）
        toolMapping.set(gatewayToolName, tool.name);
        console.error(`  ツール: ${tool.name} -> ${gatewayToolName}`);
      });
    } catch (error) {
      console.error(`ツールリスト取得エラー ${name}:`, error);
    }
    
    // クライアント情報を保存
    mcpClients.set(name, {
      client,
      transport,
      config,
      tools,
      toolMapping,
      status: 'connected'
    });
    
    // ステータスを更新
    await updateServerStatus();
    
    return { success: true, tools };
  } catch (error) {
    console.error(`接続失敗 ${name}:`, error);
    mcpClients.set(name, {
      config,
      status: 'error',
      error: (error as Error).message
    });
    
    // ステータスを更新
    await updateServerStatus();
    
    return { success: false, error: (error as Error).message };
  }
}

// MCPゲートウェイサーバー
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

// ツールリストの取得
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error(`\n=== ツールリストのリクエスト受信 ===`);
  const tools: any[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    if (client.status === 'connected' && client.tools) {
      for (const tool of client.tools) {
        // ゲートウェイでのツール名
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
  
  // ゲートウェイ内部ツール
  tools.push({
    name: "gateway_list_servers",
    description: "接続されたMCPサーバーの一覧を表示",
    inputSchema: { type: "object", properties: {} }
  });
  
  console.error(`合計ツール数: ${tools.length}`);
  return { tools };
});

// ツールの実行
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  console.error(`\n=== ツール実行: ${name} ===`);
  
  // ゲートウェイ内部ツール
  if (name === "gateway_list_servers") {
    const config = await loadConfig();
    const status: Record<string, any> = {};
    
    for (const [serverName, client] of mcpClients.entries()) {
      status[serverName] = {
        enabled: config.servers[serverName]?.enabled || false,
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
  
  // サーバー名を取得（最初の_で分割）
  const separatorIndex = name.indexOf('_');
  if (separatorIndex === -1) {
    throw new Error(`不正なツール名形式: ${name}`);
  }
  
  const serverName = name.substring(0, separatorIndex);
  const client = mcpClients.get(serverName);
  
  if (!client || client.status !== 'connected' || !client.client) {
    throw new Error(`サーバー ${serverName} は接続されていません`);
  }
  
  // 元のツール名を取得
  let originalToolName: string;
  if (client.toolMapping && client.toolMapping.has(name)) {
    originalToolName = client.toolMapping.get(name)!;
    console.error(`マッピングから取得: ${name} -> ${originalToolName}`);
  } else {
    // マッピングがない場合は、プレフィックスを除去
    const serverPrefix = `${serverName}_`;
    if (name.startsWith(serverPrefix)) {
      originalToolName = name.substring(serverPrefix.length);
      console.error(`プレフィックスを除去: ${name} -> ${originalToolName}`);
    } else {
      originalToolName = name;
      console.error(`プレフィックスなし: ${name} をそのまま使用`);
    }
  }
  
  try {
    console.error(`${serverName}に送信: ${originalToolName}`);
    const result = await client.client.callTool({
      name: originalToolName,
      arguments: args
    });
    
    return result;
  } catch (error) {
    console.error(`ツール実行エラー:`, error);
    return {
      content: [{
        type: "text",
        text: `エラー: ${(error as Error).message}`
      }]
    };
  }
});

// MCPサーバーの切断
async function disconnectFromMCPServer(name: string) {
  const client = mcpClients.get(name);
  if (client && client.transport) {
    try {
      console.error(`MCPサーバーから切断中: ${name}`);
      await client.client?.close();
      if ('close' in client.transport) {
        await (client.transport as any).close();
      }
      mcpClients.delete(name);
      console.error(`${name}: 切断完了`);
    } catch (error) {
      console.error(`切断エラー ${name}:`, error);
    }
  }
}

// 設定の同期
async function syncWithConfig() {
  const config = await loadConfig();
  const currentServers = new Set(mcpClients.keys());
  const configServers = new Set(Object.keys(config.servers));
  
  // 削除されたサーバーを切断
  for (const name of currentServers) {
    if (!configServers.has(name)) {
      await disconnectFromMCPServer(name);
    }
  }
  
  // 新規または更新されたサーバーに接続
  for (const [name, serverConfig] of Object.entries(config.servers)) {
    const currentClient = mcpClients.get(name);
    
    // 既存のサーバーが無効化された場合
    if (!serverConfig.enabled && currentClient) {
      await disconnectFromMCPServer(name);
      continue;
    }
    
    // 有効なサーバーで未接続または設定が変更された場合
    if (serverConfig.enabled) {
      const needsReconnect = !currentClient || 
        JSON.stringify(currentClient.config) !== JSON.stringify(serverConfig);
      
      if (needsReconnect) {
        if (currentClient) {
          await disconnectFromMCPServer(name);
        }
        await connectToMCPServer(name, serverConfig);
      }
    }
  }
  
  // ステータスを更新
  await updateServerStatus();
}

// 定期的に設定を同期
async function startConfigSync() {
  // 初回の同期
  await syncWithConfig();
  
  // ファイル監視を使用
  try {
    const { watch } = await import('fs');
    const watcher = watch(CONFIG_FILE, async (eventType) => {
      if (eventType === 'change') {
        console.error("設定ファイル変更を検知");
        // 少し待機（ファイル書き込み完了を待つ）
        setTimeout(async () => {
          try {
            await syncWithConfig();
          } catch (error) {
            console.error("設定同期エラー:", error);
          }
        }, 100);
      }
    });
    
    console.error("設定ファイル監視を開始");
  } catch (error) {
    console.error("ファイル監視のセットアップに失敗、ポーリングにフォールバック:", error);
    // フォールバック: 5秒ごとに設定をチェック
    setInterval(async () => {
      try {
        await syncWithConfig();
      } catch (error) {
        console.error("設定同期エラー:", error);
      }
    }, 5000);
  }
}

// 起動
async function main() {
  console.error("MCP Gateway Server 起動中...");
  
  // 先に設定の同期を開始（他のMCPサーバーに接続）
  await startConfigSync();
  
  // 少し待機して接続が安定するのを待つ
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // その後MCPサーバーを起動（stdioのみ）
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("MCP Gateway Server 起動完了");
}

main().catch((error) => {
  console.error("起動エラー:", error);
  process.exit(1);
});