import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Copy } from "lucide-react";

type Server = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  autoStart: boolean;
};

type Profile = {
  name: string;
  servers: string[];
  };

const api = async (path: string, options: RequestInit = {}) => {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
};

const parseEnv = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const [k, ...v] = line.split("=");
      if (k && v.length) acc[k.trim()] = v.join("=").trim();
      return acc;
    }, {});

const toEnvText = (env: Record<string, string>) => Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join("\n");

export default function App() {
  const [servers, setServers] = useState<Record<string, Server>>({});
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [activeProfiles, setActiveProfiles] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [toast, setToast] = useState<{ msg: string; kind?: "error" } | null>(null);
  const [view, setView] = useState<"overview" | "servers" | "profiles" | "guide">("overview");

  const [srvForm, setSrvForm] = useState({
    id: "",
    name: "",
    command: "",
    args: "",
    env: "",
    autoStart: true
  });

  const [profForm, setProfForm] = useState({ name: "", servers: [] as string[],  });

  const serverList = useMemo(() => Object.values(servers), [servers]);
  const profileList = useMemo(() => Object.values(profiles), [profiles]);

  const load = async () => {
    const state = await api("/state");
    setServers(state.servers || {});
    setProfiles(state.profiles || {});
    setActiveProfiles(state.activeProfiles || []);
    setStatuses(state.statuses || []);
  };

  useEffect(() => {
    load().catch((e) => showToast(e.message, true));
  }, []);

  const statusById = useMemo(() => {
    const m: Record<string, any> = {};
    statuses.forEach((s) => (m[s.id] = s));
    return m;
  }, [statuses]);

  const showToast = (msg: string, error = false) => {
    setToast({ msg, kind: error ? "error" : undefined });
    setTimeout(() => setToast(null), 2200);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("コピーしました");
    } catch {
      showToast("コピーに失敗しました", true);
    }
  };

  const saveServer = async () => {
    if (!srvForm.name.trim() || !srvForm.command.trim()) return showToast("名前とコマンドは必須です", true);
    const payload = {
      name: srvForm.name.trim(),
      command: srvForm.command.trim(),
      args: srvForm.args.trim().split(" ").filter(Boolean),
      env: parseEnv(srvForm.env),
      autoStart: srvForm.autoStart
    };
    const path = srvForm.id ? `/servers/${srvForm.id}` : "/servers";
    const method = srvForm.id ? "PUT" : "POST";
    await api(path, { method, body: JSON.stringify(payload) });
    setSrvForm({ id: "", name: "", command: "", args: "", env: "", autoStart: true });
    await load();
    showToast("サーバーを保存しました");
  };

  const editServer = (s: Server) =>
    setSrvForm({
      id: s.id,
      name: s.name,
      command: s.command,
      args: s.args.join(" "),
      env: toEnvText(s.env),
      autoStart: s.autoStart
    });

  const saveProfile = async () => {
    if (!profForm.name.trim()) return showToast("プロファイル名は必須です", true);
    const exists = Boolean(profiles[profForm.name]);
    const path = exists ? `/profiles/${profForm.name}` : "/profiles";
    const method = exists ? "PUT" : "POST";
    await api(path, {
      method,
      body: JSON.stringify({
        ...profForm,
        
      })
    });
    setProfForm({ name: "", servers: [],  });
    await load();
    showToast("プロファイルを保存しました");
  };

  const profileUrl = (name: string) => `ws://${location.host}/mcp?profile=${name}`;

  const emptyRow = (msg: string, span = 4) => (
    <TR>
      <TD colSpan={span} className="text-center text-slate-500 text-sm py-6">
        {msg}
      </TD>
    </TR>
  );

  return (
    <div className="min-h-screen max-w-6xl mx-auto p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">MCP Gateway</h1>
          <p className="text-sm text-slate-600">ローカル専用 / Docker なし。プロファイル単位で MCP サーバーを束ねて配信します。</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="outline">アクティブ: {activeProfiles.join(", ") || "なし"}</Badge>
          <Badge variant="outline">サーバー {serverList.length} 件</Badge>
          <Button variant="secondary" size="sm" onClick={load}>再読み込み</Button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2">
        {[
          ["overview", "使い方"],
          ["servers", "サーバー管理"],
          ["profiles", "プロファイル管理"],
          ["guide", "FAQ"]
        ].map(([v, label]) => (
          <Button
            key={v}
            variant={view === v ? "default" : "outline"}
            onClick={() => setView(v as any)}
            size="sm"
          >
            {label}
          </Button>
        ))}
      </nav>

      {view === "overview" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-600 uppercase">接続URL（プロファイル必須）</div>
                <div className="flex items-center gap-2">
                  <Input readOnly value={`ws://${location.host}/mcp?profile=default`} />
                  <Button variant="outline" size="icon" onClick={() => copy(`ws://${location.host}/mcp?profile=default`)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-slate-500">serverId 接続は無効化しています。必ず profile を指定してください。</p>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-600 uppercase">Claude 追加例</div>
                <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded-md overflow-x-auto">
claude mcp add mcp-gateway --url ws://{location.host}/mcp?profile=default
                </pre>
                <p className="text-xs text-slate-500">プロファイル名を差し替えるだけで複数エージェントから共用できます。</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>使い方（シンプル）</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <div>1. サーバー登録（コマンド・引数・環境変数を入力）</div>
              <div>2. プロファイルにサーバーを追加</div>
              <div>3. クライアントで <code>?profile=名前</code> を指定して接続</div>
              <div className="text-xs text-slate-500">サンプル投入: <code>pnpm init:samples</code>（上書きは <code>--force</code>）。</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>トラブル時</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1 text-slate-700">
              <div>・ポート競合なら <code>PORT=9001 pnpm start</code></div>
              <div>・接続できない場合、URL の <code>profile</code> を再確認</div>
              <div>・環境変数は 1 行 1 つで入力</div>
            </CardContent>
          </Card>
        </div>
      )}

      {view === "servers" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>サーバー登録 / 編集</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="名前 (例: github-mcp)" value={srvForm.name} onChange={(e) => setSrvForm({ ...srvForm, name: e.target.value })} />
              <Input placeholder="コマンド (例: npx)" value={srvForm.command} onChange={(e) => setSrvForm({ ...srvForm, command: e.target.value })} />
              <Input
                placeholder="引数 (例: @modelcontextprotocol/server-github --port 9000)"
                value={srvForm.args}
                onChange={(e) => setSrvForm({ ...srvForm, args: e.target.value })}
              />
              <Textarea
                placeholder="環境変数 (1行1つ: KEY=VALUE)"
                rows={3}
                value={srvForm.env}
                onChange={(e) => setSrvForm({ ...srvForm, env: e.target.value })}
              />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={srvForm.autoStart}
                  onChange={(e) => setSrvForm({ ...srvForm, autoStart: e.target.checked })}
                />
                プロファイル有効時に自動起動
              </label>
              <div className="flex gap-2">
                <Button onClick={saveServer}>保存</Button>
                <Button variant="secondary" onClick={() => setSrvForm({ id: "", name: "", command: "", args: "", env: "", autoStart: true })}>
                  クリア
                </Button>
              </div>
              <p className="text-xs text-slate-500">1 サーバー = 1 MCP プロセス。コマンドはローカルに存在するものを指定してください。</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>サーバー一覧</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <THead>
                  <TR>
                    <TH>名前</TH>
                    <TH>コマンド</TH>
                    <TH>状態</TH>
                    <TH>操作</TH>
                  </TR>
                </THead>
                <TBody>
                  {serverList.length === 0 && emptyRow("登録済みサーバーがありません", 4)}
                  {serverList.map((s) => (
                    <TR key={s.id}>
                      <TD>{s.name}</TD>
                      <TD className="text-xs text-slate-600">{s.command} {s.args.join(" ")}</TD>
                      <TD>
                        <Badge variant={statusById[s.id]?.status === "running" ? "default" : "outline"}>
                          {statusById[s.id]?.status ?? "idle"}
                        </Badge>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="secondary" size="sm" onClick={() => editServer(s)}>編集</Button>
                          <Button variant="secondary" size="sm" onClick={() => api(`/servers/${s.id}/start`, { method: "POST" }).then(load)}>起動</Button>
                          <Button variant="secondary" size="sm" onClick={() => api(`/servers/${s.id}/stop`, { method: "POST" }).then(load)}>停止</Button>
                          <Button variant="secondary" size="sm" onClick={() => api(`/servers/${s.id}`, { method: "DELETE" }).then(load)}>削除</Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {view === "profiles" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>プロファイル作成 / 編集</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="名前 (例: default, claude)" value={profForm.name} onChange={(e) => setProfForm({ ...profForm, name: e.target.value })} />
            <div className="space-y-2">
              <div className="text-sm text-slate-700">含めるサーバー（複数選択可）</div>
              <div className="flex flex-wrap gap-2">
                {serverList.length === 0 && <span className="text-xs text-slate-500">先にサーバーを登録してください。</span>}
                {serverList.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm border rounded-md px-2 py-1 bg-white shadow-sm">
                    <input
                      type="checkbox"
                      checked={profForm.servers.includes(s.id)}
                      onChange={(e) => {
                        const set = new Set(profForm.servers);
                        e.target.checked ? set.add(s.id) : set.delete(s.id);
                        // primaryが外れたらリセット
                        setProfForm({ ...profForm, servers: Array.from(set) });
                      }}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
              <div className="flex gap-2">
                <Button onClick={saveProfile}>保存</Button>
                <Button variant="secondary" onClick={() => setProfForm({ name: "", servers: [] })}>
                  クリア
                </Button>
              </div>
              <p className="text-xs text-slate-500">プロファイル名で接続先を切り替えるだけで、複数エージェントから共用可能。</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>プロファイル一覧</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <THead>
                  <TR>
                    <TH>名前</TH>
                    <TH>サーバー数</TH>
                    <TH>接続URL（profile）</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {profileList.length === 0 && emptyRow("プロファイルがありません", 4)}
                  {profileList.map((p) => (
                    <TR key={p.name}>
                      <TD>{p.name}</TD>
                      <TD>{p.servers.length}</TD>
                      <TD className="text-[11px] text-slate-600 break-all">
                      {profileUrl(p.name)}
                      {p.servers.length ? (
                        <Button variant="ghost" size="icon" className="ml-1" onClick={() => copy(profileUrl(p.name))}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      ) : null}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="secondary" size="sm" onClick={() => setProfForm({ name: p.name, servers: p.servers })}>編集</Button>
                          <Button variant="secondary" size="sm" onClick={() => api(`/profiles/${p.name}`, { method: "DELETE" }).then(load)}>削除</Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="text-xs text-slate-500">例: Claude に default、別エージェントに dev を割り当てて同時利用。</div>
            </CardContent>
          </Card>
        </div>
      )}

      {view === "guide" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>クイックスタート</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-700">
              <div>1. `pnpm install` → `pnpm build:ui` → `pnpm start`（必要なら `PORT=9001`）。</div>
              <div>2. UI でサーバー登録 → プロファイルに紐づけ。</div>
              <div>3. クライアント追加例: <code>claude mcp add mcp-gateway --url ws://127.0.0.1:8787/mcp?profile=default</code></div>
              <div>4. 別プロファイルを作れば複数エージェントから同時利用可能。</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>よくある質問</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-700">
              <div><b>Q. ログ画面は？</b> 必要最低限にし、常時ログ表示は省きました。実行ログはコンソール出力を確認してください。</div>
              <div><b>Q. サンプル登録は？</b> `pnpm init:samples` を実行すると GitHub MCP(9000) と fs MCP(9001) を追加します。</div>
              <div><b>Q. プロセスが残る？</b> サーバー削除時に停止を実行。ポート競合は環境変数 `PORT` で回避できます。</div>
              <div><b>Q. serverId 接続は？</b> 無効化しました。必ず profile を指定してください。</div>
            </CardContent>
          </Card>
        </div>
      )}

      {toast && (
        <div className={`fixed right-4 top-4 rounded-md px-3 py-2 text-sm shadow ${toast.kind === "error" ? "bg-rose-100 text-rose-800" : "bg-sky-100 text-sky-900"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
