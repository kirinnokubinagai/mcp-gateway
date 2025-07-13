export class SimpleConfigValidator {
  async validateConfig(config: any, isProfile?: boolean): Promise<{ valid: boolean; errors?: any[]; warnings?: any[]; normalized?: any }> {
    
    if (!config || typeof config !== 'object') {
      return {
        valid: false,
        errors: [{
          path: '',
          message: '設定は有効なJSONオブジェクトである必要があります'
        }]
      };
    }
    
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      return {
        valid: false,
        errors: [{
          path: 'mcpServers',
          message: 'mcpServersフィールドが必要です'
        }]
      };
    }
    
    return { 
      valid: true,
      warnings: [],
      normalized: config
    };
  }
  
  async repairConfig(config: any): Promise<any> {
    return {
      repaired: false,
      config: config,
      changes: []
    };
  }
}

export const configValidator = new SimpleConfigValidator();