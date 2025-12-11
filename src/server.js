import http from 'http';
import { PassThrough } from 'stream';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { URL } from 'url';
import { StateStore } from './storage.js';
import { ProcessManager } from './process-manager.js';
import { mimeFromPath, parseJsonBody, send, tryReadFile } from './helpers.js';
import { validateProfile, validateServer } from './validate.js';
import { attachMcpProxy } from './proxy.js';

const buildRouter = (ctx) => {
  const { store, pm, syncProcesses } = ctx;

  return async function route(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // health
    if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true });

    // state snapshot
    if (pathname === '/api/state' && req.method === 'GET') {
      const s = store.getState();
      s.statuses = pm.status();
      return send(res, 200, s);
    }

    // servers
    if (pathname === '/api/servers' && req.method === 'GET')
      return send(res, 200, Object.values(store.getState().servers));

    if (pathname === '/api/servers' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const validated = validateServer(body);
      if (!validated.ok) return send(res, 400, { errors: validated.errors });
      const server = { ...validated.value, id: validated.value.id || randomBytes(4).toString('hex') };
      await store.upsertServer(server);
      await syncProcesses();
      return send(res, 201, server);
    }

    if (pathname.startsWith('/api/servers/') && req.method === 'PUT') {
      const id = pathname.split('/').pop();
      const body = await parseJsonBody(req);
      const validated = validateServer({ ...body, id });
      if (!validated.ok) return send(res, 400, { errors: validated.errors });
      const server = { ...validated.value, id };
      await store.upsertServer(server);
      await syncProcesses();
      return send(res, 200, server);
    }

    if (pathname.startsWith('/api/servers/') && req.method === 'DELETE') {
      const id = pathname.split('/').pop();
      await store.deleteServer(id);
      await syncProcesses();
      return send(res, 204, '');
    }

    if (pathname.startsWith('/api/servers/') && pathname.endsWith('/start') && req.method === 'POST') {
      const id = pathname.split('/')[3];
      const srv = store.getState().servers[id];
      if (!srv) return send(res, 404, { message: 'Server not found' });
      const status = pm.start(srv);
      return send(res, 200, status);
    }
    if (pathname.startsWith('/api/servers/') && pathname.endsWith('/stop') && req.method === 'POST') {
      const id = pathname.split('/')[3];
      pm.stop(id);
      return send(res, 200, { ok: true });
    }

    // profiles
    if (pathname === '/api/profiles' && req.method === 'GET')
      return send(res, 200, Object.values(store.getState().profiles));

    if (pathname === '/api/profiles' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const known = new Set(Object.keys(store.getState().servers));
      const validated = validateProfile(body, known);
      if (!validated.ok) return send(res, 400, { errors: validated.errors });
      await store.upsertProfile(validated.value);
      await syncProcesses();
      return send(res, 201, validated.value);
    }

    if (pathname.startsWith('/api/profiles/') && req.method === 'PUT') {
      const name = pathname.split('/').pop();
      const body = await parseJsonBody(req);
      const known = new Set(Object.keys(store.getState().servers));
      const validated = validateProfile({ ...body, name }, known);
      if (!validated.ok) return send(res, 400, { errors: validated.errors });
      await store.upsertProfile(validated.value);
      await syncProcesses();
      return send(res, 200, validated.value);
    }

    if (pathname.startsWith('/api/profiles/') && pathname.endsWith('/activate') && req.method === 'POST') {
      const name = pathname.split('/')[3];
      await store.setActiveProfile(name);
      await syncProcesses();
      return send(res, 200, { activeProfiles: store.getState().activeProfiles });
    }

    if (pathname === '/api/profiles/active' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const names = Array.isArray(body.names) ? body.names : [];
      await store.setActiveProfiles(names);
      await syncProcesses();
      return send(res, 200, { activeProfiles: store.getState().activeProfiles });
    }

    if (pathname.startsWith('/api/profiles/') && req.method === 'DELETE') {
      const name = pathname.split('/').pop();
      await store.deleteProfile(name);
      await syncProcesses();
      return send(res, 204, '');
    }

    // reload / status
    if (pathname === '/api/reload' && req.method === 'POST') {
      await syncProcesses();
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      const state = store.getState();
      return send(res, 200, {
        activeProfiles: state.activeProfiles,
        statuses: pm.status(),
        servers: state.servers
      });
    }

    // logs
    if (pathname.startsWith('/api/logs/') && req.method === 'GET') {
      const id = pathname.split('/').pop();
      const status = pm.getStatus(id);
      if (!status?.logPath) return send(res, 404, { message: 'Log not found' });
      const content = await tryReadFile(status.logPath);
      if (!content) return send(res, 404, { message: 'Log not found' });
      const lines = parseInt(url.searchParams.get('lines') || '200', 10);
      const sliced = content.toString('utf-8').split('\n').slice(-Math.max(1, Math.min(2000, lines))).join('\n');
      return send(res, 200, sliced, { 'Content-Type': 'text/plain' });
    }

    // static UI
    const baseDir = path.dirname(new URL(import.meta.url).pathname);
    const distRoot = path.join(baseDir, '..', 'ui', 'dist');
    const srcRoot = path.join(baseDir, '..', 'ui');
    const useDist = await tryReadFile(path.join(distRoot, 'index.html'));
    const uiRoot = useDist ? distRoot : srcRoot;
    const urlPath = pathname === '/' ? '/index.html' : pathname;
    let filePath = path.join(uiRoot, urlPath.replace(/^\//, ''));
    let buf = await tryReadFile(filePath);
    if (!buf && !pathname.startsWith('/api')) {
      // SPA fallback
      filePath = path.join(uiRoot, 'index.html');
      buf = await tryReadFile(filePath);
    }
    if (!buf) return send(res, 404, { message: 'Not found' });
    return send(res, 200, buf, { 'Content-Type': mimeFromPath(filePath) });
  };
};

