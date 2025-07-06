import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager } from '../state-manager.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_STATUS_FILE = path.join(__dirname, 'test-status.json');
const TEST_TOOLS_FILE = path.join(__dirname, 'test-tools.json');

describe('StateManager', () => {
  let stateManager: StateManager;

  beforeEach(async () => {
    stateManager = new StateManager(TEST_STATUS_FILE, TEST_TOOLS_FILE);
    await stateManager.initialize();
  });

  afterEach(async () => {
    await stateManager.clear(true);
  });

  describe('初期化', () => {
    it('新規インスタンスを正しく初期化できる', async () => {
      const states = stateManager.getStates();
      const tools = stateManager.getTools();

      expect(states).toEqual({});
      expect(tools).toEqual({});
    });

    it('既存のファイルから状態を読み込める', async () => {
      const testStates = {
        'test-server': {
          status: 'connected' as const,
          lastUpdated: new Date().toISOString(),
        },
      };

      const testTools = {
        'test-server': [{ name: 'test-tool', description: 'テストツール' }],
      };

      await fs.writeFile(TEST_STATUS_FILE, JSON.stringify(testStates));
      await fs.writeFile(TEST_TOOLS_FILE, JSON.stringify(testTools));

      const newManager = new StateManager(TEST_STATUS_FILE, TEST_TOOLS_FILE);
      await newManager.initialize();

      expect(newManager.getStates()).toEqual(testStates);
      expect(newManager.getTools()).toEqual(testTools);
    });
  });

  describe('状態の更新', () => {
    it('サーバー状態を更新できる', async () => {
      const serverName = 'test-server';
      const updates = {
        status: 'connected' as const,
        config: {
          command: 'test-command',
          args: ['arg1'],
          env: { TEST: 'value' },
          enabled: true,
        },
      };

      const state = await stateManager.updateServerState(serverName, updates);

      expect(state.status).toBe('connected');
      expect(state.config).toEqual(updates.config);
      expect(state.lastUpdated).toBeDefined();

      const savedState = stateManager.getServerState(serverName);
      expect(savedState).toEqual(state);
    });

    it('部分的な更新が既存の状態とマージされる', async () => {
      const serverName = 'test-server';

      await stateManager.updateServerState(serverName, {
        status: 'connected' as const,
        config: { command: 'test', enabled: true },
      });

      await stateManager.updateServerState(serverName, {
        error: 'テストエラー',
      });

      const state = stateManager.getServerState(serverName);
      expect(state?.status).toBe('connected');
      expect(state?.config).toBeDefined();
      expect(state?.error).toBe('テストエラー');
    });

    it('無効なステータスでエラーがスローされる', async () => {
      await expect(
        stateManager.updateServerState('test', { status: 'invalid' as any })
      ).rejects.toThrow('無効なステータス');
    });

    it('エラーステータスにはエラーメッセージが必要', async () => {
      await expect(stateManager.updateServerState('test', { status: 'error' })).rejects.toThrow(
        'エラーステータスにはエラーメッセージが必要です'
      );
    });
  });

  describe('ツールの管理', () => {
    it('サーバーのツールを更新できる', async () => {
      const serverName = 'test-server';
      const tools = [
        { name: 'tool1', description: 'ツール1' },
        { name: 'tool2', description: 'ツール2' },
      ];

      await stateManager.updateServerTools(serverName, tools);

      const savedTools = stateManager.getServerTools(serverName);
      expect(savedTools).toEqual(tools);
    });

    it('すべてのツールをフラットな配列で取得できる', async () => {
      await stateManager.updateServerTools('server1', [{ name: 'tool1', description: 'ツール1' }]);

      await stateManager.updateServerTools('server2', [{ name: 'tool2', description: 'ツール2' }]);

      const allTools = stateManager.getAllTools();

      expect(allTools).toHaveLength(2);
      expect(allTools[0]).toEqual({
        name: 'server1_tool1',
        description: 'ツール1',
        serverName: 'server1',
      });
      expect(allTools[1]).toEqual({
        name: 'server2_tool2',
        description: 'ツール2',
        serverName: 'server2',
      });
    });
  });

  describe('削除操作', () => {
    it('サーバー状態を削除できる', async () => {
      const serverName = 'test-server';

      await stateManager.updateServerState(serverName, {
        status: 'connected' as const,
      });

      await stateManager.deleteServerState(serverName);

      const state = stateManager.getServerState(serverName);
      expect(state).toBeUndefined();
    });

    it('サーバーのツールを削除できる', async () => {
      const serverName = 'test-server';

      await stateManager.updateServerTools(serverName, [{ name: 'tool1', description: 'ツール1' }]);

      await stateManager.deleteServerTools(serverName);

      const tools = stateManager.getServerTools(serverName);
      expect(tools).toEqual([]);
    });
  });

  describe('イベント', () => {
    it('状態更新時にイベントが発火する', async () => {
      const serverName = 'test-server';
      const mockHandler = vi.fn();

      stateManager.on('state:update', mockHandler);

      await stateManager.updateServerState(serverName, {
        status: 'connected' as const,
      });

      expect(mockHandler).toHaveBeenCalledWith(
        serverName,
        expect.objectContaining({ status: 'connected' })
      );
    });

    it('ツール更新時にイベントが発火する', async () => {
      const serverName = 'test-server';
      const tools = [{ name: 'tool1', description: 'ツール1' }];
      const mockHandler = vi.fn();

      stateManager.on('tools:update', mockHandler);

      await stateManager.updateServerTools(serverName, tools);

      expect(mockHandler).toHaveBeenCalledWith(serverName, tools);
    });

    it('エラー時にエラーイベントが発火する', async () => {
      const mockHandler = vi.fn();
      stateManager.on('error', mockHandler);

      // 無効なJSONファイルを作成
      await fs.writeFile(TEST_STATUS_FILE, '{ invalid json');

      const newManager = new StateManager(TEST_STATUS_FILE, TEST_TOOLS_FILE);
      await newManager.initialize();

      expect(mockHandler).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('永続化', () => {
    it('状態がファイルに保存される', async () => {
      const serverName = 'test-server';

      await stateManager.updateServerState(serverName, {
        status: 'connected' as const,
      });

      // デバウンスタイマーを待つ
      await new Promise((resolve) => setTimeout(resolve, 150));

      const fileContent = await fs.readFile(TEST_STATUS_FILE, 'utf-8');
      const savedStates = JSON.parse(fileContent);

      expect(savedStates[serverName]).toBeDefined();
      expect(savedStates[serverName].status).toBe('connected');
    });

    it('clear(true)でファイルが削除される', async () => {
      await stateManager.updateServerState('test', {
        status: 'connected' as const,
      });

      await stateManager.clear(true);

      await expect(fs.access(TEST_STATUS_FILE)).rejects.toThrow();
      await expect(fs.access(TEST_TOOLS_FILE)).rejects.toThrow();
    });

    it('clear(false)で空の状態がファイルに保存される', async () => {
      await stateManager.updateServerState('test', {
        status: 'connected' as const,
      });

      await stateManager.clear(false);

      const statusContent = await fs.readFile(TEST_STATUS_FILE, 'utf-8');
      const toolsContent = await fs.readFile(TEST_TOOLS_FILE, 'utf-8');

      expect(JSON.parse(statusContent)).toEqual({});
      expect(JSON.parse(toolsContent)).toEqual({});
    });
  });
});
