import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from 'fs/promises';
import { saveStatus, saveTools, classifyError } from './status-manager.js';
import { WebSocketTransport } from './websocket-transport.js';
import { validateCommand } from './command-validator.js';
import { 
  CONFIG_FILE, 
  SERVER_CONFIG, 
  WEBSOCKET_CONFIG, 
  TIMEOUT_CONFIG, 
  ERROR_MESSAGES,
  STATUS,
  StatusType
} from './constants.js';
import { ServerConfig, Config, MCPClientInfo } from './types.js';

const mcpClients = new Map<string, MCPClientInfo>();

async function loadConfig(): Promise<Config> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsedData = JSON.parse(data);
    // 既存の設定ファイルとの互換性を保つ
    if (parsedData.mcpServers) {
      return { mcpServers: parsedData.mcpServers };
    }
    return { mcpServers: {} };
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

async function updateServerStatus() {
  const status: Record<string, any> = {};
  const allTools: Record<string, any[]> = {};
  
  for (const [serverName, client] of mcpClients.entries()) {
    const statusEntry: any = {
      enabled: client.config.enabled,
      status: client.status,
      toolCount: client.tools?.length || 0,
      error: client.error
    };
    
    if (client.error && client.status === STATUS.ERROR) {
      statusEntry.errorType = classifyError(client.error);
    }
    
    status[serverName] = statusEntry;
    
    if (client.tools) {
      allTools[serverName] = client.tools;
    }
  }
  
  await saveStatus(status);
  await saveTools(allTools);
}

async function connectToMCPServer(name: string, config: ServerConfig) {
  try {
    mcpClients.set(name, {
      config,
      status: STATUS.UPDATING
    });
    await updateServerStatus();
    
    const expandedConfig = {
      command: expandEnvVariables(config.command),
      args: expandEnvVariables(config.args || []),
      env: expandEnvVariables(config.env || {})
    };
    
    const validation = await validateCommand(expandedConfig.command, expandedConfig.args);
    if (!validation.valid) {
      const errorMessage = validation.errorMessage || ERROR_MESSAGES.COMMAND_VALIDATION_FAILED;
      
      mcpClients.set(name, {
        config,
        status: STATUS.ERROR,
        error: errorMessage
      });
      
      await updateServerStatus();
      
      return { success: false, error: errorMessage };
    }
    
    let transport;
    
    const proxyUrl = WEBSOCKET_CONFIG.PROXY_URL;
    
    if (proxyUrl) {
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
    
    await new Promise(resolve => setTimeout(resolve, TIMEOUT_CONFIG.INITIAL_WAIT));
    
    let tools: any[] = [];
    const toolMapping = new Map<string, string>();
    
    try {
      const response = await Promise.race([
        client.listTools(),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error(ERROR_MESSAGES.TIMEOUT_TOOL_LIST)), TIMEOUT_CONFIG.TOOL_LIST)
        )
      ]);
      tools = response.tools || [];
      
      tools.forEach(tool => {
        const gatewayToolName = tool.name.startsWith(`${name}_`) 
          ? tool.name 
          : `${name}_${tool.name}`;
        
        toolMapping.set(gatewayToolName, tool.name);
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
      status: STATUS.CONNECTED
    });
    
    await updateServerStatus();
    
    return { success: true, tools };
  } catch (error) {
    mcpClients.set(name, {
      config,
      status: STATUS.ERROR,
      error: (error as Error).message
    });
    
    await updateServerStatus();
    
    return { success: false, error: (error as Error).message };
  }
}

const mcpServer = new Server(
  {
    name: SERVER_CONFIG.NAME,
    version: SERVER_CONFIG.VERSION,
  },
  {
    capabilities: SERVER_CONFIG.CAPABILITIES,
  }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: any[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    if (client.status === STATUS.CONNECTED && client.tools) {
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
  
  return { tools };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
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
    throw new Error(`${ERROR_MESSAGES.INVALID_TOOL_NAME}: ${name}`);
  }
  
  const serverName = name.substring(0, separatorIndex);
  const client = mcpClients.get(serverName);
  
  if (!client || client.status !== STATUS.CONNECTED || !client.client) {
    throw new Error(`${ERROR_MESSAGES.SERVER_NOT_CONNECTED}: ${serverName}`);
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
      await clientInfo.client.close();
      
      if (clientInfo.transport && 'close' in clientInfo.transport) {
        await clientInfo.transport.close();
      }
      
      mcpClients.delete(name);
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

async function startConfigSync() {
  if (process.env.DOCKER_ENV) {
    setInterval(async () => {
      try {
        await syncWithConfig();
      } catch (error) {
        console.error("設定同期エラー:", error);
      }
    }, TIMEOUT_CONFIG.SYNC_INTERVAL);
    return;
  }

  try {
    const { watch } = await import('fs');
    watch(CONFIG_FILE, async (eventType) => {
      if (eventType === 'change') {
        setTimeout(async () => {
          try {
            await syncWithConfig();
          } catch (error) {
            console.error("設定同期エラー:", error);
          }
        }, 100);
      }
    });
  } catch (error) {
    setInterval(async () => {
      try {
        await syncWithConfig();
      } catch (error) {
        console.error("設定同期エラー:", error);
      }
    }, TIMEOUT_CONFIG.SYNC_INTERVAL);
  }
}

async function main() {
  const { spawn } = await import('child_process');
  const webServerProcess = spawn('bun', ['server/web-server.ts'], {
    cwd: '/app',
    env: process.env,
    stdio: 'inherit'
  });
  
  webServerProcess.on('error', (error) => {
    console.error('Web server error:', error);
  });
  
  await new Promise(resolve => setTimeout(resolve, TIMEOUT_CONFIG.INITIAL_WAIT));
  
  try {
    await Promise.race([
      syncWithConfig(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(ERROR_MESSAGES.TIMEOUT_INITIAL_CONNECTION)), TIMEOUT_CONFIG.INITIAL_CONNECTION)
      )
    ]);
  } catch (error) {
    console.error("初回接続エラー（続行）:", error);
  }
  
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  
  startConfigSync().catch(error => {
    console.error("設定同期エラー:", error);
  });
}

main().catch((error) => {
  console.error("起動エラー:", error);
  process.exit(1);
});