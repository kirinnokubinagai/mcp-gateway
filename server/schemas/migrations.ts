/**
 * 設定ファイルのマイグレーション定義
 */

export interface Migration {
  version: string;
  description: string;
  up: (config: any) => any;
  down?: (config: any) => any;
}

export const migrations: Migration[] = [
  {
    version: '0.1.0',
    description: 'servers → mcpServers への移行',
    up: (config) => {
      if (config.servers && !config.mcpServers) {
        return {
          ...config,
          mcpServers: config.servers,
          servers: undefined
        };
      }
      return config;
    },
    down: (config) => {
      if (config.mcpServers && !config.servers) {
        return {
          ...config,
          servers: config.mcpServers,
          mcpServers: undefined
        };
      }
      return config;
    }
  },
  {
    version: '0.2.0',
    description: 'enabled フィールドのデフォルト値設定',
    up: (config) => {
      const servers = config.mcpServers || config.servers || {};
      const updatedServers: any = {};
      
      Object.entries(servers).forEach(([name, server]: [string, any]) => {
        updatedServers[name] = {
          ...server,
          enabled: server.enabled !== undefined ? server.enabled : true
        };
      });
      
      return {
        ...config,
        [config.mcpServers ? 'mcpServers' : 'servers']: updatedServers
      };
    }
  },
  {
    version: '0.3.0',
    description: '環境変数の正規化',
    up: (config) => {
      const servers = config.mcpServers || config.servers || {};
      const updatedServers: any = {};
      
      Object.entries(servers).forEach(([name, server]: [string, any]) => {
        updatedServers[name] = {
          ...server,
          args: server.args || [],
          env: server.env || {}
        };
      });
      
      return {
        ...config,
        [config.mcpServers ? 'mcpServers' : 'servers']: updatedServers
      };
    }
  },
  {
    version: '1.0.0',
    description: 'バージョンフィールドの追加',
    up: (config) => {
      if (!config.version) {
        return {
          version: '1.0.0',
          ...config
        };
      }
      return config;
    }
  }
];

/**
 * バージョン比較関数
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }
  
  return 0;
}

/**
 * 設定をターゲットバージョンまでマイグレーション
 */
export function migrateConfig(config: any, targetVersion: string = '1.0.0'): any {
  let migratedConfig = { ...config };
  const currentVersion = config.version || '0.0.0';
  
  const applicableMigrations = migrations.filter(m => 
    compareVersions(m.version, currentVersion) > 0 &&
    compareVersions(m.version, targetVersion) <= 0
  );
  
  applicableMigrations.sort((a, b) => compareVersions(a.version, b.version));
  
  for (const migration of applicableMigrations) {
    console.log(`マイグレーション実行: ${migration.version} - ${migration.description}`);
    migratedConfig = migration.up(migratedConfig);
  }
  
  return migratedConfig;
}

/**
 * 設定をダウングレード
 */
export function downgradeConfig(config: any, targetVersion: string): any {
  let downgradedConfig = { ...config };
  const currentVersion = config.version || '1.0.0';
  
  const applicableMigrations = migrations.filter(m => 
    compareVersions(m.version, targetVersion) > 0 &&
    compareVersions(m.version, currentVersion) <= 0 &&
    m.down
  );
  
  applicableMigrations.sort((a, b) => compareVersions(b.version, a.version));
  
  for (const migration of applicableMigrations) {
    if (migration.down) {
      console.log(`ダウングレード実行: ${migration.version} - ${migration.description}`);
      downgradedConfig = migration.down(downgradedConfig);
    }
  }
  
  return downgradedConfig;
}