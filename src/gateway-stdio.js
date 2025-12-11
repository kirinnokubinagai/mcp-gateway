#!/usr/bin/env node
/**
 * STDIO版 MCP Gateway
 * - Claude などの STDIO transport 用に、プロファイル内の MCP を起動し、中継する
 * - list-tools (tools/list) は全 MCP に問い合わせて集約し、その他は先頭 MCP に転送
 */

import readline from 'readline';
import path from 'path';
import os from 'os';
import { ProcessManager } from './process-manager.js';
import { StateStore } from './storage.js';

const log = (...m) => console.error('[gateway-stdio]', ...m);

const parseArgs = () => {
  const args = {};
  process.argv.slice(2).forEach((a) => {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v ?? true;
    }
  });
  return args;
};

const METHODS_LIST = new Set(['tools/list', 'list_tools']);
let uidCounter = 0;
const uid = () => `agg-${Date.now()}-${uidCounter++}`;

const main = async () => {
  const args = parseArgs();
  const profileName = args.profile || process.env.MCP_PROFILE || 'default';
  const port = args.port ? Number(args.port) : (process.env.PORT ? Number(process.env.PORT) : 8787);
  const host = args.host || process.env.HOST || '127.0.0.1';
  const dataDir = args['data-dir'] || process.env.MCP_DATA_DIR || path.join(os.homedir(), '.mcp-gateway');

  const store = new StateStore(dataDir);
  await store.init();
  const state = store.getState();
  const profile = state.profiles[profileName];
  if (!profile) {
    log(`profile '${profileName}' not found`);
    process.exit(1);
  }
  const servers = (profile.servers || []).map((id) => state.servers[id]).filter(Boolean);
  if (servers.length === 0) {
    log(`profile '${profileName}' has no MCP entries`);
    process.exit(1);
  }

  const pm = new ProcessManager(path.join(dataDir, 'logs'));
  await pm.ensureLogDir();

  // 起動順に試し、成功した child を蓄積
  // 並列起動で時間短縮
  const children = servers
    .map((srv) => {
      const status = pm.start(srv);
      if (status && !status.error) {
        const child = pm.get(srv.id);
        if (child) {
          child._mcpId = srv.id;
          return child;
        }
      }
      return null;
    })
    .filter(Boolean);
  if (children.length === 0) {
    log('failed to start any MCP for profile', profileName);
    process.exit(1);
  }

  const primary = children[0]; // 非 list はこれに流す

  // Aggregation state
  const aggPending = new Map(); // origId -> {remaining, tools:[], timer}
  const childIdMap = new Map(); // childReqId -> origId

  const sendToStdout = (obj) => {
    try {
      process.stdout.write(JSON.stringify(obj) + '\n');
    } catch (e) {
      log('failed to write stdout', e.message);
    }
  };

  const handleChildMessage = (child, line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    // aggregated response?
    if (msg.id && childIdMap.has(msg.id)) {
      const origId = childIdMap.get(msg.id);
      const pending = aggPending.get(origId);
      if (!pending) return;
      if (Array.isArray(msg.result?.tools)) {
        pending.tools.push(...msg.result.tools);
      }
      pending.remaining -= 1;
      if (pending.remaining <= 0) {
        clearTimeout(pending.timer);
        sendToStdout({ jsonrpc: '2.0', id: origId, result: { tools: pending.tools } });
        aggPending.delete(origId);
      }
      return;
    }
    // normal passthrough
    sendToStdout(msg);
  };

  children.forEach((c) => {
    const rl = readline.createInterface({ input: c.stdout });
    rl.on('line', (line) => handleChildMessage(c, line));
    c.stderr.on('data', (d) => process.stderr.write(d));
    c.on('exit', (code) => log(`${c._mcpId} exited ${code}`));
  });

  // Read client (Claude) stdin
  const rlClient = readline.createInterface({ input: process.stdin });
  rlClient.on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const method = msg.method;
    if (method && METHODS_LIST.has(method)) {
      // aggregate list-tools
      const origId = msg.id ?? uid();
      const pending = {
        remaining: children.length,
        tools: [],
        timer: setTimeout(() => {
          sendToStdout({ jsonrpc: '2.0', id: origId, result: { tools: pending.tools } });
          aggPending.delete(origId);
        }, 3000)
      };
      aggPending.set(origId, pending);
      children.forEach((child, idx) => {
        const cid = `${origId}-${idx}`;
        childIdMap.set(cid, origId);
        const req = { ...msg, id: cid };
        child.stdin.write(JSON.stringify(req) + '\n');
      });
    } else {
      // passthrough to primary only
      if (primary && primary.stdin.writable) {
        primary.stdin.write(JSON.stringify(msg) + '\n');
      }
    }
  });

  // keep HTTP/UI running? (optional; already running via server.js if desired)
  log(`STDIO gateway ready (profile=${profileName}, host=${host}, port=${port})`);
};

main().catch((err) => {
  console.error('[gateway-stdio] fatal', err);
  process.exit(1);
});
