import { spawn } from 'child_process';
import { createWriteStream, promises as fs } from 'fs';
import path from 'path';
export class ProcessManager {
    processes = new Map();
    logDir;
    statuses = new Map();
    constructor(logDir) {
        this.logDir = logDir;
    }
    start(server) {
        this.stop(server.id);
        const logPath = path.join(this.logDir, `${server.id}.log`);
        fs.mkdir(this.logDir, { recursive: true }).catch(() => { });
        const logStream = createWriteStream(logPath, { flags: 'a' });
        const proc = spawn(server.command, server.args, {
            env: { ...process.env, ...server.env },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const status = {
            id: server.id,
            pid: proc.pid ?? null,
            status: 'running',
            startedAt: Date.now(),
            logPath
        };
        const managed = { server, proc, status };
        this.processes.set(server.id, managed);
        this.statuses.set(server.id, status);
        if (proc.stdout)
            proc.stdout.pipe(logStream, { end: false });
        if (proc.stderr)
            proc.stderr.pipe(logStream, { end: false });
        proc.on('exit', (code) => {
            managed.status.status = code === 0 ? 'stopped' : 'failed';
            managed.status.exitCode = code ?? undefined;
            managed.status.stoppedAt = Date.now();
            if (code !== 0) {
                managed.status.status = 'failed';
                managed.status.lastError = `Exited with code ${code}`;
            }
            this.statuses.set(server.id, managed.status);
        });
        proc.on('error', (err) => {
            managed.status.status = 'failed';
            managed.status.lastError = err.message;
            managed.status.stoppedAt = Date.now();
            this.statuses.set(server.id, managed.status);
        });
        return status;
    }
    stop(id) {
        const entry = this.processes.get(id);
        if (!entry)
            return;
        entry.proc.kill();
        entry.status.status = 'stopped';
        entry.status.stoppedAt = Date.now();
        this.statuses.set(id, entry.status);
        this.processes.delete(id);
    }
    stopAll() {
        for (const id of this.processes.keys()) {
            this.stop(id);
        }
    }
    status() {
        return Array.from(this.statuses.values());
    }
    runningIds() {
        return new Set(this.processes.keys());
    }
    getStatus(id) {
        return this.statuses.get(id);
    }
}
