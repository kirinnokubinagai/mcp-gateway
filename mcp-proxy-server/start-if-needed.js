#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import { spawn } from 'child_process';

const execAsync = promisify(exec);

async function isPortInUse(port) {
  try {
    const { stdout } = await execAsync(`lsof -i :${port}`);
    return stdout.length > 0;
  } catch (error) {
    // lsof returns error if no process is using the port
    return false;
  }
}

async function main() {
  const PORT = 9999;
  
  if (await isPortInUse(PORT)) {
    console.log(`🔌 プロキシサーバーはすでにポート${PORT}で起動しています`);
    // Keep the process running so concurrently doesn't exit
    process.stdin.resume();
  } else {
    console.log(`🚀 プロキシサーバーを起動します...`);
    const child = spawn('node', ['server.js'], {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    child.on('exit', (code) => {
      process.exit(code);
    });
  }
}

main().catch(console.error);