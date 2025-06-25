import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocketTransport } from './websocket-transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Types
interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  type?: 'stdio' | 'docker' | 'tcp';  // 接続タイプ
  host?: string;  // TCP接続用
  port?: number;  // TCP接続用
}

interface Config {
  servers: Record<string, ServerConfig>;
}

interface MCPClientInfo {
  client?: Client;
  transport?: StdioClientTransport | WebSocketTransport;
  config: ServerConfig;
  tools?: any[];
  status: 'connected' | 'error' | 'disabled';
  error?: string;
}

// Hono API サーバー
const app = new Hono();
app.use('*', cors());

const API_PORT = 3003;
const CONFIG_FILE = path.join(__dirname, '../mcp-config.json');

// MCPクライアント管理
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

// 設定の保存
async function saveConfig(config: Config): Promise<void> {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
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

// MCPクライアントの作成と接続
async function connectToMCPServer(name: string, config: ServerConfig) {
  try {
    console.error(`MCPサーバーに接続中: ${name}`);
    
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
    console.error(`${name}: connect()を呼び出し中...`);
    await client.connect(transport);
    console.error(`${name}: connect()完了`);
    
    // 接続が安定するまで少し待つ（obsidianは初期化に時間がかかる）
    console.error(`${name}: 2秒待機中...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.error(`${name}: 待機完了`);
    
    let tools: any[] = [];
    let toolsError: string | undefined;
    try {
      console.error(`${name}のツールリストを取得中...`);
      // 30秒のタイムアウトでlistToolsを試行
      const listToolsPromise = client.listTools();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('listTools timeout after 30s')), 30000)
      );
      const response = await Promise.race([listToolsPromise, timeoutPromise]);
      tools = response.tools || [];
      console.error(`${name}のツール取得成功: ${tools.length}個`);
    } catch (error) {
      toolsError = (error as Error).message;
      console.warn(`ツールリスト取得エラー ${name}:`, toolsError);
      console.error(`${name}: ツールリストは取得できませんでしたが、接続は維持します`);
    }
    
    // listToolsが失敗してもサーバーは接続済みとして扱う
    mcpClients.set(name, {
      client,
      transport,
      config,
      tools,
      status: 'connected'
    });
    
    console.error(`接続完了: ${name}, ツール数: ${tools.length}`);
    return { success: true, tools };
  } catch (error) {
    console.error(`接続失敗 ${name}:`, error);
    mcpClients.set(name, {
      config,
      status: 'error',
      error: (error as Error).message
    });
    return { success: false, error: (error as Error).message };
  }
}

// Web API エンドポイント

// 設定の取得
app.get('/api/config', async (c) => {
  const config = await loadConfig();
  const status: Record<string, any> = {};
  
  for (const [name, client] of mcpClients.entries()) {
    status[name] = {
      status: client.status,
      toolCount: client.tools?.length || 0,
      error: client.error
    };
  }
  
  return c.json({ config, status });
});

// MCPサーバーの追加/更新
app.post('/api/servers/:name', async (c) => {
  try {
    const name = c.req.param('name');
    const serverConfig = await c.req.json<ServerConfig>();
    
    const config = await loadConfig();
    config.servers[name] = serverConfig;
    await saveConfig(config);
    
    // 既存の接続があれば切断
    const existing = mcpClients.get(name);
    if (existing?.transport) {
      await existing.transport.close();
    }
    
    // 有効なら接続
    if (serverConfig.enabled) {
      // 初期状態を設定
      mcpClients.set(name, {
        config: serverConfig,
        status: 'connecting' as any,
      });
      
      // 接続を非同期で実行
      connectToMCPServer(name, serverConfig).catch(error => {
        console.error(`バックグラウンド接続エラー ${name}:`, error);
        // エラー時はステータスを更新
        mcpClients.set(name, {
          config: serverConfig,
          status: 'error',
          error: (error as Error).message
        });
      });
    }
    
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500);
  }
});

// MCPサーバーの削除
app.delete('/api/servers/:name', async (c) => {
  try {
    const name = c.req.param('name');
    
    const config = await loadConfig();
    delete config.servers[name];
    await saveConfig(config);
    
    const client = mcpClients.get(name);
    if (client?.transport) {
      await client.transport.close();
    }
    mcpClients.delete(name);
    
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500);
  }
});

// ツールリストの取得（REST API）
app.get('/api/tools', async (c) => {
  const tools: any[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    if (client.status === 'connected' && client.tools) {
      for (const tool of client.tools) {
        tools.push({
          name: `${serverName}.${tool.name}`,
          description: `[${serverName}] ${tool.description}`,
          inputSchema: tool.inputSchema
        });
      }
    }
  }
  
  tools.push({
    name: "gateway.list_servers",
    description: "接続されたMCPサーバーの一覧を表示",
    inputSchema: { type: "object", properties: {} }
  });
  
  return c.json({ tools });
});

// ツールの実行（REST API）
app.post('/api/tools/call', async (c) => {
  try {
    const { name, arguments: args } = await c.req.json();
    
    if (name === "gateway.list_servers") {
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
      
      return c.json({
        content: [{
          type: "text",
          text: JSON.stringify(status, null, 2)
        }]
      });
    }
    
    // サーバー.ツール形式を解析
    const [serverName, ...toolNameParts] = name.split('.');
    const originalToolName = toolNameParts.join('.');
    
    const client = mcpClients.get(serverName);
    if (!client || client.status !== 'connected' || !client.client) {
      throw new Error(`サーバー ${serverName} は接続されていません`);
    }
    
    const result = await client.client.callTool({
      name: originalToolName,
      arguments: args
    });
    return c.json(result);
  } catch (error) {
    return c.json({
      content: [{
        type: "text",
        text: `エラー: ${(error as Error).message}`
      }]
    }, 400);
  }
});

// MCPゲートウェイサーバー
const mcpServer = new Server(
  {
    name: "mcp-gateway",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: any[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    if (client.status === 'connected' && client.tools) {
      for (const tool of client.tools) {
        tools.push({
          name: `${serverName}.${tool.name}`,
          description: `[${serverName}] ${tool.description}`,
          inputSchema: tool.inputSchema
        });
      }
    }
  }
  
  tools.push({
    name: "gateway.list_servers",
    description: "接続されたMCPサーバーの一覧を表示",
    inputSchema: { type: "object", properties: {} }
  });
  
  return { tools };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === "gateway.list_servers") {
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
  
  // サーバー.ツール形式を解析
  const [serverName, ...toolNameParts] = name.split('.');
  const originalToolName = toolNameParts.join('.');
  
  const client = mcpClients.get(serverName);
  if (!client || client.status !== 'connected' || !client.client) {
    throw new Error(`サーバー ${serverName} は接続されていません`);
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
        text: `エラー: ${name} - ${(error as Error).message}`
      }]
    };
  }
});

// 起動
async function main() {
  // 設定を読み込んで接続
  const config = await loadConfig();
  for (const [name, serverConfig] of Object.entries(config.servers)) {
    if (serverConfig.enabled) {
      await connectToMCPServer(name, serverConfig);
    }
  }
  
  // API サーバーを起動
  serve({
    fetch: app.fetch,
    port: API_PORT,
  }, () => {
    console.error(`MCP Gateway API: http://localhost:${API_PORT}`);
  });
  
  // MCPサーバーを起動
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("MCP Gateway Server 起動完了");
}

main().catch((error) => {
  console.error("エラー:", error);
  process.exit(1);
});