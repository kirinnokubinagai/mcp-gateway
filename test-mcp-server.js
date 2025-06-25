#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// テスト用のシンプルなMCPサーバー
const server = new Server(
  {
    name: "test-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ツールリストのハンドラー
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("テストサーバー: ツールリストリクエスト受信");
  
  return {
    tools: [
      {
        name: "test_hello",
        description: "簡単なテストツール",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "挨拶する名前"
            }
          },
          required: ["name"]
        }
      },
      {
        name: "test_echo",
        description: "入力をそのまま返すツール",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "エコーするメッセージ"
            }
          },
          required: ["message"]
        }
      }
    ]
  };
});

// ツール実行のハンドラー
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  console.error(`テストサーバー: ツール実行リクエスト - ${name}`);
  console.error(`引数: ${JSON.stringify(args)}`);
  
  if (name === "test_hello") {
    return {
      content: [{
        type: "text",
        text: `こんにちは、${args.name}さん！`
      }]
    };
  }
  
  if (name === "test_echo") {
    return {
      content: [{
        type: "text",
        text: `エコー: ${args.message}`
      }]
    };
  }
  
  throw new Error(`不明なツール: ${name}`);
});

// サーバー起動
async function main() {
  console.error("テストMCPサーバー起動中...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("テストMCPサーバー起動完了");
}

main().catch((error) => {
  console.error("エラー:", error);
  process.exit(1);
});