import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { notifyConfigChange } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Hono();

// CORS設定
app.use('/*', cors());

const CONFIG_FILE = path.join(__dirname, '../mcp-config.json');
const STATUS_FILE = path.join(__dirname, '../mcp-status.json');
const TOOLS_FILE = path.join(__dirname, '../mcp-tools.json');

// 設定ファイルを読み込む関数
async function loadConfig() {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading config:', error);
    return { mcpServers: {} };
  }
}

// 設定ファイルを保存する関数
async function saveConfig(config: any) {
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// MCPサーバー一覧を返すエンドポイント
app.get('/api/servers', async (c) => {
  const config = await loadConfig();
  return c.json(config.mcpServers || {});
});

// MCPサーバーを作成するエンドポイント
app.post('/api/servers', async (c) => {
  try {
    const body = await c.req.json();
    const config = await loadConfig();
    
    const { name, command, args, env, enabled } = body;
    
    if (!name || !command) {
      return c.json({ error: '名前とコマンドは必須です' }, 400);
    }
    
    config.mcpServers[name] = {
      command,
      args: args || [],
      env: env || {},
      enabled: enabled !== undefined ? enabled : true
    };
    
    await saveConfig(config);
    
    // 設定変更を通知
    await notifyConfigChange();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('サーバー作成エラー:', error);
    return c.json({ error: 'サーバーの作成に失敗しました' }, 500);
  }
});

// MCPサーバーを更新するエンドポイント
app.put('/api/servers/:name', async (c) => {
  try {
    const oldName = c.req.param('name');
    const body = await c.req.json();
    const config = await loadConfig();
    
    if (!config.mcpServers[oldName]) {
      return c.json({ error: 'サーバーが見つかりません' }, 404);
    }
    
    // 新しい名前がある場合は名前を変更
    const newName = body.newName || oldName;
    
    // 設定を更新
    config.mcpServers[newName] = {
      command: body.command,
      args: body.args || [],
      env: body.env || {},
      enabled: body.enabled !== undefined ? body.enabled : true
    };
    
    // 名前が変更された場合は古い設定を削除
    if (newName !== oldName) {
      delete config.mcpServers[oldName];
    }
    
    await saveConfig(config);
    
    // 設定変更を通知
    await notifyConfigChange();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('サーバー更新エラー:', error);
    return c.json({ error: 'サーバーの更新に失敗しました' }, 500);
  }
});

// MCPサーバーを削除するエンドポイント
app.delete('/api/servers/:name', async (c) => {
  try {
    const name = c.req.param('name');
    const config = await loadConfig();
    
    if (!config.mcpServers[name]) {
      return c.json({ error: 'サーバーが見つかりません' }, 404);
    }
    
    delete config.mcpServers[name];
    await saveConfig(config);
    
    // 設定変更を通知
    await notifyConfigChange();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('サーバー削除エラー:', error);
    return c.json({ error: 'サーバーの削除に失敗しました' }, 500);
  }
});

// ステータスエンドポイント
app.get('/api/status', async (c) => {
  try {
    const data = await readFile(STATUS_FILE, 'utf-8');
    const status = JSON.parse(data);
    return c.json(status);
  } catch (error) {
    return c.json({});
  }
});

// ツール一覧エンドポイント
app.get('/api/tools', async (c) => {
  try {
    const data = await readFile(TOOLS_FILE, 'utf-8');
    const tools = JSON.parse(data);
    return c.json(tools);
  } catch (error) {
    return c.json({});
  }
});

const port = Number(process.env.PORT) || 3003;

console.log(`APIサーバー起動: http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};