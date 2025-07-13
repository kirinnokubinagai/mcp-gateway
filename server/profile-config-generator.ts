import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger({ module: 'ProfileConfigGenerator' });

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

interface ProfileConfig {
  servers: Record<string, MCPServer>;
}

const PROFILE_NAMES = ['claude-desktop', 'claude-code', 'gemini-cli'];

export class ProfileConfigGenerator {
  /**
   * プロファイル設定ファイルが存在しない場合は自動生成する
   */
  async ensureProfileConfigs(): Promise<void> {
    const mainConfigPath = path.join(__dirname, '../mcp-config.json');
    
    try {
      // メイン設定ファイルを読み込む
      const mainConfigData = await readFile(mainConfigPath, 'utf-8');
      const mainConfig: MCPConfig = JSON.parse(mainConfigData);
      
      for (const profileName of PROFILE_NAMES) {
        const profileConfigPath = path.join(__dirname, `../mcp-config-${profileName}.json`);
        
        // プロファイル設定ファイルが存在しない場合
        if (!existsSync(profileConfigPath)) {
          logger.info(`プロファイル設定ファイルを生成します`, { profile: profileName });
          
          // プロファイル設定を生成
          const profileConfig = this.generateProfileConfig(mainConfig, profileName);
          
          // ファイルに書き込む
          await writeFile(profileConfigPath, JSON.stringify(profileConfig, null, 2));
          logger.info(`プロファイル設定ファイルを作成しました`, { 
            profile: profileName, 
            path: profileConfigPath 
          });
        } else {
          logger.debug(`プロファイル設定ファイルは既に存在します`, { profile: profileName });
        }
      }
    } catch (error) {
      logger.error(`プロファイル設定ファイルの生成エラー`, error as Error);
      throw error;
    }
  }
  
  /**
   * メイン設定からプロファイル設定を生成する
   */
  private generateProfileConfig(mainConfig: MCPConfig, profileName: string): ProfileConfig {
    const profileConfig: ProfileConfig = {
      servers: {}
    };
    
    // メイン設定からサーバー設定をコピー
    for (const [serverName, serverConfig] of Object.entries(mainConfig.mcpServers)) {
      // プロファイル固有の有効/無効状態を適用
      const isEnabled = mainConfig.profiles?.[profileName]?.[serverName] ?? serverConfig.enabled ?? true;
      
      profileConfig.servers[serverName] = {
        ...serverConfig,
        enabled: isEnabled
      };
    }
    
    return profileConfig;
  }
  
  /**
   * プロファイル設定ファイルが存在するかチェック
   */
  async checkProfileConfigExists(profileName: string): Promise<boolean> {
    const profileConfigPath = path.join(__dirname, `../mcp-config-${profileName}.json`);
    return existsSync(profileConfigPath);
  }
  
  /**
   * プロファイル設定ファイルを読み込む（存在しない場合は生成）
   */
  async loadProfileConfig(profileName: string): Promise<ProfileConfig> {
    const profileConfigPath = path.join(__dirname, `../mcp-config-${profileName}.json`);
    
    // ファイルが存在しない場合は生成
    if (!existsSync(profileConfigPath)) {
      await this.ensureProfileConfigs();
    }
    
    const data = await readFile(profileConfigPath, 'utf-8');
    return JSON.parse(data);
  }
}

export const profileConfigGenerator = new ProfileConfigGenerator();