import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from './server.js';
let ctx = null;
beforeEach(async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-gateway-'));
    const server = await createServer({
        host: '127.0.0.1',
        port: 0,
        dataDir: tmp,
        openBrowser: false
    });
    ctx = { tmp, server };
});
afterEach(async () => {
    if (!ctx)
        return;
    await ctx.server.pm.stopAll();
    await ctx.server.app.close();
    await fs.rm(ctx.tmp, { recursive: true, force: true });
    ctx = null;
});
test('health and state endpoints respond', async () => {
    assert(ctx);
    const base = ctx.server.url;
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    const state = await fetch(`${base}/api/state`).then((r) => r.json());
    assert.ok(state.activeProfile === 'default');
});
test('server CRUD and profile activation', async () => {
    assert(ctx);
    const base = ctx.server.url;
    const created = await fetch(`${base}/api/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'demo',
            command: process.execPath,
            args: ['-e', 'setInterval(()=>{},1000)'],
            env: {},
            autoStart: false
        })
    }).then((r) => r.json());
    assert.equal(created.name, 'demo');
    await fetch(`${base}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'p1', servers: [created.id] })
    });
    await fetch(`${base}/api/profiles/p1/activate`, { method: 'POST' });
    const status = await fetch(`${base}/api/status`).then((r) => r.json());
    assert.equal(status.activeProfile, 'p1');
    // Update server and ensure list is preserved
    await fetch(`${base}/api/servers/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'demo-updated',
            command: process.execPath,
            args: ['-e', 'setInterval(()=>{},2000)'],
            env: {},
            autoStart: false
        })
    });
    const all = await fetch(`${base}/api/servers`).then((r) => r.json());
    const ids = all.map((s) => s.id);
    assert.equal(ids.length, 1);
    assert.ok(ids.includes(created.id));
});
