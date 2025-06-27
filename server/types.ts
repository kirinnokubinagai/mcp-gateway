import { StatusType, ErrorType } from './constants.js';

export interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface Config {
  mcpServers: Record<string, ServerConfig>;
}

export interface MCPClientInfo {
  client?: any;
  transport?: any;
  config: ServerConfig;
  tools?: Tool[];
  toolMapping?: Map<string, string>;
  status: StatusType;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema?: any;
}

export interface ServerStatus {
  enabled: boolean;
  status: StatusType;
  toolCount: number;
  error?: string;
  errorType?: ErrorType;
}

export interface ValidationResult {
  valid: boolean;
  errorType?: 'command_not_found' | 'package_not_found' | 'permission_denied' | 'unknown';
  errorMessage?: string;
}

export interface UpdateServerRequest extends ServerConfig {
  newName?: string;
}