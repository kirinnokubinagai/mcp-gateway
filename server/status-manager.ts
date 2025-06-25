import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_FILE = path.join(__dirname, '../mcp-status.json');
const TOOLS_FILE = path.join(__dirname, '../mcp-tools.json');

export interface ServerStatus {
  enabled: boolean;
  status: 'connected' | 'error' | 'disabled' | 'updating';
  toolCount: number;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema?: any;
}

// ステータスの保存
export async function saveStatus(status: Record<string, ServerStatus>) {
  try {
    await fs.writeFile(STATUS_FILE, JSON.stringify(status, null, 2));
    
    // WebSocketで通知（循環依存を避けるため動的インポート）
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

// ステータスの読み込み
export async function loadStatus(): Promise<Record<string, ServerStatus>> {
  try {
    const data = await fs.readFile(STATUS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

// ツールの保存
export async function saveTools(tools: Record<string, Tool[]>) {
  try {
    await fs.writeFile(TOOLS_FILE, JSON.stringify(tools, null, 2));
  } catch (error) {
    console.error('ツール保存エラー:', error);
  }
}

// ツールの読み込み
export async function loadTools(): Promise<Record<string, Tool[]>> {
  try {
    const data = await fs.readFile(TOOLS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}