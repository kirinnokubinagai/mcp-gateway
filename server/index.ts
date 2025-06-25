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
      
      // 取得したツールの詳細をログ出力
      if (tools.length > 0) {
        console.error(`\n${name}で利用可能なツール:`);
        tools.forEach((tool, index) => {
          console.error(`  ${index + 1}. "${tool.name}"`);
          console.error(`     説明: ${tool.description}`);
        });
      }
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
  console.error(`\n=== [REST API] ツールリストのリクエスト受信 ===`);
  const tools: any[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    console.error(`\nサーバー: ${serverName}`);
    console.error(`  ステータス: ${client.status}`);
    console.error(`  ツール数: ${client.tools?.length || 0}`);
    
    if (client.status === 'connected' && client.tools) {
      for (const tool of client.tools) {
        // ツール名の重複プレフィックスを避ける
        const toolName = tool.name.startsWith(`${serverName}_`) 
          ? tool.name 
          : `${serverName}_${tool.name}`;
        console.error(`  ツール登録: "${tool.name}" -> "${toolName}"`);
        
        // プレフィックス重複の検出
        if (tool.name.startsWith(`${serverName}_`)) {
          console.error(`    (注意: プレフィックス重複検出 - 元のツール名を保持)`);
        }
        
        tools.push({
          name: toolName,
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
  console.error(`\nゲートウェイツール: "gateway_list_servers"`);
  
  console.error(`\n[REST API] 合計ツール数: ${tools.length}`);
  console.error(`=== [REST API] ツールリスト送信完了 ===\n`);
  
  return c.json({ tools });
});

// ツールの実行（REST API）
app.post('/api/tools/call', async (c) => {
  let name: string = '';
  try {
    const body = await c.req.json();
    name = body.name;
    const args = body.arguments;
    
    // 1. 受信したツール名をログ出力
    console.error(`\n=== [REST API] ツール実行開始 ===`);
    console.error(`受信したツール名: "${name}"`);
    console.error(`引数: ${JSON.stringify(args, null, 2)}`);
    
    if (name === "gateway_list_servers") {
      console.error(`ゲートウェイ内部ツール: gateway_list_servers`);
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
    
    // 2. ツール名のパース処理の各ステップでログ出力
    console.error(`\n--- [REST API] ツール名パース開始 ---`);
    
    // サーバー_ツール形式を解析
    let serverName: string;
    let originalToolName: string;
    
    // 最初の_で分割してサーバー名を取得
    const separatorIndex = name.indexOf('_');
    console.error(`最初の'_'の位置: ${separatorIndex}`);
    
    if (separatorIndex === -1) {
      console.error(`エラー: '_'が見つかりません。不正なツール名形式です。`);
      throw new Error(`不正なツール名形式: ${name}`);
    }
    
    const potentialServerName = name.substring(0, separatorIndex);
    const remainingName = name.substring(separatorIndex + 1);
    console.error(`潜在的なサーバー名: "${potentialServerName}"`);
    console.error(`残りの名前: "${remainingName}"`);
    
    // 利用可能なMCPサーバーをログ出力
    console.error(`\n利用可能なMCPサーバー: ${Array.from(mcpClients.keys()).join(', ')}`);
    
    // サーバーが存在し、かつツール名がサーバー名で始まっている場合は、
    // プレフィックス重複として扱う
    if (mcpClients.has(potentialServerName) && remainingName.startsWith(potentialServerName + '_')) {
      console.error(`プレフィックス重複を検出: ${potentialServerName}_${potentialServerName}_...`);
      serverName = potentialServerName;
      originalToolName = name; // 元の名前全体をツール名として使用
      console.error(`処理結果: サーバー="${serverName}", ツール="${originalToolName}" (重複プレフィックス対応)`);
    } else {
      serverName = potentialServerName;
      originalToolName = remainingName;
      console.error(`処理結果: サーバー="${serverName}", ツール="${originalToolName}"`);
    }
    
    const client = mcpClients.get(serverName);
    if (!client) {
      console.error(`エラー: サーバー "${serverName}" が見つかりません`);
      throw new Error(`サーバー ${serverName} は接続されていません`);
    }
    
    if (client.status !== 'connected') {
      console.error(`エラー: サーバー "${serverName}" のステータス: ${client.status}`);
      throw new Error(`サーバー ${serverName} は接続されていません (status: ${client.status})`);
    }
    
    if (!client.client) {
      console.error(`エラー: サーバー "${serverName}" のクライアントが null です`);
      throw new Error(`サーバー ${serverName} のクライアントが初期化されていません`);
    }
    
    // 3. 実際にMCPサーバーに送信するツール名をログ出力
    console.error(`\n--- [REST API] MCPサーバーへのツール実行 ---`);
    console.error(`対象サーバー: "${serverName}"`);
    console.error(`送信するツール名: "${originalToolName}"`);
    console.error(`送信する引数: ${JSON.stringify(args, null, 2)}`);
    
    const result = await client.client.callTool({
      name: originalToolName,
      arguments: args
    });
    
    console.error(`[REST API] ツール実行成功: ${name}`);
    console.error(`結果の型: ${typeof result}`);
    if (result && typeof result === 'object' && 'content' in result) {
      console.error(`結果のcontent数: ${(result as any).content?.length || 0}`);
    }
    console.error(`=== [REST API] ツール実行完了 ===\n`);
    
    return c.json(result);
  } catch (error) {
    // 4. エラーが発生した場合の詳細なログ出力
    console.error(`\n!!! [REST API] ツール実行エラー !!!`);
    console.error(`ツール名: ${name}`);
    console.error(`エラーメッセージ: ${(error as Error).message}`);
    console.error(`エラースタック: ${(error as Error).stack}`);
    console.error(`=== [REST API] エラー詳細終了 ===\n`);
    
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
  console.error(`\n=== ツールリストのリクエスト受信 ===`);
  const tools: any[] = [];
  
  for (const [serverName, client] of mcpClients.entries()) {
    console.error(`\nサーバー: ${serverName}`);
    console.error(`  ステータス: ${client.status}`);
    console.error(`  ツール数: ${client.tools?.length || 0}`);
    
    if (client.status === 'connected' && client.tools) {
      for (const tool of client.tools) {
        // ツール名の重複プレフィックスを避ける
        const toolName = tool.name.startsWith(`${serverName}_`) 
          ? tool.name 
          : `${serverName}_${tool.name}`;
        console.error(`  ツール登録: "${tool.name}" -> "${toolName}"`);
        
        // プレフィックス重複の検出
        if (tool.name.startsWith(`${serverName}_`)) {
          console.error(`    (注意: プレフィックス重複検出 - 元のツール名を保持)`);
        }
        
        tools.push({
          name: toolName,
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
  console.error(`\nゲートウェイツール: "gateway_list_servers"`);
  
  console.error(`\n合計ツール数: ${tools.length}`);
  console.error(`=== ツールリスト送信完了 ===\n`);
  
  return { tools };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  // 1. 受信したツール名をログ出力
  console.error(`\n=== ツール実行開始 ===`);
  console.error(`受信したツール名: "${name}"`);
  console.error(`引数: ${JSON.stringify(args, null, 2)}`);
  
  if (name === "gateway_list_servers") {
    console.error(`ゲートウェイ内部ツール: gateway_list_servers`);
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
  
  // 2. ツール名のパース処理の各ステップでログ出力
  console.error(`\n--- ツール名パース開始 ---`);
  
  // サーバー_ツール形式を解析
  let serverName: string;
  let originalToolName: string;
  
  // 最初の_で分割してサーバー名を取得
  const separatorIndex = name.indexOf('_');
  console.error(`最初の'_'の位置: ${separatorIndex}`);
  
  if (separatorIndex === -1) {
    console.error(`エラー: '_'が見つかりません。不正なツール名形式です。`);
    throw new Error(`不正なツール名形式: ${name}`);
  }
  
  const potentialServerName = name.substring(0, separatorIndex);
  const remainingName = name.substring(separatorIndex + 1);
  console.error(`潜在的なサーバー名: "${potentialServerName}"`);
  console.error(`残りの名前: "${remainingName}"`);
  
  // 利用可能なMCPサーバーをログ出力
  console.error(`\n利用可能なMCPサーバー: ${Array.from(mcpClients.keys()).join(', ')}`);
  
  // サーバーが存在し、かつツール名がサーバー名で始まっている場合は、
  // プレフィックス重複として扱う
  if (mcpClients.has(potentialServerName) && remainingName.startsWith(potentialServerName + '_')) {
    console.error(`プレフィックス重複を検出: ${potentialServerName}_${potentialServerName}_...`);
    serverName = potentialServerName;
    originalToolName = name; // 元の名前全体をツール名として使用
    console.error(`処理結果: サーバー="${serverName}", ツール="${originalToolName}" (重複プレフィックス対応)`);
  } else {
    serverName = potentialServerName;
    originalToolName = remainingName;
    console.error(`処理結果: サーバー="${serverName}", ツール="${originalToolName}"`);
  }
  
  const client = mcpClients.get(serverName);
  if (!client) {
    console.error(`エラー: サーバー "${serverName}" が見つかりません`);
    throw new Error(`サーバー ${serverName} は接続されていません`);
  }
  
  if (client.status !== 'connected') {
    console.error(`エラー: サーバー "${serverName}" のステータス: ${client.status}`);
    throw new Error(`サーバー ${serverName} は接続されていません (status: ${client.status})`);
  }
  
  if (!client.client) {
    console.error(`エラー: サーバー "${serverName}" のクライアントが null です`);
    throw new Error(`サーバー ${serverName} のクライアントが初期化されていません`);
  }
  
  try {
    // 3. 実際にMCPサーバーに送信するツール名をログ出力
    console.error(`\n--- MCPサーバーへのツール実行 ---`);
    console.error(`対象サーバー: "${serverName}"`);
    console.error(`送信するツール名: "${originalToolName}"`);
    console.error(`送信する引数: ${JSON.stringify(args, null, 2)}`);
    
    const result = await client.client.callTool({
      name: originalToolName,
      arguments: args
    });
    
    console.error(`ツール実行成功: ${name}`);
    console.error(`結果の型: ${typeof result}`);
    if (result && typeof result === 'object' && 'content' in result) {
      console.error(`結果のcontent数: ${(result as any).content?.length || 0}`);
    }
    console.error(`=== ツール実行完了 ===\n`);
    
    return result;
  } catch (error) {
    // 4. エラーが発生した場合の詳細なログ出力
    console.error(`\n!!! ツール実行エラー !!!`);
    console.error(`ツール名: ${name}`);
    console.error(`サーバー: ${serverName}`);
    console.error(`実際のツール名: ${originalToolName}`);
    console.error(`エラーメッセージ: ${(error as Error).message}`);
    console.error(`エラースタック: ${(error as Error).stack}`);
    console.error(`=== エラー詳細終了 ===\n`);
    
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
  
  // stdioのみで起動（HTTPサーバーは起動しない）
  console.error("MCP Gateway Server: stdioモードで起動");
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("MCP Gateway Server 起動完了（stdioモード）");
}

main().catch((error) => {
  console.error("エラー:", error);
  process.exit(1);
});