import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// @ts-ignore - ESMモジュールの互換性
const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MCPServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

interface MCPConfig {
  mcpServers: Record<string, MCPServer>;
  profiles?: Record<string, Record<string, boolean>>;
  profileDescriptions?: Record<string, string>;
  profileDisplayNames?: Record<string, string>;
  activeProfile?: string | null;
}

interface ProfileUpdateOptions {
  oldName: string;
  newName: string;
  preserveStates?: boolean;
}

/**
 * プロファイル管理クラス
 * 
 * MCPサーバーの設定とプロファイル間の同期を管理します。
 * トランザクション処理により、設定の整合性を保証します。
 */
export class ProfileManager {
  private configPath: string;
  private backupPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.backupPath = configPath.replace('.json', '.backup.json');
  }

  /**
   * 設定ファイルを読み込む
   * 
   * @returns MCPの設定オブジェクト
   */
  async loadConfig(): Promise<MCPConfig> {
    try {
      const data = await readFile(this.configPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('設定ファイルの読み込みエラー:', error);
      return { mcpServers: {} };
    }
  }

  /**
   * 設定ファイルを保存する（トランザクション処理付き）
   * 
   * @param config - 保存する設定
   * @throws 保存に失敗した場合はエラーをスロー
   */
  async saveConfig(config: MCPConfig): Promise<void> {
    try {
      // バックアップを作成
      const currentConfig = await this.loadConfig();
      await writeFile(this.backupPath, JSON.stringify(currentConfig, null, 2));

      // 新しい設定を保存
      await writeFile(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      // エラーが発生した場合はバックアップから復元を試みる
      try {
        const backup = await readFile(this.backupPath, 'utf-8');
        await writeFile(this.configPath, backup);
      } catch (restoreError) {
        console.error('バックアップからの復元に失敗:', restoreError);
      }
      throw error;
    }
  }

  /**
   * サーバー名を変更し、全プロファイルを同期する
   * 
   * @param options - 更新オプション
   * @returns 成功した場合はtrue
   */
  async renameServerAcrossProfiles(options: ProfileUpdateOptions): Promise<boolean> {
    const { oldName, newName, preserveStates = true } = options;

    if (!oldName || !newName) {
      throw new Error('サーバー名の指定が必要です');
    }

    const config = await this.loadConfig();

    // サーバーが存在するか確認
    if (!config.mcpServers[oldName]) {
      throw new Error(`サーバー "${oldName}" が見つかりません`);
    }

    // 新しい名前が既に使用されているか確認
    if (oldName !== newName && config.mcpServers[newName]) {
      throw new Error(`サーバー名 "${newName}" は既に使用されています`);
    }

    try {
      // 1. サーバー設定を更新（順序を保持）
      const updatedServers: Record<string, MCPServer> = {};
      for (const [key, value] of Object.entries(config.mcpServers)) {
        if (key === oldName) {
          updatedServers[newName] = value;
        } else {
          updatedServers[key] = value;
        }
      }
      config.mcpServers = updatedServers;

      // 2. 全プロファイルを更新
      if (config.profiles) {
        for (const profileName in config.profiles) {
          const profile = config.profiles[profileName];
          if (profile && typeof profile === 'object' && oldName in profile) {
            const currentState = profile[oldName];
            delete profile[oldName];
            profile[newName] = preserveStates ? currentState : true;
          }
        }
      }

      // 3. 設定を保存
      await this.saveConfig(config);
      return true;
    } catch (error) {
      console.error('サーバー名変更エラー:', error);
      throw error;
    }
  }

  /**
   * サーバーの有効/無効状態を全プロファイルで同期する
   * 
   * @param serverName - サーバー名
   * @param enabled - 有効/無効の状態
   */
  async syncServerEnabledState(serverName: string, enabled: boolean): Promise<void> {
    const config = await this.loadConfig();

    if (!config.mcpServers[serverName]) {
      throw new Error(`サーバー "${serverName}" が見つかりません`);
    }

    // サーバーのenabledを更新
    config.mcpServers[serverName].enabled = enabled;

    // プロファイルの状態も同期（必要に応じて）
    if (!enabled && config.profiles) {
      // サーバーが無効化された場合、全プロファイルでも無効にする
      for (const profileName in config.profiles) {
        const profile = config.profiles[profileName];
        if (profile && typeof profile === 'object' && serverName in profile) {
          profile[serverName] = false;
        }
      }
    }

    await this.saveConfig(config);
  }

  /**
   * プロファイル間の整合性をチェックする
   * 
   * @returns 整合性チェックの結果
   */
  async checkProfileConsistency(): Promise<{
    isConsistent: boolean;
    issues: string[];
  }> {
    const config = await this.loadConfig();
    const issues: string[] = [];

    if (!config.profiles) {
      return { isConsistent: true, issues: [] };
    }

    const serverNames = Object.keys(config.mcpServers);

    for (const [profileName, profile] of Object.entries(config.profiles)) {
      if (!profile || typeof profile !== 'object') continue;

      // プロファイルに存在しないサーバーへの参照をチェック
      for (const serverName of Object.keys(profile)) {
        if (!serverNames.includes(serverName)) {
          issues.push(`プロファイル "${profileName}" に存在しないサーバー "${serverName}" への参照があります`);
        }
      }

      // 無効化されたサーバーが有効になっている場合をチェック
      for (const serverName of serverNames) {
        const server = config.mcpServers[serverName];
        if (server.enabled === false && profile[serverName] === true) {
          issues.push(`プロファイル "${profileName}" で無効化されたサーバー "${serverName}" が有効になっています`);
        }
      }
    }

    return {
      isConsistent: issues.length === 0,
      issues
    };
  }

  /**
   * プロファイルの不整合を修復する
   */
  async repairProfileConsistency(): Promise<void> {
    const config = await this.loadConfig();

    if (!config.profiles) return;

    const serverNames = Object.keys(config.mcpServers);
    let hasChanges = false;

    for (const [profileName, profile] of Object.entries(config.profiles)) {
      if (!profile || typeof profile !== 'object') continue;

      // 存在しないサーバーへの参照を削除
      for (const serverName of Object.keys(profile)) {
        if (!serverNames.includes(serverName)) {
          delete profile[serverName];
          hasChanges = true;
          console.log(`プロファイル "${profileName}" から存在しないサーバー "${serverName}" を削除`);
        }
      }

      // 無効化されたサーバーの状態を同期
      for (const serverName of serverNames) {
        const server = config.mcpServers[serverName];
        if (server.enabled === false && profile[serverName] === true) {
          profile[serverName] = false;
          hasChanges = true;
          console.log(`プロファイル "${profileName}" のサーバー "${serverName}" を無効化`);
        }
      }
    }

    if (hasChanges) {
      await this.saveConfig(config);
    }
  }

  /**
   * サーバーを削除し、全プロファイルから参照を削除する
   * 
   * @param serverName - 削除するサーバー名
   */
  async deleteServerAcrossProfiles(serverName: string): Promise<void> {
    const config = await this.loadConfig();

    if (!config.mcpServers[serverName]) {
      throw new Error(`サーバー "${serverName}" が見つかりません`);
    }

    // サーバーを削除
    delete config.mcpServers[serverName];

    // 全プロファイルから参照を削除
    if (config.profiles) {
      for (const profile of Object.values(config.profiles)) {
        if (profile && typeof profile === 'object' && serverName in profile) {
          delete profile[serverName];
        }
      }
    }

    await this.saveConfig(config);
  }

  /**
   * プロファイルの状態を一括更新する
   * 
   * @param profileName - プロファイル名
   * @param updates - 更新する状態のマップ
   */
  async updateProfileStates(
    profileName: string,
    updates: Record<string, boolean>
  ): Promise<void> {
    const config = await this.loadConfig();

    if (!config.profiles) {
      config.profiles = {};
    }

    if (!config.profiles[profileName]) {
      config.profiles[profileName] = {};
    }

    // 既存の状態を保持しながら更新を適用
    const currentProfile = config.profiles[profileName];
    config.profiles[profileName] = {
      ...currentProfile,
      ...updates
    };

    // 存在しないサーバーへの参照を削除
    const serverNames = Object.keys(config.mcpServers);
    for (const serverName of Object.keys(config.profiles[profileName])) {
      if (!serverNames.includes(serverName)) {
        delete config.profiles[profileName][serverName];
      }
    }

    await this.saveConfig(config);
  }
}

// デフォルトのインスタンスをエクスポート
const CONFIG_FILE = path.join(__dirname, '../mcp-config.json');
export const profileManager = new ProfileManager(CONFIG_FILE);