import path from 'path';
import os from 'os';
import { StateStore } from './storage.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const dirArg = args.find((a) => a.startsWith('--data-dir='));
const dataDir = dirArg ? dirArg.split('=')[1] : path.join(os.homedir(), '.mcp-gateway');

const sampleServers = [
  {
    id: 'github-mcp',
    name: 'github-mcp',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github', '--port', '9000'],
    env: { GITHUB_TOKEN: 'xxxxx' },
    autoStart: true
  },
  {
    id: 'fs-mcp',
    name: 'filesystem-mcp',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem', process.cwd()],
    env: {},
    autoStart: false
  }
];

const sampleProfiles = [
  { name: 'default', servers: ['github-mcp'] },
  { name: 'dev', servers: ['github-mcp', 'fs-mcp'] }
];

async function main() {
  const store = new StateStore(dataDir);
  await store.init();
  const state = store.getState();

  // merge servers
  for (const s of sampleServers) {
    if (!state.servers[s.id] || force) {
      await store.upsertServer(s);
    }
  }

  // merge profiles
  for (const p of sampleProfiles) {
    if (!state.profiles[p.name] || force) {
      await store.upsertProfile(p);
    }
  }

  // set active profiles to sample ones if none
  const updated = store.getState();
  if (!updated.activeProfiles || updated.activeProfiles.length === 0 || force) {
    await store.setActiveProfiles(sampleProfiles.map((p) => p.name));
  }

  console.log(`サンプルを登録しました。dataDir: ${dataDir}`);
  console.log('- サーバー: github-mcp (port 9000, GITHUB_TOKEN 必須)');
  console.log('- サーバー: fs-mcp (cwd)');
  console.log('- プロファイル: default, dev');
  console.log('接続URL例 (WS): ws://127.0.0.1:8787/mcp?profile=dev');
  console.log('STDIO 登録例: claude mcp add -s user mcp-gateway -- npx --yes /Users/kirinnokubinagaiyo/Claude-Project/mcp-gateway/scripts/mcp-gateway-stdio.sh --profile=dev');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
