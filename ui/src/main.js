import './style.css';

// Inject static markup (keeps Vite build simple, no framework needed)
const template = `
  <div class="header">
    <div>
      <h1>MCPゲートウェイ</h1>
      <p class="sub">ローカル専用・Docker不要・ViteバニラUI</p>
    </div>
    <span class="badge" id="active-profile">有効プロファイル: -</span>
  </div>

  <section class="grid two" style="margin-top:16px">
    <div class="card">
      <h3>サーバー</h3>
      <div class="grid">
        <label> 名前 <input id="srv-name" placeholder="github-mcp" /> </label>
        <label> コマンド <input id="srv-cmd" placeholder="npx" /> </label>
        <label> 引数（半角スペース区切り） <input id="srv-args" placeholder="@modelcontextprotocol/server-github" /> </label>
        <label> 環境変数（1行1キー: KEY=VAL）
          <textarea id="srv-env" rows="3" placeholder="GITHUB_TOKEN=xxx"></textarea>
        </label>
        <label class="inline">
          <input type="checkbox" id="srv-auto" checked />
          有効プロファイルで自動起動
        </label>
        <div class="actions">
          <button id="srv-save">保存</button>
          <button class="secondary" id="srv-clear">クリア</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>プロファイル</h3>
      <div class="grid">
        <label> 名前 <input id="prof-name" placeholder="default" /> </label>
        <div>
          <div class="label">含めるサーバー</div>
          <div id="prof-servers" class="chips"></div>
        </div>
        <div class="actions">
          <button id="prof-save">保存</button>
          <button class="secondary" id="prof-clear">クリア</button>
        </div>
      </div>
    </div>
  </section>

  <section class="grid two" style="margin-top:16px">
    <div class="card">
      <h3>サーバー一覧</h3>
      <table class="table" id="servers-table"></table>
    </div>

    <div class="card">
      <h3>プロファイル一覧</h3>
      <table class="table" id="profiles-table"></table>
      <div class="actions" style="margin-top:8px;">
        <button class="secondary" id="reload">有効プロファイル再起動</button>
        <button class="secondary" id="refresh">再読み込み</button>
      </div>
    </div>
  </section>

  <div id="toast" class="toast hidden"></div>

  <div id="log-modal" class="modal hidden">
    <div class="modal-card">
      <div class="modal-head">
        <h3 id="log-title">ログ</h3>
        <button class="secondary" id="log-close">閉じる</button>
      </div>
      <pre id="log-body"></pre>
    </div>
  </div>
`;

const appEl = document.querySelector('#app');
if (appEl) appEl.innerHTML = template;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const toast = (msg, kind = 'info') => {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden', 'error');
  if (kind === 'error') el.classList.add('error');
  setTimeout(() => el.classList.add('hidden'), 2500);
};

const api = async (path, options = {}) => {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
};

let cache = { servers: {}, profiles: {}, statuses: [] };
let editingId = null;

const parseEnv = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce((acc, line) => {
      const [k, ...v] = line.split('=');
      if (k && v.length) acc[k.trim()] = v.join('=').trim();
      return acc;
    }, {});

const toEnvText = (env) => Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n');

const loadState = async () => {
  const state = await api('/state');
  cache.servers = state.servers;
  cache.profiles = state.profiles;
  cache.statuses = state.statuses || [];
  const act = state.activeProfiles || state.activeProfile || [];
  const label = Array.isArray(act) ? act.join(', ') || '-' : act || '-';
  $('#active-profile').textContent = `有効プロファイル: ${label}`;
};

const renderServers = () => {
  const statusById = {};
  cache.statuses.forEach((s) => (statusById[s.id] = s));
  $('#servers-table').innerHTML = `
    <thead><tr><th>名前</th><th>コマンド</th><th>状態</th><th></th></tr></thead>
    <tbody>
      ${Object.values(cache.servers)
        .map(
          (s) => `
        <tr>
          <td>${s.name}</td>
          <td><code>${s.command} ${s.args.join(' ')}</code></td>
          <td>${statusById[s.id]?.status ?? 'idle'}</td>
          <td>
            <div class="actions">
              <button class="secondary" data-action="edit" data-id="${s.id}">編集</button>
              <button class="secondary" data-action="start" data-id="${s.id}">起動</button>
              <button class="secondary" data-action="stop" data-id="${s.id}">停止</button>
              <button class="secondary" data-action="logs" data-id="${s.id}">ログ</button>
              <button class="secondary" data-action="delete" data-id="${s.id}">削除</button>
            </div>
          </td>
        </tr>`
        )
        .join('')}
    </tbody>
  `;
};

