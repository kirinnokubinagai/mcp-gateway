import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { notifyConfigChange } from './index.js';
import { profileManager } from './profile-manager.js';
import { getErrorStatus, resetCircuitBreaker, resetAllCircuitBreakers } from './error-handler.js';

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
    const config = await profileManager.loadConfig();
    
    const { name, command, args, env, enabled } = body;
    
    if (!name || !command) {
      return c.json({ error: '名前とコマンドは必須です' }, 400);
    }
    
    // 既に存在するサーバー名かチェック
    if (config.mcpServers[name]) {
      return c.json({ error: `サーバー名 "${name}" は既に使用されています` }, 400);
    }
    
    config.mcpServers[name] = {
      command,
      args: args || [],
      env: env || {},
      enabled: enabled !== undefined ? enabled : true
    };
    
    // 新規サーバーを全プロファイルにデフォルト状態で追加
    if (config.profiles) {
      for (const profileName in config.profiles) {
        const profile = config.profiles[profileName];
        if (profile && typeof profile === 'object') {
          // デフォルトではenabledと同じ状態にする
          profile[name] = enabled !== undefined ? enabled : true;
        }
      }
    }
    
    await profileManager.saveConfig(config);
    
    // 設定変更を通知
    await notifyConfigChange();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('サーバー作成エラー:', error);
    return c.json({ error: `サーバーの作成に失敗しました: ${(error as Error).message}` }, 500);
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
    
    const config = await profileManager.loadConfig();
    
    if (!config.mcpServers[oldName]) {
      return c.json({ error: 'サーバーが見つかりません' }, 404);
    }
    
    // 新しい名前（指定されていない場合は既存の名前を使用）
    const targetName = newName || oldName;
    
    // 名前が変更される場合は、ProfileManagerを使用して全プロファイルを同期
    if (targetName !== oldName) {
      // まず名前を変更
      await profileManager.renameServerAcrossProfiles({
        oldName,
        newName: targetName,
        preserveStates: true
      });
      
      // 再度設定を読み込む（名前変更後）
      const updatedConfig = await profileManager.loadConfig();
      
      // その他の設定（command, args, env, enabled）を更新
      updatedConfig.mcpServers[targetName] = {
        command: command,
        args: args || [],
        env: env || {},
        enabled: enabled !== undefined ? enabled : updatedConfig.mcpServers[targetName].enabled
      };
      
      await profileManager.saveConfig(updatedConfig);
    } else {
      // 名前変更なしの場合は値のみ更新
      config.mcpServers[oldName] = {
        command: command,
        args: args || [],
        env: env || {},
        enabled: enabled !== undefined ? enabled : config.mcpServers[oldName].enabled
      };
      
      // enabledが変更された場合は全プロファイルで同期
      if (enabled !== undefined && enabled !== config.mcpServers[oldName].enabled) {
        await profileManager.syncServerEnabledState(oldName, enabled);
      } else {
        await profileManager.saveConfig(config);
      }
    }
    
    // 整合性チェックと修復
    const consistencyCheck = await profileManager.checkProfileConsistency();
    if (!consistencyCheck.isConsistent) {
      console.log('プロファイルの不整合を検出:', consistencyCheck.issues);
      await profileManager.repairProfileConsistency();
    }
    
    // 設定変更を通知
    await notifyConfigChange();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('サーバー更新エラー:', error);
    return c.json({ error: `サーバーの更新に失敗しました: ${(error as Error).message}` }, 500);
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
    
    // ProfileManagerを使用して削除（全プロファイルから参照も削除）
    await profileManager.deleteServerAcrossProfiles(name);
    
    // 設定変更を通知
    await notifyConfigChange();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('サーバー削除エラー:', error);
    return c.json({ error: `サーバーの削除に失敗しました: ${(error as Error).message}` }, 500);
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

