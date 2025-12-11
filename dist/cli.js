#!/usr/bin/env node
import { createServer } from './server.js';
function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const val = argv[i];
        if (val.startsWith('--')) {
            const [key, maybe] = val.slice(2).split('=');
            args[key] = maybe ?? true;
        }
    }
    return args;
}
async function main() {
    const args = parseArgs(process.argv);
    const port = args.port ? Number(args.port) : undefined;
    const host = args.host || undefined;
    const dataDir = args['data-dir'] || undefined;
    const noOpen = args['no-open'] === true;
    const { url } = await createServer({ host, port, dataDir, openBrowser: !noOpen });
    console.log(`MCP Gateway running at ${url}`);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
