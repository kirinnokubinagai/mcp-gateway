import fs from 'fs/promises';
import path from 'path';
import { loadStatus, loadTools, saveStatus } from './status-manager.js';
import { CONFIG_FILE, API_CONFIG, ERROR_MESSAGES, STATUS } from './constants.js';
import { ServerConfig, UpdateServerRequest } from './types.js';

const corsHeaders = API_CONFIG.CORS_HEADERS;

// 設定の読み込み
async function loadConfig() {
  try {
    // ファイルの存在とサイズを確認
    const stats = await fs.stat(CONFIG_FILE).catch(() => null);
    if (!stats) {
      console.error(`[loadConfig] 設定ファイルが存在しません: ${CONFIG_FILE}`);
      return { mcpServers: {} };
    }
    
    if (stats.size === 0) {
      console.error(`[loadConfig] 設定ファイルが空です: ${CONFIG_FILE}`);
      // 空のファイルの場合、デフォルト設定を返す
      const defaultConfig = { mcpServers: {} };
      // 空のファイルを初期化
      await saveConfig(defaultConfig);
      return defaultConfig;
    }
    
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);
    console.error(`[loadConfig] 設定を読み込みました: ${Object.keys(config.mcpServers || {}).length}個のサーバー`);
    return config;
  } catch (error) {
    console.error(`[loadConfig] エラー:`, error);
    return { mcpServers: {} };
  }
}

// 設定の保存（アトミック書き込み）
async function saveConfig(config: any) {
  const tempFile = `${CONFIG_FILE}.tmp`;
  const backupFile = `${CONFIG_FILE}.backup`;
  
  try {
    // 検証: 設定が有効なJSONであることを確認
    const jsonStr = JSON.stringify(config, null, 2);
    JSON.parse(jsonStr); // パースできることを確認
    
    // Docker環境では直接書き込み（EBUSYエラーを防ぐため）
    if (process.env.DOCKER_ENV) {
      await fs.writeFile(CONFIG_FILE, jsonStr);
      console.error(`[saveConfig] 設定を保存しました（Docker環境）: ${Object.keys(config.mcpServers || {}).length}個のサーバー`);
      return;
    }
    
    // 既存ファイルのバックアップ
    try {
      await fs.copyFile(CONFIG_FILE, backupFile);
    } catch (error) {
      // バックアップファイルが作成できなくても続行
      console.error('[saveConfig] バックアップ作成をスキップ:', error);
    }
    
    // 一時ファイルに書き込み
    await fs.writeFile(tempFile, jsonStr);
    
    // アトミックに置換
    await fs.rename(tempFile, CONFIG_FILE);
    
    console.error(`[saveConfig] 設定を保存しました: ${Object.keys(config.mcpServers || {}).length}個のサーバー`);
  } catch (error) {
    console.error('[saveConfig] エラー:', error);
    // 一時ファイルのクリーンアップ
    try {
      await fs.unlink(tempFile);
    } catch {}
    throw error;
  }
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

// 設定変更を全クライアントに通知
async function broadcastConfigUpdate() {
  const config = await loadConfig();
  const message = JSON.stringify({ type: 'config', data: config });
  
  clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

// 初期化処理：設定ファイルが存在しない場合はデフォルトを作成
async function initializeConfig() {
  try {
    const stats = await fs.stat(CONFIG_FILE).catch(() => null);
    if (!stats) {
      console.error('[初期化] 設定ファイルが存在しないため、デフォルト設定を作成します');
      const dir = path.dirname(CONFIG_FILE);
      // ディレクトリが存在しない場合は作成
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
      
      const defaultConfig = {
        mcpServers: {}
      };
      await saveConfig(defaultConfig);
      console.error('[初期化] デフォルト設定ファイルを作成しました');
    } else {
      console.error('[初期化] 既存の設定ファイルを使用します');
    }
  } catch (error) {
    console.error('[初期化] エラー:', error);
  }
}

// サーバー起動前に初期化
await initializeConfig();

// Bunのサーバーを起動（WebSocket対応）
const server = Bun.serve({
  port: Number(process.env.PORT || process.env.MCP_API_PORT) || 3003,
  
  // HTTPリクエストの処理
  async fetch(req: Request, server) {
    const url = new URL(req.url);
    console.error(`[HTTP] ${req.method} ${url.pathname}`);
    
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
        
        // WebSocketで設定変更を通知
        await broadcastConfigUpdate();
        
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
        console.error('[POST] サーバー作成リクエスト:', url.pathname);
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
        if (config.mcpServers[serverName]) {
          return new Response(JSON.stringify({ error: 'サーバーは既に存在します' }), {
            status: 409,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        config.mcpServers[serverName] = serverConfig;
        await saveConfig(config);
        console.error(`[POST] サーバー作成成功: ${serverName}`);
        
        // 新しいサーバーのステータスを「更新中」に設定
        const status = await loadStatus();
        status[serverName] = {
          enabled: serverConfig.enabled,
          status: 'updating',
          toolCount: 0
        };
        await saveStatus(status);
        
        // WebSocketで設定変更を通知
        await broadcastConfigUpdate();
        
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
        
        if (!config.mcpServers[serverName]) {
          return new Response(JSON.stringify({ error: ERROR_MESSAGES.SERVER_NOT_FOUND }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // サーバー設定を更新
        config.mcpServers[serverName] = serverConfig;
        
        // 名前が変更される場合
        if (newName && newName !== serverName) {
          config.mcpServers[newName] = config.mcpServers[serverName];
          delete config.mcpServers[serverName];
        }
        
        await saveConfig(config);
        
        // 更新されたサーバーのステータスを「更新中」に設定
        const status = await loadStatus();
        const targetServerName = newName || serverName;
        if (serverConfig.enabled) {
          status[targetServerName] = {
            enabled: serverConfig.enabled,
            status: 'updating',
            toolCount: 0
          };
          await saveStatus(status);
        }
        
        // WebSocketで設定変更を通知
        await broadcastConfigUpdate();
        
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
        
        if (!config.mcpServers[serverName]) {
          return new Response(JSON.stringify({ error: ERROR_MESSAGES.SERVER_NOT_FOUND }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        delete config.mcpServers[serverName];
        await saveConfig(config);
        
        // WebSocketで設定変更を通知
        await broadcastConfigUpdate();
        
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
        const serverConfig = config.mcpServers[serverName];
        
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