// 特定のサーバーのツール一覧を取得
app.get('/api/servers/:name/tools', async (c) => {
  try {
    const serverName = c.req.param('name');
    const data = await readFile(TOOLS_FILE, 'utf-8');
    const tools = JSON.parse(data);
    
    if (!tools[serverName]) {
      return c.json({ error: 'サーバーのツールが見つかりません' }, 404);
    }
    
    return c.json(tools[serverName]);
  } catch (error) {
    console.error('ツール取得エラー:', error);
    return c.json({ error: 'ツールの取得に失敗しました' }, 500);
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
    
    const config = await profileManager.loadConfig();
    if (!config.profiles) {
      config.profiles = {};
    }
    
    // プロファイルの構造を分けて保存
    // サーバー設定（必須）
    if (body.servers !== undefined) {
      // ProfileManagerを使用して状態を更新（整合性チェック付き）
      await profileManager.updateProfileStates(profileName, body.servers);
      
      // 再度設定を読み込む（更新後）
      const updatedConfig = await profileManager.loadConfig();
      config.profiles = updatedConfig.profiles;
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
    
    await profileManager.saveConfig(config);
    
    // 設定変更を通知
    await notifyConfigChange();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('プロファイル更新エラー:', error);
    return c.json({ error: `プロファイルの更新に失敗しました: ${(error as Error).message}` }, 500);
  }
});

// プロファイルを削除
app.delete('/api/profiles/:name', async (c) => {
  try {
    const profileName = c.req.param('name');
    
    const config = await profileManager.loadConfig();
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
      
      await profileManager.saveConfig(config);
      await notifyConfigChange();
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('プロファイル削除エラー:', error);
    return c.json({ error: 'プロファイルの削除に失敗しました' }, 500);
  }
});

// プロファイルの整合性チェック
app.get('/api/profiles/consistency', async (c) => {
  try {
    const result = await profileManager.checkProfileConsistency();
    return c.json(result);
  } catch (error) {
    console.error('整合性チェックエラー:', error);
    return c.json({ error: '整合性チェックに失敗しました' }, 500);
  }
});

// プロファイルの整合性を修復
app.post('/api/profiles/repair', async (c) => {
  try {
    await profileManager.repairProfileConsistency();
    const result = await profileManager.checkProfileConsistency();
    return c.json({ success: true, consistency: result });
  } catch (error) {
    console.error('整合性修復エラー:', error);
    return c.json({ error: '整合性の修復に失敗しました' }, 500);
  }
});

// エラー状態の詳細を取得
app.get('/api/errors/:serverName', async (c) => {
  try {
    const serverName = c.req.param('serverName');
    const statusData = await readFile(STATUS_FILE, 'utf-8');
    const status = JSON.parse(statusData);
    
    if (status[serverName] && status[serverName].error) {
      const errorStatus = getErrorStatus(serverName, status[serverName].error);
      return c.json({
        serverName,
        ...errorStatus,
        currentError: status[serverName].error,
        retryCount: status[serverName].retryCount || 0
      });
    }
    
    return c.json({ serverName, status: 'no_error' });
  } catch (error) {
    console.error('エラー状態取得エラー:', error);
    return c.json({ error: 'エラー状態の取得に失敗しました' }, 500);
  }
});

// サーキットブレーカーをリセット
app.post('/api/errors/:serverName/reset', async (c) => {
  try {
    const serverName = c.req.param('serverName');
    resetCircuitBreaker(serverName);
    
    // 設定変更を通知して再接続を試行
    await notifyConfigChange();
    
    return c.json({ success: true, message: `${serverName}のサーキットブレーカーをリセットしました` });
  } catch (error) {
    console.error('サーキットブレーカーリセットエラー:', error);
    return c.json({ error: 'サーキットブレーカーのリセットに失敗しました' }, 500);
  }
});

// すべてのサーキットブレーカーをリセット
app.post('/api/errors/reset-all', async (c) => {
  try {
    resetAllCircuitBreakers();
    
    // 設定変更を通知して再接続を試行
    await notifyConfigChange();
    
    return c.json({ success: true, message: 'すべてのサーキットブレーカーをリセットしました' });
  } catch (error) {
    console.error('全サーキットブレーカーリセットエラー:', error);
    return c.json({ error: '全サーキットブレーカーのリセットに失敗しました' }, 500);
  }
});

const port = Number(process.env.PORT) || 3003;

console.log(`APIサーバー起動: http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};