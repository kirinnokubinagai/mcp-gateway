#!/usr/bin/env node
import { createServer } from './server.js';

const parseArgs = () => {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      args[k] = v ?? true;
    }
  });
  return args;
};

const main = async () => {
  const args = parseArgs();
  const host = args.host || process.env.HOST || '127.0.0.1';
  const port = args.port ? Number(args.port) : (process.env.PORT ? Number(process.env.PORT) : 8787);
  const dataDir = args['data-dir'];
  const { url } = await createServer({ host, port, dataDir });
  console.log(`MCP Gateway running at ${url}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