export const createServer = async (opts = {}) => {
  const baseDir = opts.dataDir || path.join(os.homedir(), '.mcp-gateway');
  const store = new StateStore(baseDir);
  await store.init();
  const pm = new ProcessManager(path.join(baseDir, 'logs'));
  await pm.ensureLogDir();

  const syncProcesses = async () => {
    if (opts.autoStartProfiles === false) return;
    const state = store.getState();
    const activeProfiles = state.activeProfiles || [];
    const desired = new Set();
    activeProfiles.forEach((p) => {
      const profile = state.profiles[p];
      if (!profile) return;
      profile.servers
        .filter((id) => state.servers[id]?.autoStart !== false)
        .forEach((id) => desired.add(id));
    });
    const running = pm.runningIds();
    for (const id of running) if (!desired.has(id)) pm.stop(id);
    for (const id of desired) if (!running.has(id)) {
      const srv = state.servers[id];
      if (srv) pm.start(srv);
    }
  };

  const handler = buildRouter({ store, pm, syncProcesses });

  const host = opts.host ?? process.env.HOST ?? '127.0.0.1';
  const port = opts.port ?? (process.env.PORT ? Number(process.env.PORT) : undefined) ?? 8787;

  let server = null;
  let url = `http://${host}:${port}`;

  if (opts.listen !== false) {
    server = http.createServer(handler);
    await new Promise((resolve) => server.listen(port, host, resolve));
    const address = server.address();
    const resolvedPort = typeof address === 'object' && address ? address.port : port;
    url = `http://${host}:${resolvedPort}`;
  }

  const inject = async (method, target, body) => {
    const req = new PassThrough();
    req.url = target;
    req.method = method;
    req.headers = { host: 'local.test', 'content-type': 'application/json' };
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();

    let statusCode = 200;
    const headers = {};
    const chunks = [];
    let resolvePromise;
    const done = new Promise((resolve) => (resolvePromise = resolve));
    const res = {
      writeHead(code, hdrs) {
        statusCode = code;
        Object.entries(hdrs || {}).forEach(([k, v]) => (headers[k.toLowerCase()] = v));
      },
      setHeader(k, v) {
        headers[k.toLowerCase()] = v;
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        resolvePromise();
      }
    };
    handler(req, res);
    await done;
    const bodyBuf = Buffer.concat(chunks);
    const ct = headers['content-type'] || '';
    const data =
      ct.includes('application/json') && bodyBuf.length ? JSON.parse(bodyBuf.toString()) : bodyBuf.toString();
    return { statusCode, headers, data };
  };

  return { server, store, pm, url, inject, handler };
};

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  createServer().then(({ url }) => {
    console.log(`MCP Gateway running at ${url}`);
  });
}
