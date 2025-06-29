import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Hono();

// CORS設定
app.use('/*', cors());

const CONFIG_FILE = path.join(__dirname, '../mcp-config.json');
const STATUS_FILE = path.join(__dirname, '../mcp-status.json');
const TOOLS_FILE = path.join(__dirname, '../mcp-tools.json');

// MCPサーバー一覧を返すエンドポイント
app.get('/api/servers', async (c) => {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);
    return c.json(config.mcpServers || {});
  } catch (error) {
    console.error('Error loading config:', error);
    return c.json({});
  }
});

// ステータスエンドポイント
app.get('/api/status', async (c) => {
  try {
    const data = await readFile(STATUS_FILE, 'utf-8');
    const status = JSON.parse(data);
    return c.json(status);
  } catch (error) {
    return c.json({});
  }
});

// ツール一覧エンドポイント
app.get('/api/tools', async (c) => {
  try {
    const data = await readFile(TOOLS_FILE, 'utf-8');
    const tools = JSON.parse(data);
    return c.json(tools);
  } catch (error) {
    return c.json({});
  }
});

const port = Number(process.env.PORT) || 3003;

console.log(`APIサーバー起動: http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};