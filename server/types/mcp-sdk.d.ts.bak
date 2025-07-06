/**
 * @modelcontextprotocol/sdk の型定義
 *
 * MCPプロトコルのクライアント実装に必要な型定義を提供します。
 * 実際のSDKがインストールされていない場合の互換性のための定義です。
 */

declare module '@modelcontextprotocol/sdk/client/index.js' {
  /**
   * MCPクライアントの設定
   */
  export interface ClientConfig {
    name: string;
    version?: string;
  }

  /**
   * MCPクライアントの機能
   */
  export interface ClientCapabilities {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    sampling?: boolean;
  }

  /**
   * トランスポート層のインターフェース
   */
  export interface Transport {
    start(): Promise<void>;
    send(message: any): Promise<void>;
    close(): Promise<void>;
    onMessage?: (handler: (message: any) => void) => void;
    onError?: (handler: (error: Error) => void) => void;
    onClose?: (handler: () => void) => void;
    // WebSocketTransportとの互換性のためのプロパティ
    onmessage?: (message: any) => void;
    onerror?: (error: Error) => void;
    onclose?: () => void;
  }

  /**
   * ツール定義
   */
  export interface Tool {
    name: string;
    description?: string;
    inputSchema?: {
      type: string;
      properties?: Record<string, any>;
      required?: string[];
    };
  }

  /**
   * リソース定義
   */
  export interface Resource {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
  }

  /**
   * プロンプト定義
   */
  export interface Prompt {
    name: string;
    description?: string;
    arguments?: Array<{
      name: string;
      description?: string;
      required?: boolean;
    }>;
  }

  /**
   * ツール呼び出しの引数
   */
  export interface CallToolArguments {
    name: string;
    arguments?: Record<string, any>;
  }

  /**
   * リソース読み取りの引数
   */
  export interface ReadResourceArguments {
    uri: string;
  }

  /**
   * プロンプト取得の引数
   */
  export interface GetPromptArguments {
    name: string;
    arguments?: Record<string, any>;
  }

  /**
   * MCPクライアントクラス
   */
  export class Client {
    constructor(config: ClientConfig, options?: { capabilities?: ClientCapabilities });

    /**
     * トランスポートに接続
     */
    connect(transport: Transport): Promise<void>;

    /**
     * 接続を閉じる
     */
    close(): Promise<void>;

    /**
     * 利用可能なツールのリストを取得
     */
    listTools(): Promise<{ tools: Tool[] }>;

    /**
     * ツールを呼び出す
     */
    callTool(args: CallToolArguments): Promise<any>;

    /**
     * 利用可能なリソースのリストを取得
     */
    listResources(): Promise<{ resources: Resource[] }>;

    /**
     * リソースを読み取る
     */
    readResource(args: ReadResourceArguments): Promise<any>;

    /**
     * 利用可能なプロンプトのリストを取得
     */
    listPrompts(): Promise<{ prompts: Prompt[] }>;

    /**
     * プロンプトを取得
     */
    getPrompt(args: GetPromptArguments): Promise<any>;

    /**
     * サンプリングを実行
     */
    complete(args: { prompt: string; modelPreferences?: any }): Promise<any>;

    /**
     * イベントリスナーを追加
     */
    on(event: string, handler: (...args: any[]) => void): void;

    /**
     * イベントリスナーを削除
     */
    off(event: string, handler: (...args: any[]) => void): void;

    /**
     * 一度だけ実行されるイベントリスナーを追加
     */
    once(event: string, handler: (...args: any[]) => void): void;

    /**
     * イベントを発行
     */
    emit(event: string, ...args: any[]): void;
  }
}
