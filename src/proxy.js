import { WebSocketServer } from 'ws';

// 1サーバー = 1プロセスを ProcessManager に任せ、ここでは既存プロセスの stdio をストリーム中継するだけにする。
export const attachMcpProxy = (httpServer, store, logDir, pm) => {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/mcp') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, url));
  });

  wss.on('connection', (ws, _req, url) => {
    const state = store.getState();
    const profileName = url.searchParams.get('profile');
    if (!profileName) {
      ws.close(1011, 'profile param is required');
      return;
    }

    const profile = state.profiles[profileName];
    const serverIds = profile?.servers || [];
    let servers = serverIds.map((id) => state.servers[id]).filter(Boolean);
    // プロファイルに登録が無い場合は全体の最初のサーバーでフォールバック
    if (!servers.length) {
      const all = Object.values(state.servers);
      if (all.length === 0) {
        ws.close(1011, 'No MCP servers configured');
        return;
      }
      servers = [all[0]];
    }

    // 接続ごとにプロファイルの順で起動を試し、最初に成功したものに接続（ProcessManager経由でログも残す）
    let child = null;
    for (const target of servers) {
      const status = pm.start(target);
      if (status && !status.error) {
        child = pm.get(target.id);
        if (child) break;
      }
    }
    if (!child) {
      ws.close(1011, 'failed to start any MCP');
      return;
    }

    // stdout/stderr をこのクライアントにストリーム
    const onStdout = (data) => ws.readyState === ws.OPEN && ws.send(data);
    const onStderr = (data) => ws.readyState === ws.OPEN && ws.send(data);
    if (child.stdout) child.stdout.on('data', onStdout);
    if (child.stderr) child.stderr.on('data', onStderr);

    // child が ready になるまでキューしてから流す
    let ready = false;
    const queue = [];
    const flush = () => {
      ready = true;
      while (queue.length) {
        const msg = queue.shift();
        try {
          child.stdin.write(msg);
        } catch (err) {
          ws.close(1011, err.message);
          break;
        }
      }
    };

    const onMessage = (msg) => {
      if (ready) {
        try {
          child.stdin.write(msg);
        } catch (err) {
          ws.close(1011, err.message);
        }
      } else {
        queue.push(msg);
      }
    };
    ws.on('message', onMessage);

    // spawn イベントで ready にする
    child.once('spawn', flush);
    // safety timeout: 3s で強制 ready（起動が早いプロセス向け）
    const readyTimeout = setTimeout(flush, 3000);

    const onExit = (code) => {
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, `Process exited with code ${code ?? 'null'}`);
      }
    };
    child.once('exit', onExit);
    child.once('error', onExit);

    ws.on('close', () => {
      if (child.stdout) child.stdout.off('data', onStdout);
      if (child.stderr) child.stderr.off('data', onStderr);
      child.off('exit', onExit);
      child.off('error', onExit);
      clearTimeout(readyTimeout);
      try {
        child.kill();
      } catch (_) {}
    });
  });

  return wss;
};
