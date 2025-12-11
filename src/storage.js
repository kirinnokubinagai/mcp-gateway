import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const clone = (v) => JSON.parse(JSON.stringify(v));

const defaultState = () => ({
  activeProfiles: ['default'],
  servers: {},
  profiles: {
    default: { name: 'default', servers: [] }
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

export class StateStore {
  constructor(baseDir) {
    const dir = baseDir || path.join(os.homedir(), '.mcp-gateway');
    this.statePath = path.join(dir, 'state.json');
    this.state = null;
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    try {
      const buf = await fs.readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(buf);
      // マイグレーション: activeProfile -> activeProfiles
      if (this.state.activeProfile && !this.state.activeProfiles) {
        this.state.activeProfiles = [this.state.activeProfile].filter(Boolean);
        delete this.state.activeProfile;
      }
      if (!this.state.activeProfiles) this.state.activeProfiles = ['default'];
    } catch {
      this.state = defaultState();
      await this.flush(true);
    }
  }

  async flush(immediate = false) {
    const write = async () => {
      this.state.updatedAt = new Date().toISOString();
      await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
    };
    if (immediate) {
      this.queue = this.queue.then(write);
      return this.queue;
    }
    this.queue = this.queue.then(async () => {
      await new Promise((res) => setTimeout(res, 200));
      await write();
    });
    return this.queue;
  }

  getState() {
    if (!this.state) throw new Error('State not loaded');
    return clone(this.state);
  }

  async upsertServer(server) {
    this.state.servers[server.id] = server;
    // default プロファイルが存在しサーバー未登録なら自動で追加
    if (this.state.profiles.default && this.state.profiles.default.servers.length === 0) {
      this.state.profiles.default.servers.push(server.id);
    }
    await this.flush();
  }

  async deleteServer(id) {
    delete this.state.servers[id];
    Object.values(this.state.profiles).forEach((p) => {
      p.servers = p.servers.filter((s) => s !== id);
    });
    await this.flush();
  }

  async upsertProfile(profile) {
    this.state.profiles[profile.name] = {
      name: profile.name,
      servers: profile.servers || []
    };
    // すべてのプロファイルを常に有効にする
    this.state.activeProfiles = Object.keys(this.state.profiles);
    await this.flush();
  }

  async deleteProfile(name) {
    delete this.state.profiles[name];
    this.state.activeProfiles = Object.keys(this.state.profiles);
    await this.flush();
  }

  async setActiveProfiles(names) {
    const valid = names.filter((n) => this.state.profiles[n]);
    if (valid.length === 0) throw new Error('No valid profile provided');
    this.state.activeProfiles = Array.from(new Set(valid));
    await this.flush();
  }

  async setActiveProfile(name) {
    return this.setActiveProfiles([name]);
  }
}
