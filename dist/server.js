import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import open from 'open';
import { StateStore } from './storage.js';
import { ProcessManager } from './process-manager.js';
import { profileSchema, serverSchema } from './schema.js';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export async function createServer(opts = {}) {
    const app = Fastify({ logger: false });
    app.register(fastifyCors, { origin: '*' });
    const baseDir = opts.dataDir ?? path.join(os.homedir(), '.mcp-gateway');
    const store = new StateStore(baseDir);
    await store.init();
    const logDir = path.join(baseDir, 'logs');
    await fs.mkdir(logDir, { recursive: true });
    const pm = new ProcessManager(logDir);
    const syncProcesses = () => {
        const state = store.getState();
        if (!state.activeProfile)
            return;
        const profile = state.profiles[state.activeProfile];
        if (!profile)
            return;
        const desired = new Set(profile.servers
            .map((id) => state.servers[id])
            .filter((s) => Boolean(s && s.autoStart))
            .map((s) => s.id));
        const running = pm.runningIds();
        // stop ones no longer desired
        for (const id of running) {
            if (!desired.has(id))
                pm.stop(id);
        }
        // start missing desired
        for (const id of desired) {
            if (!running.has(id)) {
                const srv = state.servers[id];
                if (srv)
                    pm.start(srv);
            }
        }
    };
    // Initial boot
    syncProcesses();
    app.get('/api/health', async () => ({ ok: true }));
    app.get('/api/state', async () => store.getState());
    app.get('/api/servers', async () => store.listServers());
    app.post('/api/servers', async (req, reply) => {
        const parsed = serverSchema.parse(req.body);
        const server = {
            ...parsed,
            id: parsed.id ?? nanoid(8)
        };
        await store.upsertServer(server);
        syncProcesses();
        return reply.code(201).send(server);
    });
    app.put('/api/servers/:id', async (req, reply) => {
        const id = req.params.id;
        const parsed = serverSchema.parse(req.body);
        const server = { ...parsed, id };
        await store.upsertServer(server);
        syncProcesses();
        return reply.send(server);
    });
    app.post('/api/servers/:id/start', async (req, reply) => {
        const id = req.params.id;
        const state = store.getState();
        const server = state.servers[id];
        if (!server)
            return reply.code(404).send({ message: 'Server not found' });
        const status = pm.start(server);
        return reply.send(status);
    });
    app.post('/api/servers/:id/stop', async (req, reply) => {
        const id = req.params.id;
        pm.stop(id);
        return reply.send({ ok: true });
    });
    app.delete('/api/servers/:id', async (req, reply) => {
        const id = req.params.id;
        await store.deleteServer(id);
        syncProcesses();
        return reply.code(204).send();
    });
    app.get('/api/profiles', async () => store.listProfiles());
    app.post('/api/profiles', async (req, reply) => {
        const parsed = profileSchema.parse(req.body);
        await store.upsertProfile(parsed);
        syncProcesses();
        return reply.code(201).send(parsed);
    });
    app.put('/api/profiles/:name', async (req, reply) => {
        const name = req.params.name;
        const parsed = profileSchema.parse(req.body);
        await store.upsertProfile({ ...parsed, name });
        syncProcesses();
        return reply.send(parsed);
    });
    app.delete('/api/profiles/:name', async (req, reply) => {
        const name = req.params.name;
        await store.deleteProfile(name);
        syncProcesses();
        return reply.code(204).send();
    });
    app.post('/api/profiles/:name/activate', async (req, reply) => {
        const name = req.params.name;
        await store.setActiveProfile(name);
        syncProcesses();
        return reply.send({ activeProfile: name });
    });
    app.post('/api/reload', async () => {
        syncProcesses();
        return { ok: true };
    });
    app.get('/api/status', async () => {
        const state = store.getState();
        return {
            activeProfile: state.activeProfile,
            statuses: pm.status(),
            servers: state.servers
        };
    });
    app.get('/api/logs/:id', async (req, reply) => {
        const id = req.params.id;
        const status = pm.getStatus(id);
        if (!status?.logPath || !existsSync(status.logPath)) {
            return reply.code(404).send({ message: 'Log not found' });
        }
        const linesParam = Number(req.query?.lines ?? 200);
        const lines = Number.isFinite(linesParam) ? Math.max(1, Math.min(2000, linesParam)) : 200;
        const content = await fs.readFile(status.logPath, 'utf-8');
        const sliced = content.split('\n').slice(-lines).join('\n');
        reply.header('Content-Type', 'text/plain');
        return sliced;
    });
    // Static UI (built assets)
    const uiDist = path.join(__dirname, '..', 'ui', 'dist');
    if (existsSync(uiDist)) {
        app.register(fastifyStatic, {
            root: uiDist,
            prefix: '/'
        });
        app.setNotFoundHandler(async (req, reply) => {
            if (req.raw.url && !req.raw.url.startsWith('/api') && !req.raw.url.startsWith('/__vite')) {
                return reply.sendFile('index.html');
            }
            reply.status(404).send({ message: 'Not found' });
        });
    }
    else {
        app.get('/', async () => ({
            message: 'UI not built yet. Run `npm run build:ui` and restart.'
        }));
    }
    const host = opts.host ?? '127.0.0.1';
    const port = opts.port ?? 8787;
    await app.listen({ port, host });
    const address = app.server.address();
    const resolvedPort = typeof address === 'object' && address ? address.port : port;
    const url = `http://${host}:${resolvedPort}`;
    if (opts.openBrowser) {
        void open(url);
    }
    return { app, store, pm, url };
}
if (process.env.NODE_ENV !== 'test' && process.argv[1] === fileURLToPath(import.meta.url)) {
    createServer().catch((err) => {
        console.error('Failed to start server', err);
        process.exit(1);
    });
}
