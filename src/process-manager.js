import { spawn } from 'child_process';
import { promises as fs, createWriteStream } from 'fs';
import path from 'path';

export class ProcessManager {
  constructor(logDir) {
    this.logDir = logDir;
    this.processes = new Map();
    this.statuses = new Map();
  }

  async ensureLogDir() {
    await fs.mkdir(this.logDir, { recursive: true });
  }

  async rotateLogIfNeeded(logPath, maxBytes = 5 * 1024 * 1024) {
    try {
      const stat = await fs.stat(logPath).catch(() => null);
      if (stat && stat.size > maxBytes) {
        const rotated = `${logPath}.${Date.now()}`;
        await fs.rename(logPath, rotated).catch(() => {});
      }
    } catch (_) {
      // ローテーション失敗は致命ではないので握りつぶす
    }
  }

  start(server) {
    // ログディレクトリを確保
    this.ensureLogDir().catch(() => {});
    // 既に走っていればそのまま返す
    const existing = this.processes.get(server.id);
    if (existing && existing.status.status === 'running') return existing.status;

    this.stop(server.id);
    const logPath = path.join(this.logDir, `${server.id}.log`);
    this.rotateLogIfNeeded(logPath).catch(() => {});
    const logStream = createWriteStream(logPath, { flags: 'a' });
    logStream.write(`[${new Date().toISOString()}] start ${server.command} ${server.args?.join(' ') || ''}\n`);

    let proc;
    try {
      proc = spawn(server.command, server.args || [], {
        env: {
          ...process.env,
          // npx 起動を高速化/静音化するオプション
          npm_config_yes: 'true',
          npm_config_audit: 'false',
          npm_config_fund: 'false',
          ...server.env
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      const errLine = `[${new Date().toISOString()}] ${server.id} spawn failed: ${error.message}\n`;
      fs.appendFile(path.join(this.logDir, 'spawn-errors.log'), errLine).catch(() => {});
      const failed = {
        id: server.id,
        status: 'failed',
        lastError: error.message,
        startedAt: Date.now(),
        logPath
      };
      this.statuses.set(server.id, failed);
      return failed;
    }

    if (proc.stdout) proc.stdout.pipe(logStream, { end: false });
    if (proc.stderr) proc.stderr.pipe(logStream, { end: false });

    const status = {
      id: server.id,
      pid: proc.pid,
      status: 'running',
      startedAt: Date.now(),
      logPath
    };

    this.processes.set(server.id, { proc, status });
    this.statuses.set(server.id, status);

    proc.on('exit', (code) => {
      status.status = code === 0 ? 'stopped' : 'failed';
      status.exitCode = code;
      status.stoppedAt = Date.now();
      this.statuses.set(server.id, status);
    });

    proc.on('error', (err) => {
      status.status = 'failed';
      status.lastError = err.message;
      status.stoppedAt = Date.now();
      this.statuses.set(server.id, status);
      try {
        logStream.write(`[${new Date().toISOString()}] error ${err.message}\n`);
      } catch (_) {}
    });

    proc.on('close', (code, signal) => {
      try {
        logStream.write(`[${new Date().toISOString()}] close code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
        logStream.end();
      } catch (_) {}
    });

    return status;
  }

  stop(id) {
    const entry = this.processes.get(id);
    if (!entry) return;
    entry.proc.kill();
    entry.status.status = 'stopped';
    entry.status.stoppedAt = Date.now();
    this.statuses.set(id, entry.status);
    this.processes.delete(id);
  }

  stopAll() {
    for (const id of this.processes.keys()) this.stop(id);
  }

  runningIds() {
    return new Set(this.processes.keys());
  }

  status() {
    return Array.from(this.statuses.values());
  }

  getStatus(id) {
    return this.statuses.get(id);
  }

  get(id) {
    const entry = this.processes.get(id);
    return entry?.proc;
  }
}
