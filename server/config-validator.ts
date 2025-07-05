/**
 * MCP Gateway設定ファイルの検証・正規化・マイグレーション
 */

import Ajv from 'ajv';
import ajvErrors from 'ajv-errors';
import { Config, ServerConfig } from './types.js';
import { 
  configSchema, 
  profileBasedConfigSchema, 
  CONFIG_SCHEMA_VERSION,
  validationRules 
} from './schemas/config-schema.js';
import { migrateConfig, compareVersions } from './schemas/migrations.js';
import * as path from 'path';

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  normalized?: Config;
}

export interface ValidationError {
  path: string;
  message: string;
  value?: any;
  suggestion?: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

export class ConfigValidator {
  private ajv: Ajv;
  private validateMainConfig: any;
  private validateProfileConfig: any;

  constructor() {
    this.ajv = new Ajv({ 
      allErrors: true, 
      useDefaults: true,
      removeAdditional: false,
      strict: false
    });
    ajvErrors(this.ajv);
    
    this.validateMainConfig = this.ajv.compile(configSchema);
    this.validateProfileConfig = this.ajv.compile(profileBasedConfigSchema);
  }

  /**
   * 設定ファイルの検証とマイグレーション
   */
  async validateConfig(config: any, isProfileConfig: boolean = false): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    try {
      // 基本的な型チェック
      if (typeof config !== 'object' || config === null) {
        errors.push({
          path: '',
          message: '設定は有効なJSONオブジェクトである必要があります'
        });
        return { valid: false, errors };
      }

      // マイグレーションの実行
      let normalizedConfig = await this.migrateConfigIfNeeded(config);
      
      // JSON Schema検証
      const validator = isProfileConfig ? this.validateProfileConfig : this.validateMainConfig;
      const valid = validator(normalizedConfig);
      
      if (!valid && validator.errors) {
        errors.push(...this.formatAjvErrors(validator.errors));
      }

      // カスタム検証
      const customValidation = await this.performCustomValidation(normalizedConfig, isProfileConfig);
      errors.push(...customValidation.errors);
      warnings.push(...customValidation.warnings);

      // 設定の正規化
      normalizedConfig = this.normalizeConfig(normalizedConfig, isProfileConfig);

      // セキュリティチェック
      const securityCheck = this.performSecurityCheck(normalizedConfig);
      errors.push(...securityCheck.errors);
      warnings.push(...securityCheck.warnings);

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        normalized: errors.length === 0 ? normalizedConfig : undefined
      };
    } catch (error) {
      errors.push({
        path: '',
        message: `検証中に予期しないエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`
      });
      return { valid: false, errors };
    }
  }

  /**
   * 必要に応じて設定をマイグレーション
   */
  private async migrateConfigIfNeeded(config: any): Promise<any> {
    const currentVersion = config.version || '0.0.0';
    
    if (compareVersions(currentVersion, CONFIG_SCHEMA_VERSION) < 0) {
      console.log(`設定をバージョン ${currentVersion} から ${CONFIG_SCHEMA_VERSION} へマイグレーションします`);
      return migrateConfig(config, CONFIG_SCHEMA_VERSION);
    }
    
    return config;
  }

  /**
   * AJVエラーを読みやすい形式に変換
   */
  private formatAjvErrors(ajvErrors: any[]): ValidationError[] {
    const errors: ValidationError[] = [];
    
    for (const error of ajvErrors) {
      let message = '';
      let suggestion = '';
      
      switch (error.keyword) {
        case 'required':
          message = `必須フィールド '${error.params.missingProperty}' が見つかりません`;
          suggestion = `設定に '${error.params.missingProperty}' フィールドを追加してください`;
          break;
        case 'type':
          message = `'${error.instancePath}' の型が正しくありません。期待: ${error.params.type}`;
          break;
        case 'additionalProperties':
          message = `許可されていないプロパティ '${error.params.additionalProperty}' が含まれています`;
          suggestion = 'このプロパティを削除するか、スキーマを更新してください';
          break;
        case 'pattern':
          message = `'${error.instancePath}' の値がパターンに一致しません`;
          break;
        case 'minLength':
          message = `'${error.instancePath}' の値が短すぎます（最小: ${error.params.limit}文字）`;
          break;
        default:
          message = error.message || '検証エラー';
      }
      
      errors.push({
        path: error.instancePath || error.dataPath || '',
        message,
        value: error.data,
        suggestion
      });
    }
    
    return errors;
  }

  /**
   * カスタム検証ロジック
   */
  private async performCustomValidation(config: any, isProfileConfig: boolean): Promise<{
    errors: ValidationError[];
    warnings: ValidationWarning[];
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const servers = config.servers || config.mcpServers || {};

    // サーバー設定の検証
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      const server = serverConfig as ServerConfig;
      
      // コマンドの検証
      if (server.command) {
        const commandBase = server.command.split(/\s+/)[0];
        const commandName = path.basename(commandBase);
        
        // 危険なコマンドのチェック
        if (validationRules.command.forbidden.includes(commandName)) {
          errors.push({
            path: `servers.${serverName}.command`,
            message: `危険なコマンド '${commandName}' は使用できません`,
            value: server.command,
            suggestion: '安全なコマンドを使用してください'
          });
        }
        
        // コマンドパスの検証
        if (commandBase.startsWith('/') || commandBase.startsWith('\\')) {
          const normalizedPath = path.normalize(commandBase);
          for (const forbiddenPath of validationRules.path.forbidden) {
            if (normalizedPath.startsWith(forbiddenPath)) {
              errors.push({
                path: `servers.${serverName}.command`,
                message: `禁止されたパス '${forbiddenPath}' へのアクセスは許可されていません`,
                value: server.command
              });
            }
          }
        }
      }
      
      // 引数の検証
      if (server.args && Array.isArray(server.args)) {
        server.args.forEach((arg, index) => {
          if (typeof arg !== 'string') {
            errors.push({
              path: `servers.${serverName}.args[${index}]`,
              message: '引数は文字列である必要があります',
              value: arg
            });
          }
        });
      }
      
      // 環境変数の検証
      if (server.env) {
        for (const [envKey, envValue] of Object.entries(server.env)) {
          // 機密情報の警告
          for (const sensitiveKey of validationRules.env.sensitiveKeys) {
            if (envKey.toUpperCase().includes(sensitiveKey)) {
              warnings.push({
                path: `servers.${serverName}.env.${envKey}`,
                message: `環境変数 '${envKey}' には機密情報が含まれている可能性があります`,
                suggestion: '機密情報は環境変数ファイルや秘密管理システムで管理することを推奨します'
              });
            }
          }
          
          // 値の型チェック
          if (typeof envValue !== 'string') {
            errors.push({
              path: `servers.${serverName}.env.${envKey}`,
              message: '環境変数の値は文字列である必要があります',
              value: envValue
            });
          }
        }
      }
    }

    // プロファイル設定の検証
    if (!isProfileConfig && config.profiles) {
      for (const [profileName, profile] of Object.entries(config.profiles)) {
        if (typeof profile !== 'object' || profile === null) {
          errors.push({
            path: `profiles.${profileName}`,
            message: 'プロファイルはオブジェクトである必要があります',
            value: profile
          });
          continue;
        }
        
        // プロファイル内のサーバー参照チェック
        for (const serverName of Object.keys(profile as any)) {
          if (!servers[serverName]) {
            warnings.push({
              path: `profiles.${profileName}.${serverName}`,
              message: `プロファイルが存在しないサーバー '${serverName}' を参照しています`,
              suggestion: 'サーバー設定を追加するか、プロファイルから削除してください'
            });
          }
        }
      }
      
      // アクティブプロファイルの検証
      if (config.activeProfile && !config.profiles[config.activeProfile]) {
        errors.push({
          path: 'activeProfile',
          message: `アクティブプロファイル '${config.activeProfile}' が存在しません`,
          value: config.activeProfile,
          suggestion: '存在するプロファイル名を指定してください'
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * セキュリティチェック
   */
  private performSecurityCheck(config: any): {
    errors: ValidationError[];
    warnings: ValidationWarning[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const servers = config.servers || config.mcpServers || {};

    for (const [serverName, server] of Object.entries(servers)) {
      const serverConfig = server as ServerConfig;
      
      // コマンドインジェクションの検出
      const dangerousPatterns = [
        /[;&|`$()]/,  // シェルメタ文字
        /\.\./,       // ディレクトリトラバーサル
        /[<>]/        // リダイレクト
      ];
      
      // コマンドのチェック
      if (serverConfig.command) {
        for (const pattern of dangerousPatterns) {
          if (pattern.test(serverConfig.command)) {
            warnings.push({
              path: `servers.${serverName}.command`,
              message: 'コマンドに潜在的に危険な文字が含まれています',
              suggestion: 'コマンドを見直し、必要に応じてエスケープしてください'
            });
            break;
          }
        }
      }
      
      // 引数のチェック
      if (serverConfig.args) {
        serverConfig.args.forEach((arg, index) => {
          for (const pattern of dangerousPatterns) {
            if (pattern.test(arg)) {
              warnings.push({
                path: `servers.${serverName}.args[${index}]`,
                message: '引数に潜在的に危険な文字が含まれています',
                suggestion: '引数を見直し、必要に応じてエスケープしてください'
              });
              break;
            }
          }
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * 設定の正規化
   */
  private normalizeConfig(config: any, isProfileConfig: boolean): Config {
    const normalized: any = { ...config };
    
    // バージョンの設定
    if (!normalized.version) {
      normalized.version = CONFIG_SCHEMA_VERSION;
    }
    
    // サーバー設定の正規化
    const serverKey = normalized.mcpServers ? 'mcpServers' : 'servers';
    const servers = normalized[serverKey] || {};
    const normalizedServers: Record<string, ServerConfig> = {};
    
    for (const [name, server] of Object.entries(servers)) {
      const serverConfig = server as any;
      normalizedServers[name] = {
        command: serverConfig.command.trim(),
        args: serverConfig.args || [],
        env: serverConfig.env || {},
        enabled: serverConfig.enabled !== undefined ? serverConfig.enabled : true
      };
      
      // 環境変数の展開をマーク
      if (normalizedServers[name].env) {
        for (const [key, value] of Object.entries(normalizedServers[name].env!)) {
          if (typeof value === 'string' && value.includes('${')) {
            console.log(`環境変数展開が必要: ${name}.env.${key} = ${value}`);
          }
        }
      }
    }
    
    if (!isProfileConfig) {
      // メイン設定の正規化
      normalized.mcpServers = normalizedServers;
      delete normalized.servers;
      
      // プロファイルの正規化
      if (!normalized.profiles) {
        normalized.profiles = {};
      }
    } else {
      // プロファイル設定の正規化
      normalized.servers = normalizedServers;
    }
    
    return normalized as Config;
  }

  /**
   * 設定の自動修復
   */
  async repairConfig(config: any, isProfileConfig: boolean = false): Promise<{
    repaired: boolean;
    config: Config;
    changes: string[];
  }> {
    const changes: string[] = [];
    let repaired = { ...config };
    
    // マイグレーションの実行
    const migratedConfig = await this.migrateConfigIfNeeded(repaired);
    if (JSON.stringify(migratedConfig) !== JSON.stringify(repaired)) {
      changes.push('設定を最新バージョンにマイグレーションしました');
      repaired = migratedConfig;
    }
    
    // デフォルト値の適用
    const validation = await this.validateConfig(repaired, isProfileConfig);
    if (validation.normalized) {
      const normalizedStr = JSON.stringify(validation.normalized);
      const repairedStr = JSON.stringify(repaired);
      
      if (normalizedStr !== repairedStr) {
        changes.push('デフォルト値を適用しました');
        repaired = validation.normalized;
      }
    }
    
    // 不正な値の修正
    const servers = repaired.servers || repaired.mcpServers || {};
    for (const [name, server] of Object.entries(servers)) {
      const serverConfig = server as any;
      
      // enabledフィールドの修正
      if (typeof serverConfig.enabled !== 'boolean') {
        serverConfig.enabled = true;
        changes.push(`${name}.enabled を true に設定しました`);
      }
      
      // 配列フィールドの修正
      if (!Array.isArray(serverConfig.args)) {
        serverConfig.args = [];
        changes.push(`${name}.args を空配列に設定しました`);
      }
      
      // オブジェクトフィールドの修正
      if (typeof serverConfig.env !== 'object' || serverConfig.env === null) {
        serverConfig.env = {};
        changes.push(`${name}.env を空オブジェクトに設定しました`);
      }
    }
    
    return {
      repaired: changes.length > 0,
      config: repaired as Config,
      changes
    };
  }
}

// シングルトンインスタンスのエクスポート
export const configValidator = new ConfigValidator();