import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { notifyConfigChange, stateManager, scheduleReconnect } from './index.ts';
import { profileManager } from './profile-manager.ts';
import { getErrorStatus, resetCircuitBreaker, resetAllCircuitBreakers } from './error-handler.ts';
import { configValidator } from './simple-validator.ts';
import { createLogger } from './logger.ts';
import { configCache, AsyncQueue } from './performance-optimizer.ts';
import { ServerConfig } from './types.ts';

const logger = createLogger({ module: 'APIServer' });
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
    logger.error('設定ファイルの読み込みエラー', error as Error);
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
      enabled: enabled !== undefined ? enabled : true,
    };

    // 注意: 新規サーバーを作成する際、プロファイルには何も追加しない
    // これにより、各プロファイルの独立性が保たれる
    // ユーザーがプロファイル設定画面で明示的に有効化する必要がある

    await profileManager.saveConfig(config);

    // 設定変更を通知
    await notifyConfigChange();

    return c.json({ success: true });
  } catch (error) {
    logger.error('サーバー作成エラー', error as Error);
    return c.json({ error: `サーバーの作成に失敗しました: ${(error as Error).message}` }, 500);
  }
});

// MCPサーバーの順番を一括で変更するエンドポイント
app.put('/api/servers/reorder', async (c) => {
  try {
    const body = await c.req.json();
    logger.debug(`サーバー順序変更リクエスト`, { body });

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
    logger.error('順序変更エラー', error as Error);
    return c.json({ error: `順序の変更に失敗しました: ${(error as Error).message}` }, 500);
  }
});

// MCPサーバーを更新するエンドポイント
app.put('/api/servers', async (c) => {
  try {
    const body = await c.req.json();
    logger.info('PUT /api/servers リクエスト受信', { body });
    
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
        preserveStates: true,
      });

      // 再度設定を読み込む（名前変更後）
      const updatedConfig = await profileManager.loadConfig();

      // その他の設定（command, args, env, enabled）を更新
      updatedConfig.mcpServers[targetName] = {
        command: command,
        args: args || [],
        env: env || {},
        enabled:
          enabled !== undefined ? enabled : (updatedConfig.mcpServers[targetName]?.enabled ?? true),
      };

      await profileManager.saveConfig(updatedConfig);
    } else {
      // 名前変更なしの場合は値のみ更新
      config.mcpServers[oldName] = {
        command: command,
        args: args || [],
        env: env || {},
        enabled: enabled !== undefined ? enabled : config.mcpServers[oldName].enabled,
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
      logger.warn('プロファイルの不整合を検出', { issues: consistencyCheck.issues });
      await profileManager.repairProfileConsistency();
    }

    // 設定変更を通知
    await notifyConfigChange();
    
    // enabledが変更された場合、または設定が変更された場合は再接続をスケジュール
    const serverState = stateManager.getServerState(targetName);
    if (serverState?.status === 'error') {
      // 有効化された場合
      if (enabled === true && config.mcpServers[oldName]?.enabled === false) {
        logger.info(`サーバーが有効化されました。再接続をスケジュール`, { serverName: targetName });
        scheduleReconnect(targetName);
      }
      // 設定が変更された場合
      else if (command !== config.mcpServers[oldName]?.command || 
               JSON.stringify(args) !== JSON.stringify(config.mcpServers[oldName]?.args) ||
               JSON.stringify(env) !== JSON.stringify(config.mcpServers[oldName]?.env)) {
        logger.info(`サーバー設定が変更されました。再接続をスケジュール`, { serverName: targetName });
        scheduleReconnect(targetName);
      }
    }

    return c.json({ success: true });
  } catch (error) {
    logger.error('サーバー更新エラー', error as Error);
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
    logger.error('サーバー削除エラー', error as Error);
    return c.json({ error: `サーバーの削除に失敗しました: ${(error as Error).message}` }, 500);
  }
});

// ステータスエンドポイント
app.get('/api/status', async (c) => {
  const states = stateManager.getStates();
  const status: Record<string, any> = {};

  for (const [serverName, state] of Object.entries(states)) {
    status[serverName] = {
      enabled: state.config?.enabled ?? false,
      status: state.status,
      toolCount: stateManager.getServerTools(serverName).length,
      error: state.error,
    };
  }

  return c.json(status);
});

