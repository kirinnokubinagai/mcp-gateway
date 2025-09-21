import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest,
  Tool,
  CallToolResponse,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from './logger.js';
import type { MCPClientManager } from './mcp-client-manager.js';
import type { StateManager } from './state-manager.js';

/**
 * サーバーとクライアントの情報を管理するインターフェース
 */
interface ServerInfo {
  [key: string]: unknown;
}

const logger = createLogger({ module: 'MCPServer' });

export interface MCPServer {
  initialize(): Promise<void>;
  handleListTools(): Promise<{ tools: Tool[] }>;
  handleCallTool(name: string, arguments_: Record<string, unknown>): Promise<CallToolResponse>;
  updateServerStatus(): Promise<void>;
}

export class MCPServerImpl implements MCPServer {
  public server: Server;
  private initialized: boolean = false;

  constructor(
    private clientManager: MCPClientManager,
    private stateManager: StateManager
  ) {
    this.server = new Server(
      {
        name: 'mcp-gateway',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
        },
      }
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // 初期化要求のハンドラー
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      logger.info('初期化リクエストを受信しました', { params: request.params });

      // 初期化時にすべてのMCPサーバーからツールを事前取得
      try {
        logger.info('初期化時のツール事前取得を開始します');
        await this.preloadAllTools();
        logger.info('初期化時のツール事前取得が完了しました');
      } catch (error) {
        logger.warn('初期化時のツール事前取得に失敗しましたが、初期化は継続します', error);
      }

      return {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'mcp-gateway',
          version: '1.0.0',
        },
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
        },
      };
    });

    // ツール一覧要求のハンドラー
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      logger.info('ツール一覧リクエストを受信しました', { params: request.params });
      return this.handleListTools();
    });

    // ツール実行要求のハンドラー
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      logger.info('ツール実行リクエストを受信しました', {
        toolName: request.params.name,
        arguments: request.params.arguments
      });

      return this.handleCallTool(request.params.name, request.params.arguments || {});
    });

    this.initialized = true;
    logger.info('MCPサーバーを初期化しました');
  }

  async handleListTools(): Promise<{ tools: Tool[] }> {
    try {
      const allTools: Tool[] = [];
      const allClients = this.clientManager.getAllClients();

      for (const [serverName, serverConfig] of allClients) {
        if (serverConfig.tools) {
          // サーバー名をプレフィックスとして追加
          const toolsWithPrefix = serverConfig.tools.map(tool => ({
            ...tool,
            name: `${serverName}_${tool.name}`,
          }));
          allTools.push(...toolsWithPrefix);
        }
      }

      logger.info('ツール一覧を取得しました', { toolCount: allTools.length });
      return { tools: allTools };
    } catch (error) {
      logger.error('ツール一覧の取得中にエラーが発生しました', { error });
      return { tools: [] };
    }
  }

  async handleCallTool(name: string, arguments_: Record<string, unknown>): Promise<CallToolResponse> {
    try {
      // ツール名からサーバー名とツール名を分離
      const parts = name.split('_');
      if (parts.length < 2) {
        throw new Error(`無効なツール名です: ${name}`);
      }

      const serverName = parts[0];
      const toolName = parts.slice(1).join('_');

      const result = await this.clientManager.callTool(serverName, toolName, arguments_);
      logger.info('ツールを実行しました', { serverName, toolName });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('ツールの実行中にエラーが発生しました', {
        toolName: name,
        error: errorMessage
      });

      return {
        content: [
          {
            type: 'text',
            text: `ツールの実行中にエラーが発生しました: ${errorMessage}`,
          },
        ],
      };
    }
  }

  async updateServerStatus(): Promise<void> {
    // サーバーの状態を更新
    await this.stateManager.updateServerStatus();
  }

  /**
   * 初期化時にすべてのMCPサーバーからツールを事前取得
   */
  private async preloadAllTools(): Promise<void> {
    const allClients = this.clientManager.getAllClients();
    const preloadPromises: Promise<void>[] = [];

    for (const [serverName, clientInfo] of allClients) {
      // 接続済みのクライアントのみ対象（ツール数に関係なく実行）
      if (clientInfo.client) {
        const preloadPromise = this.preloadToolsForServer(serverName, clientInfo);
        preloadPromises.push(preloadPromise);
      }
    }

    if (preloadPromises.length > 0) {
      logger.info(`${preloadPromises.length}個のサーバーからツールを事前取得します`);
      await Promise.allSettled(preloadPromises);
    } else {
      logger.info('事前取得対象のサーバーがありません');
    }
  }

  /**
   * 特定のサーバーからツールを事前取得
   */
  private async preloadToolsForServer(serverName: string, clientInfo: any): Promise<void> {
    try {
      logger.debug(`ツール事前取得開始: ${serverName}`);

      // 最大30秒でタイムアウト（Claude Desktopの制限に余裕を持たせる）
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`ツール取得タイムアウト: ${serverName}`)), 30000);
      });

      const toolsPromise = clientInfo.client.listTools();
      const toolsResponse = await Promise.race([toolsPromise, timeoutPromise]);

      if (toolsResponse?.tools) {
        clientInfo.tools = toolsResponse.tools.map(
          (tool: { name: string; description?: string; inputSchema?: unknown }) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })
        );

        logger.info(`ツール事前取得完了: ${serverName} (${clientInfo.tools.length}個)`);

        // StateManagerにも更新
        await this.stateManager.updateServerTools(serverName, clientInfo.tools);
      }
    } catch (error) {
      logger.warn(`ツール事前取得失敗: ${serverName}`, error);
      // エラーでも個別サーバーの失敗として扱い、全体の初期化は継続
    }
  }
}

/**
 * MCP サーバーを起動する関数
 */
export async function startMCPServer(mcpServer: MCPServer): Promise<void> {
  await mcpServer.initialize();

  const transport = new StdioServerTransport();
  await (mcpServer as MCPServerImpl).server.connect(transport);

  logger.info('MCP サーバーが起動しました');
}