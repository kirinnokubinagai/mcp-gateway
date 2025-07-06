/**
 * 設定検証のテスト
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { configValidator } from '../config-validator.js';

describe('ConfigValidator', () => {
  describe('validateConfig', () => {
    it('有効な設定を検証できる', async () => {
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['test.js'],
            env: { NODE_ENV: 'test' },
            enabled: true,
          },
        },
      };

      const result = await configValidator.validateConfig(config, false);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
      expect(result.normalized).toBeDefined();
      expect(result.normalized!.version).toBe('1.0.0');
    });

    it('必須フィールドがない場合エラーになる', async () => {
      const config = {
        mcpServers: {
          'test-server': {
            // commandがない
            args: ['test.js'],
            enabled: true,
          },
        },
      };

      const result = await configValidator.validateConfig(config, false);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0].message).toContain('command');
    });

    it('危険なコマンドを検出する', async () => {
      const config = {
        mcpServers: {
          'dangerous-server': {
            command: 'rm',
            args: ['-rf', '/'],
            enabled: true,
          },
        },
      };

      const result = await configValidator.validateConfig(config, false);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some((e) => e.message.includes('危険なコマンド'))).toBe(true);
    });

    it('機密情報を含む環境変数に警告を出す', async () => {
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['test.js'],
            env: {
              API_KEY: 'secret-key-123',
              DATABASE_PASSWORD: 'password123',
            },
            enabled: true,
          },
        },
      };

      const result = await configValidator.validateConfig(config, false);

      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings!.some((w) => w.message.includes('機密情報'))).toBe(true);
    });

    it('プロファイル設定を検証できる', async () => {
      const profileConfig = {
        servers: {
          'test-server': {
            command: 'node',
            args: ['test.js'],
            enabled: true,
          },
        },
      };

      const result = await configValidator.validateConfig(profileConfig, true);

      expect(result.valid).toBe(true);
      expect(result.normalized).toBeDefined();
      expect(result.normalized!.servers).toBeDefined();
    });
  });

  describe('repairConfig', () => {
    it('不正な値を修復できる', async () => {
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node',
            // argsとenvが不正な値
            args: 'not-an-array',
            env: null,
            enabled: 'yes', // boolean型でない
          },
        },
      };

      const result = await configValidator.repairConfig(config, false);

      expect(result.repaired).toBe(true);
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.config.mcpServers['test-server'].args).toEqual([]);
      expect(result.config.mcpServers['test-server'].env).toEqual({});
      expect(result.config.mcpServers['test-server'].enabled).toBe(true);
    });

    it('旧形式から新形式にマイグレーションできる', async () => {
      const oldConfig = {
        servers: {
          'test-server': {
            command: 'node',
            args: ['test.js'],
          },
        },
      };

      const result = await configValidator.repairConfig(oldConfig, false);

      expect(result.repaired).toBe(true);
      expect(result.config.mcpServers).toBeDefined();
      expect(result.config.servers).toBeUndefined();
      expect(result.config.version).toBe('1.0.0');
    });

    it('デフォルト値を適用できる', async () => {
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node',
            // args, env, enabledが省略されている
          },
        },
      };

      const result = await configValidator.repairConfig(config, false);

      expect(result.config.mcpServers['test-server'].args).toEqual([]);
      expect(result.config.mcpServers['test-server'].env).toEqual({});
      expect(result.config.mcpServers['test-server'].enabled).toBe(true);
    });
  });

  describe('セキュリティチェック', () => {
    it('コマンドインジェクションを検出する', async () => {
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node && rm -rf /',
            enabled: true,
          },
        },
      };

      const result = await configValidator.validateConfig(config, false);

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.message.includes('潜在的に危険な文字'))).toBe(true);
    });

    it('ディレクトリトラバーサルを検出する', async () => {
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['../../sensitive/file.js'],
            enabled: true,
          },
        },
      };

      const result = await configValidator.validateConfig(config, false);

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.message.includes('潜在的に危険な文字'))).toBe(true);
    });
  });

  describe('プロファイル整合性チェック', () => {
    it('存在しないサーバーへの参照を検出する', async () => {
      const config = {
        mcpServers: {
          server1: {
            command: 'node',
            enabled: true,
          },
        },
        profiles: {
          'test-profile': {
            server1: true,
            'non-existent-server': true, // 存在しないサーバー
          },
        },
      };

      const result = await configValidator.validateConfig(config, false);

      expect(result.warnings).toBeDefined();
      expect(
        result.warnings!.some(
          (w) =>
            w.message.includes('存在しないサーバー') && w.message.includes('non-existent-server')
        )
      ).toBe(true);
    });

    it('存在しないアクティブプロファイルを検出する', async () => {
      const config = {
        mcpServers: {
          server1: {
            command: 'node',
            enabled: true,
          },
        },
        profiles: {
          profile1: {},
        },
        activeProfile: 'non-existent-profile',
      };

      const result = await configValidator.validateConfig(config, false);

      expect(result.valid).toBe(false);
      expect(
        result.errors!.some(
          (e) => e.message.includes('アクティブプロファイル') && e.message.includes('存在しません')
        )
      ).toBe(true);
    });
  });
});