const renderProfiles = () => {
  const profiles = Object.values(cache.profiles);
  $('#profiles-table').innerHTML = `
    <thead><tr><th>名前</th><th>サーバー数</th><th></th></tr></thead>
    <tbody>
      ${profiles
        .map(
          (p) => `
        <tr>
          <td>${p.name}</td>
          <td>${p.servers.length}</td>
          <td>
            <div class="actions">
              <button class="secondary" data-action="activate-profile" data-name="${p.name}">有効化</button>
              <button class="secondary" data-action="edit-profile" data-name="${p.name}">編集</button>
              <button class="secondary" data-action="delete-profile" data-name="${p.name}">削除</button>
            </div>
          </td>
        </tr>`
        )
        .join('')}
    </tbody>
  `;

  $('#prof-servers').innerHTML = Object.values(cache.servers)
    .map(
      (s) => `
    <label class="chip">
      <input type="checkbox" data-chip="${s.id}" />
      ${s.name}
    </label>`
    )
    .join('');
};

const fillServerForm = (srv = {}) => {
  editingId = srv.id || null;
  $('#srv-name').value = srv.name || '';
  $('#srv-cmd').value = srv.command || '';
  $('#srv-args').value = srv.args ? srv.args.join(' ') : '';
  $('#srv-env').value = toEnvText(srv.env || {});
  $('#srv-auto').checked = srv.autoStart ?? true;
};

const fillProfileForm = (prof = {}) => {
  $('#prof-name').value = prof.name || '';
  $$('#prof-servers [data-chip]').forEach((c) => {
    c.checked = prof.servers ? prof.servers.includes(c.dataset.chip) : false;
  });
};

const collectProfileServers = () =>
  $$('#prof-servers [data-chip]')
    .filter((c) => c.checked)
    .map((c) => c.dataset.chip);

const refresh = async () => {
  await loadState();
  renderServers();
  renderProfiles();
};

// Event handlers
$('#srv-save').onclick = async () => {
  try {
    const payload = {
      name: $('#srv-name').value.trim(),
      command: $('#srv-cmd').value.trim(),
      args: $('#srv-args').value.trim().split(' ').filter(Boolean),
      env: parseEnv($('#srv-env').value),
      autoStart: $('#srv-auto').checked
    };
    if (!payload.name || !payload.command) throw new Error('名前とコマンドは必須です');
    if (editingId) await api(`/servers/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/servers', { method: 'POST', body: JSON.stringify(payload) });
    fillServerForm();
    await refresh();
    toast('サーバーを保存しました');
  } catch (e) {
    toast(e.message || '保存に失敗しました', 'error');
  }
};
$('#srv-clear').onclick = () => fillServerForm();

$('#prof-save').onclick = async () => {
  try {
    const name = $('#prof-name').value.trim();
    if (!name) throw new Error('プロファイル名は必須です');
    const payload = { name, servers: collectProfileServers() };
    const exists = cache.profiles[name];
    await api(`/profiles${exists ? '/' + name : ''}`, {
      method: exists ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    fillProfileForm();
    await refresh();
    toast('プロファイルを保存しました');
  } catch (e) {
    toast(e.message || '保存に失敗しました', 'error');
  }
};
$('#prof-clear').onclick = () => fillProfileForm();
$('#refresh').onclick = refresh;
$('#reload').onclick = async () => {
  await api('/reload', { method: 'POST' });
  await refresh();
  toast('有効プロファイルを再起動しました');
};

$('#servers-table').onclick = async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  try {
    if (action === 'edit') fillServerForm(cache.servers[id]);
    if (action === 'delete') {
      await api(`/servers/${id}`, { method: 'DELETE' });
      await refresh();
    }
    if (action === 'start') {
      await api(`/servers/${id}/start`, { method: 'POST' });
      await refresh();
    }
    if (action === 'stop') {
      await api(`/servers/${id}/stop`, { method: 'POST' });
      await refresh();
    }
    if (action === 'logs') {
      const text = await api(`/logs/${id}`);
      $('#log-title').textContent = `ログ: ${id}`;
      $('#log-body').textContent = text && text.trim().length ? text : '(ログはまだありません)';
      $('#log-modal').classList.remove('hidden');
    }
  } catch (err) {
    toast(err.message || '失敗しました', 'error');
  }
};

$('#profiles-table').onclick = async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const name = btn.dataset.name;
  const action = btn.dataset.action;
  try {
    if (action === 'activate-profile') {
      await api(`/profiles/${name}/activate`, { method: 'POST' });
      await refresh();
    }
    if (action === 'edit-profile') fillProfileForm(cache.profiles[name]);
    if (action === 'delete-profile') {
      await api(`/profiles/${name}`, { method: 'DELETE' });
      await refresh();
    }
  } catch (err) {
    toast(err.message || '失敗しました', 'error');
  }
};

$('#log-close').onclick = () => $('#log-modal').classList.add('hidden');
// モーダル背景クリックでも閉じる
$('#log-modal').addEventListener('click', (e) => {
  if (e.target.id === 'log-modal') $('#log-modal').classList.add('hidden');
});

refresh().catch((e) => toast(e.message || '読み込みに失敗しました', 'error'));
