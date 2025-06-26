import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadStatus, loadTools } from './status-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.MCP_CONFIG_PATH || path.join(__dirname, '../mcp-config.json');

// 型定義
interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface UpdateServerRequest extends ServerConfig {
  newName?: string;
}

// CORS対応のレスポンスヘッダーを設定
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 設定の読み込み
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { servers: {} };
  }
}

// 設定の保存
async function saveConfig(config: any) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// WebSocketクライアント管理
const clients = new Set<any>();

// ステータス変更を全クライアントに通知
export async function broadcastStatusUpdate() {
  const status = await loadStatus();
  const message = JSON.stringify({ type: 'status', data: status });
  
  clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

// Bunのサーバーを起動（WebSocket対応）
const server = Bun.serve({
  port: Number(process.env.MCP_API_PORT) || 3003,
  
  // HTTPリクエストの処理
  async fetch(req: Request, server) {
    const url = new URL(req.url);
    
    // WebSocketアップグレード
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return;
    }
    
    // CORS プリフライトリクエスト
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // 設定の取得
    if (url.pathname === '/api/config' && req.method === 'GET') {
      const config = await loadConfig();
      return new Response(JSON.stringify(config), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    // ステータスの取得
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const status = await loadStatus();
      return new Response(JSON.stringify(status), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    // 設定の更新
    if (url.pathname === '/api/config' && req.method === 'PUT') {
      try {
        const config = await req.json();
        await saveConfig(config);
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // サーバーの作成
    if (url.pathname.startsWith('/api/servers/') && req.method === 'POST') {
      try {
        const serverName = url.pathname.split('/').pop();
        if (!serverName) {
          return new Response(JSON.stringify({ error: 'サーバー名が必要です' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        const serverConfig = await req.json();
        const config = await loadConfig();
        
        // 既に存在する場合はエラー
        if (config.servers[serverName]) {
          return new Response(JSON.stringify({ error: 'サーバーは既に存在します' }), {
            status: 409,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        config.servers[serverName] = serverConfig;
        await saveConfig(config);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // サーバーの更新
    if (url.pathname.startsWith('/api/servers/') && req.method === 'PUT') {
      try {
        const serverName = url.pathname.split('/').pop();
        if (!serverName) {
          return new Response(JSON.stringify({ error: 'サーバー名が必要です' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        const body = await req.json() as UpdateServerRequest;
        const { newName, ...serverConfig } = body;
        const config = await loadConfig();
        
        // 存在しない場合はエラー
        if (!config.servers[serverName]) {
          return new Response(JSON.stringify({ error: 'サーバーが見つかりません' }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // サーバー設定を更新
        config.servers[serverName] = serverConfig;
        
        // 名前が変更される場合
        if (newName && newName !== serverName) {
          config.servers[newName] = config.servers[serverName];
          delete config.servers[serverName];
        }
        
        await saveConfig(config);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // サーバーの削除
    if (url.pathname.startsWith('/api/servers/') && req.method === 'DELETE') {
      try {
        const serverName = url.pathname.split('/').pop();
        if (!serverName) {
          return new Response(JSON.stringify({ error: 'サーバー名が必要です' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        const config = await loadConfig();
        
        if (!config.servers[serverName]) {
          return new Response(JSON.stringify({ error: 'サーバーが見つかりません' }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        delete config.servers[serverName];
        await saveConfig(config);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // サーバーのツール一覧を取得
    if (url.pathname.startsWith('/api/servers/') && url.pathname.endsWith('/tools') && req.method === 'GET') {
      try {
        const pathParts = url.pathname.split('/');
        const serverName = pathParts[pathParts.length - 2];
        
        if (!serverName) {
          return new Response(JSON.stringify({ error: 'サーバー名が必要です' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // MCPサーバーに接続してツールリストを取得する
        const config = await loadConfig();
        const serverConfig = config.servers[serverName];
        
        if (!serverConfig) {
          return new Response(JSON.stringify({ error: 'サーバーが見つかりません' }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // ツールファイルから実際のツールリストを取得
        const allTools = await loadTools();
        const serverTools = allTools[serverName] || [];
        
        return new Response(JSON.stringify(serverTools), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // 404
    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders
    });
  },
  
  // WebSocketハンドラー
  websocket: {
    open(ws) {
      clients.add(ws);
      console.error('WebSocketクライアント接続');
      
      // 接続時に現在のステータスを送信
      loadStatus().then(status => {
        ws.send(JSON.stringify({ type: 'status', data: status }));
      });
    },
    
    close(ws) {
      clients.delete(ws);
      console.error('WebSocketクライアント切断');
    },
    
    message() {}
  }
});

console.error(`Webサーバーがポート ${server.port} で起動しました`);
console.error(`WebSocketは ws://localhost:${server.port}/ws で利用可能です`);