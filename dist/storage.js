import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
const clone = (obj) => typeof structuredClone === 'function'
    ? structuredClone(obj)
    : JSON.parse(JSON.stringify(obj));
const defaultState = () => ({
    activeProfile: null,
    servers: {},
    profiles: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
});
export class StateStore {
    statePath;
    state = null;
    flushTimer = null;
    flushQueue = Promise.resolve();
    constructor(dataDir) {
        const baseDir = dataDir ?? path.join(os.homedir(), '.mcp-gateway');
        this.statePath = path.join(baseDir, 'state.json');
    }
    async init() {
        await fs.mkdir(path.dirname(this.statePath), { recursive: true });
        try {
            const buf = await fs.readFile(this.statePath, 'utf-8');
            this.state = JSON.parse(buf);
        }
        catch {
            this.state = defaultState();
            this.state.profiles['default'] = { name: 'default', servers: [] };
            this.state.activeProfile = 'default';
            await this.flush();
        }
    }
    assertLoaded() {
        if (!this.state) {
            throw new Error('State not initialized');
        }
    }
    async flush(immediate = false) {
        this.assertLoaded();
        const write = async () => {
            this.state.updatedAt = new Date().toISOString();
            await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
        };
        if (immediate) {
            this.flushQueue = this.flushQueue.then(write);
            return this.flushQueue;
        }
        if (this.flushTimer)
            clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => {
            this.flushQueue = this.flushQueue.then(write);
        }, 300);
        return this.flushQueue;
    }
    getState() {
        this.assertLoaded();
        return clone(this.state);
    }
    listServers() {
        return Object.values(this.getState().servers);
    }
    async upsertServer(server) {
        this.assertLoaded();
        this.state.servers[server.id] = server;
        await this.flush();
    }
    async deleteServer(id) {
        this.assertLoaded();
        delete this.state.servers[id];
        Object.values(this.state.profiles).forEach((p) => {
            p.servers = p.servers.filter((s) => s !== id);
        });
        await this.flush();
    }
    listProfiles() {
        return Object.values(this.getState().profiles);
    }
    async upsertProfile(profile) {
        this.assertLoaded();
        this.state.profiles[profile.name] = profile;
        if (!this.state.activeProfile) {
            this.state.activeProfile = profile.name;
        }
        await this.flush();
    }
    async deleteProfile(name) {
        this.assertLoaded();
        delete this.state.profiles[name];
        if (this.state.activeProfile === name) {
            this.state.activeProfile = Object.keys(this.state.profiles)[0] ?? null;
        }
        await this.flush();
    }
    async setActiveProfile(name) {
        this.assertLoaded();
        if (!this.state.profiles[name]) {
            throw new Error(`Profile ${name} not found`);
        }
        this.state.activeProfile = name;
        await this.flush();
    }
}
