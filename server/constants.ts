// 設定ファイルのパス
export const CONFIG_FILE = process.env.DOCKER_ENV 
  ? '/app/mcp-config.json' 
  : process.env.CONFIG_FILE || '/app/mcp-config.json';

// サーバー設定
export const SERVER_CONFIG = {
  NAME: 'mcp-gateway',
  VERSION: '3.0.0',
  CAPABILITIES: {
    tools: {}
  }
} as const;

// WebSocket設定
export const WEBSOCKET_CONFIG = {
  PROXY_PORT: process.env.MCP_PROXY_PORT || '9999',
  PROXY_HOST: process.env.DOCKER_ENV ? 'host.docker.internal' : 'localhost',
  PROXY_URL: process.env.MCP_PROXY_URL || `ws://${process.env.DOCKER_ENV ? 'host.docker.internal' : 'localhost'}:${process.env.MCP_PROXY_PORT || '9999'}`
} as const;

// タイムアウト設定
export const TIMEOUT_CONFIG = {
  TOOL_LIST: 10000,        // ツールリスト取得タイムアウト（10秒）
  INITIAL_CONNECTION: 30000, // 初回接続タイムアウト（30秒）
  SYNC_INTERVAL: 5000,      // 設定同期間隔（5秒）
  VALIDATION: 5000,         // コマンド検証タイムアウト（5秒）
  COMMAND_CHECK: 1000,      // コマンド存在確認タイムアウト（1秒）
  INITIAL_WAIT: 1000        // 初期待機時間（1秒）
} as const;

// API設定
export const API_CONFIG = {
  PORT: Number(process.env.PORT || process.env.MCP_API_PORT) || 3003,
  CORS_HEADERS: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Credentials': 'true'
  }
} as const;

// エラーメッセージ
export const ERROR_MESSAGES = {
  INVALID_TOOL_NAME: '不正なツール名形式',
  SERVER_NOT_CONNECTED: 'サーバーは接続されていません',
  SERVER_NAME_REQUIRED: 'サーバー名が必要です',
  SERVER_ALREADY_EXISTS: 'サーバーは既に存在します',
  SERVER_NOT_FOUND: 'サーバーが見つかりません',
  NO_PACKAGE_NAME: 'No package name specified for npx',
  PACKAGE_NOT_FOUND: 'Package not found',
  COMMAND_NOT_FOUND: 'Command not found',
  SCRIPT_NOT_FOUND: 'Script file not found',
  COMMAND_VALIDATION_FAILED: 'Command validation failed',
  TIMEOUT_TOOL_LIST: 'ツールリスト取得タイムアウト',
  TIMEOUT_INITIAL_CONNECTION: '初回接続タイムアウト'
} as const;

// ステータスタイプ
export const STATUS = {
  CONNECTED: 'connected',
  ERROR: 'error',
  DISABLED: 'disabled',
  UPDATING: 'updating'
} as const;

export type StatusType = typeof STATUS[keyof typeof STATUS];

// エラータイプ
export const ERROR_TYPE = {
  CONNECTION: 'connection',
  TIMEOUT: 'timeout',
  NOT_FOUND: 'not_found',
  COMMAND: 'command',
  AUTH: 'auth',
  UNKNOWN: 'unknown'
} as const;

export type ErrorType = typeof ERROR_TYPE[keyof typeof ERROR_TYPE];