// ツール一覧エンドポイント
app.get('/api/tools', async (c) => {
  const tools = stateManager.getTools();
  return c.json(tools);
});

// 特定のサーバーのツール一覧を取得
app.get('/api/servers/:name/tools', async (c) => {
  const serverName = c.req.param('name');
  const tools = stateManager.getServerTools(serverName);

  if (tools.length === 0) {
    const state = stateManager.getServerState(serverName);
    if (!state) {
      return c.json({ error: 'サーバーが見つかりません' }, 404);
    }
  }

  return c.json(tools);
});

// プロファイル一覧を取得
app.get('/api/profiles', async (c) => {
  const config = await loadConfig();
  return c.json({
    profiles: config.profiles || {},
    profileDescriptions: config.profileDescriptions || {},
    profileDisplayNames: config.profileDisplayNames || {},
    activeProfile: config.activeProfile || null,
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
    logger.error('プロファイル設定エラー', error as Error);
    return c.json({ error: 'プロファイルの設定に失敗しました' }, 500);
  }
});

// プロファイルを作成・更新
app.put('/api/profiles/:name', async (c) => {
  try {
    const profileName = c.req.param('name');
    const body = await c.req.json();
    logger.info('PUT /api/profiles リクエスト受信', { profileName, body });

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
    logger.error('プロファイル更新エラー', error as Error);
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
    logger.error('プロファイル削除エラー', error as Error);
    return c.json({ error: 'プロファイルの削除に失敗しました' }, 500);
  }
});

// プロファイルの整合性チェック
app.get('/api/profiles/consistency', async (c) => {
  try {
    const result = await profileManager.checkProfileConsistency();
    return c.json(result);
  } catch (error) {
    logger.error('整合性チェックエラー', error as Error);
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
    logger.error('整合性修復エラー', error as Error);
    return c.json({ error: '整合性の修復に失敗しました' }, 500);
  }
});

// エラー状態の詳細を取得
app.get('/api/errors/:serverName', async (c) => {
  const serverName = c.req.param('serverName');
  const state = stateManager.getServerState(serverName);

  if (!state) {
    return c.json({ serverName, status: 'not_found' }, 404);
  }

  if (state.error) {
    const errorStatus = getErrorStatus(serverName, state.error);
    return c.json({
      serverName,
      ...errorStatus,
      currentError: state.error,
      retryCount: 0,
    });
  }

  return c.json({ serverName, status: 'no_error' });
});

// サーキットブレーカーをリセット
app.post('/api/errors/:serverName/reset', async (c) => {
  try {
    const serverName = c.req.param('serverName');
    resetCircuitBreaker(serverName);

    // 設定変更を通知して再接続を試行
    await notifyConfigChange();

    return c.json({
      success: true,
      message: `${serverName}のサーキットブレーカーをリセットしました`,
    });
  } catch (error) {
    logger.error('サーキットブレーカーリセットエラー', error as Error);
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
    logger.error('全サーキットブレーカーリセットエラー', error as Error);
    return c.json({ error: '全サーキットブレーカーのリセットに失敗しました' }, 500);
  }
});

// 設定ファイルを検証するエンドポイント
app.post('/api/validate', async (c) => {
  try {
    const config = await loadConfig();
    const result = await configValidator.validateConfig(config);

    return c.json({
      valid: result.valid,
      errors: result.errors || [],
      warnings: result.warnings || [],
      suggestions: [], // suggestionsは個別のエラー/警告内に含まれる
    });
  } catch (error) {
    logger.error(`設定検証エラー`, error as Error);
    return c.json({ error: '設定の検証に失敗しました' }, 500);
  }
});

// プロファイル設定を検証するエンドポイント
app.post('/api/validate/profile/:profile', async (c) => {
  try {
    const profile = c.req.param('profile');
    const body = await c.req.json().catch(() => ({}));
    const { repair = false } = body;

    const profilePath = path.join(__dirname, `../mcp-config-${profile}.json`);
    const data = await readFile(profilePath, 'utf-8');
    const config = JSON.parse(data);

    const validationResult = await configValidator.validateConfig(config, true);

    if (!validationResult.valid && repair) {
      const repairResult = await configValidator.repairConfig(config, true);
      if (repairResult.repaired) {
        await writeFile(profilePath, JSON.stringify(repairResult.config, null, 2));
        return c.json({
          valid: true,
          repaired: true,
          changes: repairResult.changes,
          message: `プロファイル ${profile} の設定を自動修復しました`,
        });
      }
    }

    return c.json({
      valid: validationResult.valid,
      errors: validationResult.errors || [],
      warnings: validationResult.warnings || [],
      normalized: validationResult.normalized,
    });
  } catch (error) {
    logger.error(`プロファイル設定検証エラー`, error as Error);
    return c.json({ error: 'プロファイル設定の検証に失敗しました' }, 500);
  }
});

// 設定の部分的な検証エンドポイント
app.post('/api/validate/server', async (c) => {
  try {
    const body = await c.req.json();
    const config = await loadConfig();

    // 一時的な設定を作成して検証
    const tempConfig = {
      ...config,
      mcpServers: {
        ...config.mcpServers,
        [body.name]: body.config,
      },
    };

    const result = await configValidator.validateConfig(tempConfig);

    // 特定のサーバーに関連するエラーのみ抽出
    const serverErrors = (result.errors || []).filter((error) =>
      error.path.includes(`mcpServers.${body.name}`)
    );
    const serverWarnings = (result.warnings || []).filter((warning) =>
      warning.path.includes(`mcpServers.${body.name}`)
    );

    return c.json({
      valid: serverErrors.length === 0,
      errors: serverErrors,
      warnings: serverWarnings,
    });
  } catch (error) {
    logger.error(`サーバー検証エラー`, error as Error);
    return c.json({ error: 'サーバー設定の検証に失敗しました' }, 500);
  }
});

// 環境変数の検証エンドポイント（簡易版）
app.get('/api/validate/env', async (c) => {
  try {
    const config = await loadConfig();
    const missing: string[] = [];
    const invalid: string[] = [];

    // 環境変数の簡易チェック
    for (const [serverName, server] of Object.entries(config.mcpServers || {})) {
      const serverConfig = server as ServerConfig;
      if (serverConfig.env) {
        for (const [key, value] of Object.entries(serverConfig.env)) {
          if (typeof value === 'string' && value.includes('${')) {
            const envVarMatch = value.match(/\${([^}]+)}/g);
            if (envVarMatch) {
              envVarMatch.forEach((match) => {
                const envVar = match.slice(2, -1);
                if (!process.env[envVar]) {
                  missing.push(`${serverName}: ${envVar}`);
                }
              });
            }
          }
        }
      }
    }

    return c.json({
      missing,
      invalid,
      valid: missing.length === 0 && invalid.length === 0,
    });
  } catch (error) {
    logger.error(`環境変数検証エラー`, error as Error);
    return c.json({ error: '環境変数の検証に失敗しました' }, 500);
  }
});

// 設定の自動修正エンドポイント
app.post('/api/fix-config', async (c) => {
  try {
    const config = await loadConfig();
    const validationResult = await configValidator.validateConfig(config);

    if (validationResult.valid) {
      return c.json({
        message: '設定は既に有効です',
        fixed: false,
        result: validationResult,
      });
    }

    // 自動修正可能なエラーを修正
    let fixed = false;
    const fixedConfig = { ...config };

    // プロファイルの整合性を修復
    await profileManager.repairProfileConsistency();
    fixed = true;

    // 再度検証
    const newConfig = await loadConfig();
    const newValidationResult = await configValidator.validateConfig(newConfig);

    return c.json({
      message: fixed ? '設定を部分的に修正しました' : '自動修正できる問題はありませんでした',
      fixed,
      result: newValidationResult,
      remainingErrors: newValidationResult.errors ? newValidationResult.errors.length : 0,
    });
  } catch (error) {
    logger.error(`設定修正エラー`, error as Error);
    return c.json({ error: '設定の自動修正に失敗しました' }, 500);
  }
});

const port = Number(process.env.PORT) || 3003;

logger.info(`APIサーバー起動`, { url: `http://localhost:${port}` });

export default {
  port,
  fetch: app.fetch,
};
