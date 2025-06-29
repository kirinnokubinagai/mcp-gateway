import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveStatus, saveTools } from './status-manager.js';
import { WebSocketTransport } from './websocket-transport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface Config {
  mcpServers: Record<string, ServerConfig>;
}

interface MCPClientInfo {
  client?: Client;
  transport?: WebSocketTransport | StdioClientTransport;
  config: ServerConfig;
  tools?: any[];
  toolMapping?: Map<string, string>;
  status: 'connected' | 'error' | 'disabled' | 'updating';
  error?: string;
}

const CONFIG_FILE = path.join(__dirname, '../mcp-config.json');
export const mcpClients = new Map<string, MCPClientInfo>();

async function loadConfig(): Promise<Config> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    const defaultConfig: Config = { mcpServers: {} };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
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

async function connectToMCPServer(name: string, config: ServerConfig) {
  try {
    console.error(`MCPサーバーに接続中: ${name}`);
    
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
    
    const proxyPort = process.env.MCP_PROXY_PORT || '9999';
    const proxyHost = process.env.DOCKER_ENV ? 'host.docker.internal' : 'localhost';
    const proxyUrl = process.env.MCP_PROXY_URL || `ws://${proxyHost}:${proxyPort}`;
    
    if (proxyUrl) {
      console.error(`WebSocketプロキシ経由で接続: ${proxyUrl}`);
      transport = new WebSocketTransport({
        url: proxyUrl,
        command: expandedConfig.command,
        args: expandedConfig.args,
        env: expandedConfig.env
      });
    } else {
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
    
    await client.connect(transport);
    console.error(`${name}: 接続完了`);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    let tools: any[] = [];
    const toolMapping = new Map<string, string>();
    
    try {
      console.error(`${name}のツールリストを取得中...`);
      const response = await Promise.race([
        client.listTools(),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('ツールリスト取得タイムアウト')), 10000)
        )
      ]);
      tools = response.tools || [];
      console.error(`${name}のツール取得成功: ${tools.length}個`);
      
      tools.forEach(tool => {
        const gatewayToolName = tool.name.startsWith(`${name}_`) 
          ? tool.name 
          : `${name}_${tool.name}`;
        
        toolMapping.set(gatewayToolName, tool.name);
        console.error(`  ツール: ${tool.name} -> ${gatewayToolName}`);
      });
    } catch (error) {
      console.error(`ツールリスト取得エラー ${name}:`, error);
    }
    
    mcpClients.set(name, {
      client,
      transport,
      config,
      tools,
      toolMapping,
      status: 'connected'
    });
    
    await updateServerStatus();
    
    return { success: true, tools };
  } catch (error) {
    console.error(`接続失敗 ${name}:`, error);
    mcpClients.set(name, {
      config,
      status: 'error',
      error: (error as Error).message
    });
    
    await updateServerStatus();
    
    return { success: false, error: (error as Error).message };
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

async function syncWithConfig() {
  const config = await loadConfig();
  const currentServers = new Set(mcpClients.keys());
  const configServers = new Set(Object.keys(config.mcpServers));
  
  const disconnectPromises = [];
  for (const name of currentServers) {
    if (!configServers.has(name)) {
      disconnectPromises.push(disconnectFromMCPServer(name));
    }
  }
  await Promise.all(disconnectPromises);
  
  const connectionPromises = [];
  
  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    const currentClient = mcpClients.get(name);
    
    if (!serverConfig.enabled && currentClient) {
      connectionPromises.push(disconnectFromMCPServer(name));
      continue;
    }
    
    if (serverConfig.enabled) {
      const needsReconnect = !currentClient || 
        JSON.stringify(currentClient.config) !== JSON.stringify(serverConfig);
      
      if (needsReconnect) {
        if (currentClient) {
          await disconnectFromMCPServer(name);
        }
        connectionPromises.push(connectToMCPServer(name, serverConfig));
      }
    }
  }
  
  await Promise.all(connectionPromises);
  
  await updateServerStatus();
}


async function main() {
  console.error("MCP Gateway Server 起動中...");
  
  try {
    await Promise.race([
      syncWithConfig(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('初回接続タイムアウト')), 30000)
      )
    ]);
  } catch (error) {
    console.error("初回接続エラー（続行）:", error);
  }
  
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