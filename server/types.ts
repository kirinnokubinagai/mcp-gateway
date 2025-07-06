/**
 * MCPゲートウェイの共通型定義
 */

export interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface ProfileConfig {
  [serverName: string]: boolean;
}

export interface Config {
  version?: string;
  servers?: Record<string, ServerConfig>;
  profiles?: Record<string, ProfileConfig>;
  activeProfile?: string;
  mcpServers: Record<string, ServerConfig>;
}

export interface MCPClientInfo {
  client?: any;
  transport?: any;
  config: ServerConfig;
  configHash?: string;
  tools?: Tool[];
  toolMapping?: Map<string, string>;
  status: 'connected' | 'error' | 'disabled' | 'updating';
  error?: string;
  errorType?: string;
  statusMessage?: string;
  errorDetails?: any;
  retryCount?: number;
  lastRetryTime?: Date;
}

export interface Tool {
  name: string;
  description?: string;
  inputSchema?: any;
}

export interface ServerStatus {
  enabled: boolean;
  status: 'connected' | 'error' | 'disabled' | 'updating';
  toolCount: number;
  error?: string;
}

export interface ValidationError {
  type: 'error' | 'warning';
  path: string;
  message: string;
  value?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  suggestions?: string[];
}
