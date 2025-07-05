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

// MCPサーバーの順番を一括で変更するエンドポイント
app.put('/api/servers/reorder', async (c) => {
  try {
    const body = await c.req.json();
    console.log('Reorder request body:', JSON.stringify(body, null, 2));
    
    const { servers } = body;
    if (!servers) {
      return c.json({ error: 'サーバーリストが指定されていません' }, 400);
    }
    
    // 空のオブジェクトチェック
    if (Object.keys(servers).length === 0) {
      return c.json({ error: 'サーバーリストが空です' }, 400);
    }
    
    const config = await loadConfig();
    
    // 既存のサーバーのキーを取得
    const existingKeys = Object.keys(config.mcpServers);
    const newKeys = Object.keys(servers);
    
    // すべてのキーが一致することを確認（順序は異なってもOK）
    const existingSet = new Set(existingKeys);
    const newSet = new Set(newKeys);
    
    if (existingSet.size !== newSet.size) {
      return c.json({ error: 'サーバーの数が一致しません' }, 400);
    }
    
    for (const key of existingKeys) {
      if (!newSet.has(key)) {
        return c.json({ error: `サーバー "${key}" が新しいリストに含まれていません` }, 400);
      }
    }
    
    for (const key of newKeys) {
      if (!existingSet.has(key)) {
        return c.json({ error: `不明なサーバー "${key}" が含まれています` }, 400);
      }
    }
    
    // 新しい順序でサーバーを設定（値は既存のものを使用）
    const orderedServers: Record<string, any> = {};
    for (const key of newKeys) {
      orderedServers[key] = config.mcpServers[key];
    }
    
    config.mcpServers = orderedServers;
    await saveConfig(config);
    
    // 設定変更を通知
    await notifyConfigChange();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('順序変更エラー:', error);
    return c.json({ error: `順序の変更に失敗しました: ${(error as Error).message}` }, 500);
  }
});

// MCPサーバーを更新するエンドポイント
app.put('/api/servers', async (c) => {
  try {
    const body = await c.req.json();
    const { oldName, newName, command, args, env, enabled } = body;
    
    if (!oldName) {
      return c.json({ error: '更新対象のサーバー名が指定されていません' }, 400);
    }
    
    // JSONファイルを文字列として読み込む
    const jsonContent = await readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(jsonContent);
    
    if (!config.mcpServers[oldName]) {
      return c.json({ error: 'サーバーが見つかりません' }, 404);
    }
    
    // 新しい名前（指定されていない場合は既存の名前を使用）
    const targetName = newName || oldName;
    
    // 新しい設定値
    const newValue = {
      command: command,
      args: args || [],
      env: env || {},
      enabled: enabled !== undefined ? enabled : true
    };
    
    if (targetName !== oldName) {
      // 名前が変更される場合、順序を保持するため新しいオブジェクトを作成
      const orderedServers: Record<string, any> = {};
      
      for (const [key, value] of Object.entries(config.mcpServers)) {
        if (key === oldName) {
          orderedServers[targetName] = newValue;
        } else {
          orderedServers[key] = value;
        }
      }
      
      config.mcpServers = orderedServers;
    } else {
      // 名前変更なしの場合は値のみ更新
      config.mcpServers[oldName] = newValue;
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
app.delete('/api/servers', async (c) => {
  try {
    const body = await c.req.json();
    const { name } = body;
    
    if (!name) {
      return c.json({ error: '削除対象のサーバー名が指定されていません' }, 400);
    }
    
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

// プロファイル一覧を取得
app.get('/api/profiles', async (c) => {
  const config = await loadConfig();
  return c.json({
    profiles: config.profiles || {},
    profileDescriptions: config.profileDescriptions || {},
    profileDisplayNames: config.profileDisplayNames || {},
    activeProfile: config.activeProfile || null
  });
});

// アクティブプロファイルを設定
app.post('/api/profiles/active', async (c) => {
  try {
    const body = await c.req.json();
    const { profile } = body;
    
    const config = await loadConfig();
    config.activeProfile = profile;
    await saveConfig(config);
    
    return c.json({ success: true, activeProfile: profile });
  } catch (error) {
    console.error('プロファイル設定エラー:', error);
    return c.json({ error: 'プロファイルの設定に失敗しました' }, 500);
  }
});

// プロファイルを作成・更新
app.put('/api/profiles/:name', async (c) => {
  try {
    const profileName = c.req.param('name');
    const body = await c.req.json();
    
    const config = await loadConfig();
    if (!config.profiles) {
      config.profiles = {};
    }
    
    // プロファイルの構造を分けて保存
    // サーバー設定（必須）
    if (body.servers !== undefined) {
      config.profiles[profileName] = body.servers;
    } else if (!config.profiles[profileName]) {
      // 新規作成時でserversが指定されていない場合は空オブジェクトを設定
      config.profiles[profileName] = {};
    }
    
    // 説明
    if (body.description !== undefined) {
      if (!config.profileDescriptions) {
        config.profileDescriptions = {};
      }
      config.profileDescriptions[profileName] = body.description;
    }
    
    // 表示名
    if (body.displayName !== undefined) {
      if (!config.profileDisplayNames) {
        config.profileDisplayNames = {};
      }
      config.profileDisplayNames[profileName] = body.displayName;
    }
    
    await saveConfig(config);
    
    // 設定変更を通知
    await notifyConfigChange();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('プロファイル更新エラー:', error);
    return c.json({ error: 'プロファイルの更新に失敗しました' }, 500);
  }
});

// プロファイルを削除
app.delete('/api/profiles/:name', async (c) => {
  try {
    const profileName = c.req.param('name');
    
    const config = await loadConfig();
    if (config.profiles && config.profiles[profileName]) {
      delete config.profiles[profileName];
      
      // プロファイルの説明も削除
      if (config.profileDescriptions && config.profileDescriptions[profileName]) {
        delete config.profileDescriptions[profileName];
      }
      
      // プロファイルの表示名も削除
      if (config.profileDisplayNames && config.profileDisplayNames[profileName]) {
        delete config.profileDisplayNames[profileName];
      }
      
      // アクティブプロファイルが削除されたらdefaultに
      if (config.activeProfile === profileName) {
        config.activeProfile = 'default';
      }
      
      await saveConfig(config);
      await notifyConfigChange();
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('プロファイル削除エラー:', error);
    return c.json({ error: 'プロファイルの削除に失敗しました' }, 500);
  }
});

const port = Number(process.env.PORT) || 3003;

console.log(`APIサーバー起動: http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};