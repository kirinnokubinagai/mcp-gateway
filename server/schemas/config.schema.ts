/**
 * MCP Gateway設定のJSON Schemaを定義
 * 
 * 設定ファイルの検証に使用される厳密なスキーマ定義です。
 * すべての設定項目の型、制約、依存関係を定義しています。
 */

export interface MCPServerSchema {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface MCPConfigSchema {
  activeProfile?: string | null;
  profileDescriptions?: Record<string, string>;
  profileDisplayNames?: Record<string, string>;
  profiles?: Record<string, Record<string, boolean>>;
  mcpServers: Record<string, MCPServerSchema>;
}

/**
 * JSON Schemaの定義
 * 
 * 設定ファイルの構造と制約を定義します。
 * この定義は、Ajvライブラリで設定ファイルを検証する際に使用されます。
 */
export const configJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["mcpServers"],
  properties: {
    activeProfile: {
      type: ["string", "null"],
      description: "現在アクティブなプロファイル名"
    },
    profileDescriptions: {
      type: "object",
      description: "プロファイルの説明",
      additionalProperties: { type: "string" }
    },
    profileDisplayNames: {
      type: "object",
      description: "プロファイルの表示名",
      additionalProperties: { type: "string" }
    },
    profiles: {
      type: "object",
      description: "プロファイル別のサーバー有効/無効設定",
      additionalProperties: {
        type: "object",
        additionalProperties: { type: "boolean" }
      }
    },
    mcpServers: {
      type: "object",
      description: "MCPサーバーの設定",
      additionalProperties: {
        type: "object",
        required: ["command"],
        properties: {
          command: {
            type: "string",
            description: "実行するコマンド",
            minLength: 1,
            pattern: "^[a-zA-Z0-9\\-_./]+$",
            examples: ["npx", "uvx", "node", "python", "bun"]
          },
          args: {
            type: "array",
            description: "コマンドライン引数",
            items: { type: "string" },
            examples: [["@modelcontextprotocol/server-github"], ["mcp-obsidian"]]
          },
          env: {
            type: "object",
            description: "環境変数",
            additionalProperties: { type: "string" },
            examples: [{
              "API_KEY": "your-api-key",
              "HOST": "localhost:8080"
            }]
          },
          enabled: {
            type: "boolean",
            description: "サーバーの有効/無効",
            default: true
          }
        }
      }
    }
  },
  additionalProperties: false
};

/**
 * 環境変数の検証ルール
 * 
 * 各MCPサーバーが必要とする環境変数を定義します。
 * この定義は、環境変数の存在チェックと値の検証に使用されます。
 */
export const envVariableRules: Record<string, {
  required?: string[];
  optional?: string[];
  format?: Record<string, string>;
}> = {
  github: {
    required: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    format: {
      GITHUB_PERSONAL_ACCESS_TOKEN: "^(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})$"
    }
  },
  supabase: {
    required: ["SUPABASE_ACCESS_TOKEN"],
    format: {
      SUPABASE_ACCESS_TOKEN: "^sbp_[a-f0-9]{40}$"
    }
  },
  line: {
    required: ["CHANNEL_ACCESS_TOKEN", "DESTINATION_USER_ID"],
    format: {
      CHANNEL_ACCESS_TOKEN: "^[a-zA-Z0-9+/=]{100,}$",
      DESTINATION_USER_ID: "^U[a-f0-9]{32}$"
    }
  },
  obsidian: {
    required: ["OBSIDIAN_API_KEY"],
    optional: ["OBSIDIAN_HOST"],
    format: {
      OBSIDIAN_API_KEY: "^[a-f0-9]{64}$",
      OBSIDIAN_HOST: "^[a-zA-Z0-9.-]+:[0-9]+$"
    }
  },
  stripe: {
    required: ["STRIPE_SECRET_KEY"],
    format: {
      STRIPE_SECRET_KEY: "^(sk_test_|sk_live_)[a-zA-Z0-9]{99,}$"
    }
  },
  touchdesigner: {
    optional: ["host", "port"]
  },
  imagen: {
    required: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"],
    format: {
      GOOGLE_CLOUD_PROJECT: "^[a-z][a-z0-9-]{5,29}$"
    }
  },
  avtool: {
    required: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"]
  },
  veo: {
    required: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"]
  },
  lyria: {
    required: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"]
  },
  chirp3: {
    required: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"]
  }
};

/**
 * コマンドの検証ルール
 * 
 * 各コマンドが必要とする引数の数や形式を定義します。
 */
export const commandRules: Record<string, {
  minArgs?: number;
  maxArgs?: number;
  argPatterns?: string[];
}> = {
  npx: {
    minArgs: 1,
    argPatterns: ["^@[a-zA-Z0-9-]+/[a-zA-Z0-9-]+(@[a-zA-Z0-9.-]+)?$", "^[a-zA-Z0-9-]+$"]
  },
  uvx: {
    minArgs: 1,
    argPatterns: ["^[a-zA-Z0-9-]+$"]
  },
  node: {
    minArgs: 1
  },
  python: {
    minArgs: 1
  },
  bun: {
    minArgs: 1
  }
};

/**
 * 設定値の範囲チェックルール
 * 
 * ポート番号などの数値範囲を定義します。
 */
export const valueRangeRules = {
  port: {
    min: 1,
    max: 65535
  },
  timeout: {
    min: 1000,
    max: 300000
  }
};

/**
 * サーバー間の依存関係
 * 
 * あるサーバーが他のサーバーを必要とする場合の依存関係を定義します。
 */
export const serverDependencies: Record<string, string[]> = {
  // 例: 特定のサーバーが他のサーバーを必要とする場合
  // "server-a": ["server-b", "server-c"]
};

/**
 * プロファイルの制約
 * 
 * 特定のプロファイルで必須となるサーバーを定義します。
 */
export const profileConstraints: Record<string, {
  requiredServers?: string[];
  excludedServers?: string[];
}> = {
  claude_desktop: {
    requiredServers: ["github", "line", "obsidian", "context7"]
  },
  gemini_cli: {
    requiredServers: ["github", "supabase", "context7"],
    excludedServers: ["imagen", "avtool", "lyria", "veo", "chirp3"]
  },
  claude_code: {
    requiredServers: ["github", "supabase", "context7", "line", "obsidian"]
  }
};