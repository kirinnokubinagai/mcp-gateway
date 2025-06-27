import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ERROR_TYPE, ErrorType } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_FILE = path.join(__dirname, '../mcp-status.json');
const TOOLS_FILE = path.join(__dirname, '../mcp-tools.json');

export interface ServerStatus {
  enabled: boolean;
  status: 'connected' | 'error' | 'disabled' | 'updating';
  toolCount: number;
  error?: string;
  errorType?: ErrorType;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema?: any;
}

export async function saveStatus(status: Record<string, ServerStatus>) {
  try {
    await fs.writeFile(STATUS_FILE, JSON.stringify(status, null, 2));
    
    try {
      const { broadcastStatusUpdate } = await import('./web-server.js');
      await broadcastStatusUpdate();
    } catch (e) {
      // web-serverが起動していない場合は無視
    }
  } catch (error) {
    console.error('ステータス保存エラー:', error);
  }
}

export async function loadStatus(): Promise<Record<string, ServerStatus>> {
  try {
    const data = await fs.readFile(STATUS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

export async function saveTools(tools: Record<string, Tool[]>) {
  try {
    await fs.writeFile(TOOLS_FILE, JSON.stringify(tools, null, 2));
  } catch (error) {
    console.error('ツール保存エラー:', error);
  }
}

export async function loadTools(): Promise<Record<string, Tool[]>> {
  try {
    const data = await fs.readFile(TOOLS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

export function classifyError(error: string): ErrorType {
  if (!error) return ERROR_TYPE.UNKNOWN;
  
  const lowerError = error.toLowerCase();
  
  if (lowerError.includes('command not found') || lowerError.includes('enoent') || lowerError.includes('spawn')) {
    return ERROR_TYPE.COMMAND;
  }
  if (lowerError.includes('package not found') || (lowerError.includes('404') && lowerError.includes('npm'))) {
    return ERROR_TYPE.NOT_FOUND;
  }
  if (lowerError.includes('connection closed') || lowerError.includes('econnrefused')) {
    return ERROR_TYPE.CONNECTION;
  }
  if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
    return ERROR_TYPE.TIMEOUT;
  }
  if (lowerError.includes('authentication') || lowerError.includes('unauthorized') || lowerError.includes('403')) {
    return ERROR_TYPE.AUTH;
  }
  
  return ERROR_TYPE.UNKNOWN;
}