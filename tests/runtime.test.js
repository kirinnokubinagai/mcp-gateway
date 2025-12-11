import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

test('health and CRUD keep list intact', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-gateway-'));
  const { pm, inject, server } = await createServer({
    host: '127.0.0.1',
    port: 0,
    dataDir: tmp,
    listen: false
  });

  const health = await inject('GET', '/api/health');
  assert.equal(health.data.ok, true);

  const created = await inject('POST', '/api/servers', {
    name: 'demo',
    command: process.execPath,
    args: ['-e', 'setInterval(()=>{},1000)'],
    env: {},
    autoStart: false
  });

  await inject('POST', '/api/profiles', { name: 'p1', servers: [created.data.id] });
  await inject('POST', '/api/profiles/active', { names: ['p1'] });

  await inject('PUT', `/api/servers/${created.data.id}`, {
    name: 'demo-updated',
    command: process.execPath,
    args: ['-e', 'setInterval(()=>{},2000)'],
    env: {},
    autoStart: false
  });

  const all = await inject('GET', '/api/servers');
  const ids = all.data.map((s) => s.id);
  assert.equal(ids.length, 1);
  assert.ok(ids.includes(created.data.id));

  pm.stopAll();
  if (server) await new Promise((r) => server.close(r));
  await fs.rm(tmp, { recursive: true, force: true });
});
