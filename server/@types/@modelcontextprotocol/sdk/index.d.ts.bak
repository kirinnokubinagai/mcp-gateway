declare module '@modelcontextprotocol/sdk/client/index.js' {
  export interface ClientOptions {
    name?: string;
    version?: string;
  }

  export interface CallToolRequest {
    name: string;
    arguments?: any;
  }

  export interface ListToolsResponse {
    tools: Tool[];
  }

  export interface Tool {
    name: string;
    description: string;
    inputSchema: any;
  }

  export class Client {
    constructor(options?: ClientOptions);
    connect(transport: any): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<ListToolsResponse>;
    callTool(request: CallToolRequest): Promise<any>;
  }
}

declare module '@modelcontextprotocol/sdk/server/index.js' {
  export interface ServerOptions {
    name: string;
    version: string;
  }

  export interface ServerCapabilities {
    capabilities: {
      tools?: {};
      resources?: {};
      prompts?: {};
    };
  }

  export class Server {
    constructor(options: ServerOptions, capabilities: ServerCapabilities);
    connect(transport: any): Promise<void>;
    setRequestHandler(schema: any, handler: (request: any) => Promise<any>): void;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {
    constructor();
    close(): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/types.js' {
  export const CallToolRequestSchema: any;
  export const ListToolsRequestSchema: any;
  export const ErrorCode: {
    InvalidRequest: string;
    MethodNotFound: string;
    InvalidParams: string;
    InternalError: string;
  };

  export interface McpError extends Error {
    code: string;
    data?: any;
  }
}
