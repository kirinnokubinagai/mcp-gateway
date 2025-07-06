#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '..', 'mcp-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 環境変数に置き換えるマッピング
const secretsMap = {
  'GITHUB_PERSONAL_ACCESS_TOKEN': '${GITHUB_PERSONAL_ACCESS_TOKEN}',
  'SUPABASE_ACCESS_TOKEN': '${SUPABASE_ACCESS_TOKEN}',
  'CHANNEL_ACCESS_TOKEN': '${CHANNEL_ACCESS_TOKEN}',
  'DESTINATION_USER_ID': '${DESTINATION_USER_ID}',
  'OBSIDIAN_API_KEY': '${OBSIDIAN_API_KEY}',
  'OBSIDIAN_HOST': '${OBSIDIAN_HOST}',
  'STRIPE_SECRET_KEY': '${STRIPE_SECRET_KEY}',
  'N8N_API_KEY': '${N8N_API_KEY}',
  'N8N_API_URL': '${N8N_API_URL}',
  'MAGIC_API_KEY': '${MAGIC_API_KEY}',
  'PROJECT_ID': '${PROJECT_ID}',
  'GENMEDIA_BUCKET': '${GENMEDIA_BUCKET}',
  'MCP_SERVER_REQUEST_TIMEOUT': '${MCP_SERVER_REQUEST_TIMEOUT}'
};

// mcpServersセクションの環境変数を置き換え
if (config.mcpServers) {
  Object.keys(config.mcpServers).forEach(serverName => {
    const server = config.mcpServers[serverName];
    if (server.env) {
      Object.keys(server.env).forEach(envKey => {
        if (secretsMap[envKey]) {
          server.env[envKey] = secretsMap[envKey];
        }
      });
    }
  });
}

// 特殊なケースの処理
// n8n-mcpのN8N_API_URLはdocker環境用の設定を維持
if (config.mcpServers['n8n-mcp']?.env?.N8N_API_URL) {
  // 既にDockerコマンドに含まれている場合は、host.docker.internalを使用
  if (config.mcpServers['n8n-mcp'].args.includes('--add-host=host.docker.internal:host-gateway')) {
    config.mcpServers['n8n-mcp'].env.N8N_API_URL = 'http://host.docker.internal:5678';
  }
}

// ファイルに書き込み
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('✅ mcp-config.json の秘密鍵を環境変数参照に置き換えました');