import { GripVertical, Plus, Save, Settings, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import './App.css';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Switch } from './components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Textarea } from './components/ui/textarea';

interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface NewServerState {
  name: string;
  command: string;
  args: string;
  env: string;
  enabled: boolean;
  profilesState?: Record<string, boolean>;
}

interface ServerStatus {
  status: 'connected' | 'error' | 'disabled' | 'updating';
  toolCount: number;
  error?: string;
}

function App() {
  const [servers, setServers] = useState<Record<string, ServerConfig>>({});
  const [serverStatus, setServerStatus] = useState<Record<string, ServerStatus>>({});
  const [isAddServerOpen, setIsAddServerOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [toolsDialogOpen, setToolsDialogOpen] = useState<string | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, any[]>>({});
  const [newServer, setNewServer] = useState<NewServerState>({
    name: '',
    command: '',
    args: '',
    env: '',
    enabled: true,
  });
  const [draggedServer, setDraggedServer] = useState<string | null>(null);
  const [dragOverServer, setDragOverServer] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Record<string, boolean>>>({});
  const [profileDescriptions, setProfileDescriptions] = useState<Record<string, string>>({});
  const [profileDisplayNames, setProfileDisplayNames] = useState<Record<string, string>>({});
  const [activeProfile, setActiveProfile] = useState<string>('default');
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [tempProfileServers, setTempProfileServers] = useState<Record<string, boolean>>({});
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileId, setNewProfileId] = useState('');
  const [newProfileDescription, setNewProfileDescription] = useState('');
  const [editedProfiles, setEditedProfiles] = useState<
    Record<string, { displayName: string; description: string }>
  >({});
  const [hasChanges, setHasChanges] = useState(false);

  // プロファイル名の表示名を統一管理
  const getProfileDisplayName = (profile: string) => {
    // カスタム表示名が設定されている場合はそれを使用
    if (profileDisplayNames[profile]) {
      return profileDisplayNames[profile];
    }
    // defaultプロファイルは空文字
    if (profile === 'default') {
      return '';
    }
    // それ以外はプロファイルIDをそのまま表示
    return profile;
  };

  // APIのベースURLを取得
  const getApiBaseUrl = () => {
    // 常にプロキシ経由でアクセス（Viteの設定で /api/* がプロキシされる）
    return '';
  };

  useEffect(() => {
    // 初期データ読み込み
    fetchConfig();
    fetchProfiles();

    // 定期的にステータスを更新
    const interval = setInterval(() => {
      fetchStatus();
    }, 5000); // 5秒ごとに更新

    return () => {
      clearInterval(interval);
    };
  }, []);

  const fetchConfig = async () => {
    try {
      // 設定を取得
      const configResponse = await fetch(`${getApiBaseUrl()}/api/servers`);
      if (!configResponse.ok) {
        console.error('設定の取得に失敗しました:', configResponse.status);
        return;
      }
      const configData = await configResponse.json();
      if (typeof configData !== 'object' || configData === null) {
        console.error('無効な設定データ:', configData);
        return;
      }
      setServers(configData);

      // ステータスを取得
      fetchStatus();
    } catch (error) {
      console.error('設定の取得に失敗しました:', error);
    }
  };

  const fetchStatus = async () => {
    try {
      const statusResponse = await fetch(`${getApiBaseUrl()}/api/status`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        setServerStatus(statusData);
      } else {
        console.error('ステータスの取得に失敗しました:', statusResponse.status);
      }
    } catch (error) {
      console.error('ステータスの取得に失敗しました:', error);
    }
  };

  const fetchProfiles = async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/profiles`);
      const data = await response.json();
      setProfiles(data.profiles || {});
      setProfileDescriptions(data.profileDescriptions || {});
      setProfileDisplayNames(data.profileDisplayNames || {});
      setActiveProfile(data.activeProfile || 'default');
    } catch (error) {
      console.error('プロファイルの取得に失敗しました:', error);
    }
  };

  const handleProfileChange = async (profile: string) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/profiles/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });

      if (response.ok) {
        setActiveProfile(profile);
        // UIのみ更新するため、サーバー状態は変更しない
      }
    } catch (error) {
      console.error('プロファイル変更エラー:', error);
    }
  };

  const handleSaveProfile = async (profileName: string) => {
    try {
      // 現在のサーバー状態をプロファイルとして保存
      const profileConfig: Record<string, boolean> = {};

      Object.keys(servers).forEach((serverName) => {
        profileConfig[serverName] = servers[serverName].enabled;
      });

      const response = await fetch(`${getApiBaseUrl()}/api/profiles/${profileName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: profileConfig }),
      });

      if (response.ok) {
        await fetchProfiles();
        setProfileDialogOpen(false);
        setEditingProfile(null);
      }
    } catch (error) {
      console.error('プロファイル保存エラー:', error);
    }
  };

  const handleUpdateProfile = async (
    profileName: string,
    profileConfig: Record<string, boolean>
  ) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/profiles/${profileName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: profileConfig }),
      });

      if (response.ok) {
        // プロファイルと設定を両方更新
        await Promise.all([fetchProfiles(), fetchConfig()]);
        // ステータスも更新
        await fetchStatus();
      }
    } catch (error) {
      console.error('プロファイル更新エラー:', error);
    }
  };

  const handleAddServer = async () => {
    // 入力値の検証
    const args = newServer.args.split(' ').filter((arg) => arg);
    let env = {};

    if (newServer.env) {
      try {
        env = JSON.parse(newServer.env);
      } catch (e) {
        alert('環境変数のJSON形式が正しくありません');
        return;
      }
    }

    const serverConfig = {
      command: newServer.command,
      args,
      env,
      enabled: newServer.enabled,
    };

    // 編集モードかどうかを保存
    const isEditing = editingServer;
    const oldServerName = editingServer;

    // すぐにダイアログを閉じる
    setIsAddServerOpen(false);
    setEditingServer(null);
    setNewServer({ name: '', command: '', args: '', env: '', enabled: true, profilesState: {} });

    // バックグラウンドで保存処理を実行
    try {
      let response;

      if (isEditing) {
        // 更新モード
        response = await fetch(`${getApiBaseUrl()}/api/servers`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldName: oldServerName,
            newName: newServer.name,
            ...serverConfig,
          }),
        });
      } else {
        // 新規作成モード
        response = await fetch(`${getApiBaseUrl()}/api/servers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newServer.name,
            ...serverConfig,
          }),
        });
      }

      if (response.ok) {
        // 新規作成時、選択したプロファイルにサーバーを追加
        if (!isEditing && newServer.profilesState) {
          // 選択されたプロファイルに追加
          for (const [profileName, shouldAdd] of Object.entries(newServer.profilesState)) {
            if (shouldAdd && profiles[profileName]) {
              const updatedProfile = {
                ...profiles[profileName],
                [newServer.name]: true,
              };
              await handleUpdateProfile(profileName, updatedProfile);
            }
          }
        } else if (!isEditing && activeProfile !== 'default') {
          // profilesStateがない場合（後方互換性）、現在のプロファイルにのみ追加
          const updatedProfile = {
            ...profiles[activeProfile],
            [newServer.name]: true,
          };
          await handleUpdateProfile(activeProfile, updatedProfile);
        } else {
          // 編集時（名前変更なし）またはdefaultプロファイルの場合は設定のみ再取得
          await Promise.all([fetchConfig(), fetchProfiles()]);
        }
      } else {
        // エラー時の処理
        const errorData = await response.json();
        alert(`エラー: ${errorData.error}`);
      }
    } catch (error) {
      console.error('サーバーの操作に失敗しました:', error);
      alert(`通信エラー: ${(error as Error).message}`);
    }
  };

  const handleDeleteServer = async (name: string) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/servers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (response.ok) {
        await Promise.all([fetchConfig(), fetchProfiles()]);
      } else {
        const errorData = await response.json();
        alert(`削除エラー: ${errorData.error}`);
      }
    } catch (error) {
      console.error('サーバーの削除に失敗しました:', error);
      alert(`エラー: ${(error as Error).message}`);
    }
  };

  const handleEditServer = (name: string) => {
    const server = servers[name];
    if (server) {
      setNewServer({
        name,
        command: server.command,
        args: server.args?.join(' ') || '',
        env: server.env ? JSON.stringify(server.env, null, 2) : '',
        enabled: server.enabled,
        profilesState: {},
      });
      setEditingServer(name);
      setIsAddServerOpen(true);
    }
  };

  const handleShowTools = async (serverName: string) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/tools`);
      if (response.ok) {
        const allTools = await response.json();
        const tools = allTools[serverName] || [];
        console.log(`ツール取得成功 - ${serverName}:`, tools);
        setServerTools(prev => ({ ...prev, [serverName]: tools }));
        setToolsDialogOpen(serverName);
      } else {
        console.error('ツールの取得に失敗しました:', response.status);
      }
    } catch (error) {
      console.error('ツールの取得に失敗しました:', error);
    }
  };

  const handleDragStart = (e: React.DragEvent, name: string) => {
    console.log('Drag start:', name);
    setDraggedServer(name);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, name: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedServer && draggedServer !== name) {
      setDragOverServer(name);
    }
  };

  const handleDragLeave = () => {
    setDragOverServer(null);
  };

  const handleDragEnd = () => {
    setDraggedServer(null);
    setDragOverServer(null);
  };

  const handleDrop = async (e: React.DragEvent, targetName: string) => {
    e.preventDefault();
    console.log('Drop:', draggedServer, '->', targetName);
    setDragOverServer(null);

    if (!draggedServer || draggedServer === targetName) {
      return;
    }

    try {
      // サーバーの順序を再配置
      const serverKeys = Object.keys(servers);
      const draggedIndex = serverKeys.indexOf(draggedServer);
      const targetIndex = serverKeys.indexOf(targetName);

      if (draggedIndex === -1 || targetIndex === -1) {
        return;
      }

      // 配列を再配置
      const newKeys = [...serverKeys];
      newKeys.splice(draggedIndex, 1);
      newKeys.splice(targetIndex, 0, draggedServer);

      // 新しい順序でサーバーオブジェクトを作成
      const orderedServers: Record<string, ServerConfig> = {};
      newKeys.forEach((key) => {
        orderedServers[key] = servers[key];
      });

      console.log('Sending reorder request:', { servers: orderedServers });

      // APIで更新
      const response = await fetch(`${getApiBaseUrl()}/api/servers/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: orderedServers }),
      });

      if (response.ok) {
        setServers(orderedServers);
      } else {
        const errorData = await response.json();
        alert(`順序変更エラー: ${errorData.error}`);
        await fetchConfig(); // エラー時は元に戻す
      }
    } catch (error) {
      console.error('順序変更に失敗しました:', error);
      alert(`エラー: ${(error as Error).message}`);
      await fetchConfig();
    } finally {
      setDraggedServer(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">MCP Gateway</h1>
              <p className="text-muted-foreground mt-2">複数のMCPサーバーを統合管理</p>
              {activeProfile &&
                activeProfile !== 'default' &&
                profileDescriptions[activeProfile] && (
                  <div className="mt-2">
                    <p className="text-lg text-primary">
                      現在のプロファイル:{' '}
                      <span className="font-bold">{getProfileDisplayName(activeProfile)}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {profileDescriptions[activeProfile]}
                    </p>
                  </div>
                )}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">プロファイル:</span>
                <select
                  value={activeProfile || 'default'}
                  onChange={(e) => handleProfileChange(e.target.value)}
                  className="px-3 py-1 text-sm border rounded-md bg-background cursor-pointer hover:border-primary transition-colors"
                >
                  {['default', ...Object.keys(profiles).filter((p) => p !== 'default')].map(
                    (profile) => (
                      <option key={profile} value={profile}>
                        {getProfileDisplayName(profile)}
                      </option>
                    )
                  )}
                </select>
              </div>
              <Dialog
                open={profileDialogOpen}
                onOpenChange={(open) => {
                  setProfileDialogOpen(open);
                  if (!open) {
                    setEditedProfiles({});
                    setHasChanges(false);
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Settings className="w-4 h-4 mr-2" />
                    プロファイル管理
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>プロファイル管理</DialogTitle>
                    <DialogDescription>
                      新しいプロファイルを作成、または既存のプロファイルを管理
                    </DialogDescription>
                  </DialogHeader>
                  <Tabs defaultValue="create" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="create">新規作成</TabsTrigger>
                      <TabsTrigger value="manage">既存の管理</TabsTrigger>
                    </TabsList>
                    <TabsContent value="create" className="space-y-4">
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="profile-name">表示名</Label>
                          <Input
                            id="profile-name"
                            placeholder="例: Development"
                            value={newProfileName}
                            onChange={(e) => setNewProfileName(e.target.value)}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="profile-id">プロファイルID</Label>
                          <Input
                            id="profile-id"
                            placeholder="例: development (英数字とアンダースコアのみ)"
                            value={newProfileId}
                            onChange={(e) =>
                              setNewProfileId(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            --profile {newProfileId || 'プロファイルID'} として使用されます
                          </p>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="profile-description">説明（オプション）</Label>
                          <Textarea
                            id="profile-description"
                            placeholder="このプロファイルの用途を説明"
                            value={newProfileDescription}
                            onChange={(e) => setNewProfileDescription(e.target.value)}
                            rows={2}
                          />
                        </div>
                        <div className="text-sm text-muted-foreground">
                          現在有効なサーバーの設定をベースに新しいプロファイルを作成します
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setProfileDialogOpen(false);
                            setNewProfileName('');
                            setNewProfileId('');
                            setNewProfileDescription('');
                          }}
                        >
                          キャンセル
                        </Button>
                        <Button
                          onClick={async () => {
                            if (newProfileId) {
                              // 現在のサーバー状態を取得
                              const profileConfig: Record<string, boolean> = {};
                              Object.keys(servers).forEach((serverName) => {
                                profileConfig[serverName] = servers[serverName].enabled;
                              });

                              // プロファイルを作成（説明付き）
                              const response = await fetch(
                                `${getApiBaseUrl()}/api/profiles/${newProfileId}`,
                                {
                                  method: 'PUT',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    servers: profileConfig,
                                    description: newProfileDescription,
                                    displayName: newProfileName,
                                  }),
                                }
                              );

                              if (response.ok) {
                                await fetchProfiles();
                                setProfileDialogOpen(false);
                                setNewProfileName('');
                                setNewProfileId('');
                                setNewProfileDescription('');
                              }
                            }
                          }}
                          disabled={!newProfileId}
                        >
                          作成
                        </Button>
                      </DialogFooter>
                    </TabsContent>
                    <TabsContent value="manage" className="space-y-4">
                      <div className="mb-4 p-3 bg-muted/50 rounded-lg text-sm">
                        <p className="font-medium mb-2">Claude Desktop/Codeでの使用方法:</p>
                        <code className="block p-2 bg-background rounded text-xs">
                          {`"args": ["exec", "-i", "shared-mcp-gateway-server", "bun", "server/index.ts", "--profile", "プロファイルID"]`}
                        </code>
                        <p className="text-xs text-muted-foreground mt-2">
                          上記の「プロファイルID」を各プロファイルのIDに置き換えて使用してください。
                        </p>
                      </div>
                      <div className="space-y-2">
                        {/* すべてのプロファイル（defaultを除く） */}
                        {Object.keys(profiles)
                          .filter((p) => p !== 'default')
                          .map((profile) => (
                            <div key={profile} className="p-3 border rounded-lg space-y-2">
                              <div className="flex items-start gap-2">
                                <div className="flex-1 space-y-1">
                                  <Input
                                    className="font-medium"
                                    placeholder="表示名"
                                    value={
                                      editedProfiles[profile]?.displayName ??
                                      getProfileDisplayName(profile)
                                    }
                                    onChange={(e) => {
                                      setEditedProfiles({
                                        ...editedProfiles,
                                        [profile]: {
                                          displayName: e.target.value,
                                          description:
                                            editedProfiles[profile]?.description ??
                                            profileDescriptions[profile] ??
                                            '',
                                        },
                                      });
                                    }}
                                  />
                                  <p className="text-xs text-muted-foreground font-mono">
                                    プロファイルID: {profile}
                                  </p>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => {
                                      setEditingProfile(profile);
                                      setTempProfileServers(profiles[profile] || {});
                                    }}
                                  >
                                    <Settings className="h-3 w-3 mr-1" />
                                    サーバー設定
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={async () => {
                                      // 個別に更新
                                      const displayName =
                                        editedProfiles[profile]?.displayName ??
                                        profileDisplayNames[profile] ??
                                        '';
                                      const description =
                                        editedProfiles[profile]?.description ??
                                        profileDescriptions[profile] ??
                                        '';

                                      const response = await fetch(
                                        `${getApiBaseUrl()}/api/profiles/${profile}`,
                                        {
                                          method: 'PUT',
                                          headers: {
                                            'Content-Type': 'application/json',
                                          },
                                          body: JSON.stringify({
                                            description: description,
                                            displayName: displayName,
                                          }),
                                        }
                                      );

                                      if (response.ok) {
                                        await fetchProfiles();
                                        // この項目の編集状態をクリア
                                        const newEditedProfiles = {
                                          ...editedProfiles,
                                        };
                                        delete newEditedProfiles[profile];
                                        setEditedProfiles(newEditedProfiles);
                                      }
                                    }}
                                    disabled={!editedProfiles[profile]}
                                  >
                                    <Save className="h-3 w-3 mr-1" />
                                    保存
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    onClick={async () => {
                                      if (
                                        confirm(
                                          `プロファイル "${
                                            getProfileDisplayName(profile) || profile
                                          }" を削除しますか？`
                                        )
                                      ) {
                                        await fetch(`${getApiBaseUrl()}/api/profiles/${profile}`, {
                                          method: 'DELETE',
                                        });
                                        await fetchProfiles();
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                              <Input
                                className="text-xs"
                                placeholder="説明を入力"
                                value={
                                  editedProfiles[profile]?.description ??
                                  profileDescriptions[profile] ??
                                  ''
                                }
                                onChange={(e) => {
                                  setEditedProfiles({
                                    ...editedProfiles,
                                    [profile]: {
                                      displayName:
                                        editedProfiles[profile]?.displayName ??
                                        profileDisplayNames[profile] ??
                                        '',
                                      description: e.target.value,
                                    },
                                  });
                                }}
                              />
                              <div className="bg-muted/50 p-2 rounded text-xs font-mono">
                                --profile {profile}
                              </div>
                            </div>
                          ))}
                        {Object.keys(profiles).filter((p) => p !== 'default').length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            プロファイルはまだありません
                          </p>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>

              {/* プロファイル編集ダイアログ */}
              <Dialog
                open={editingProfile !== null}
                onOpenChange={(open) => {
                  if (!open) {
                    setEditingProfile(null);
                    setTempProfileServers({});
                  }
                }}
              >
                <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>
                      {editingProfile && getProfileDisplayName(editingProfile)} のサーバー設定
                    </DialogTitle>
                    <DialogDescription>
                      このプロファイルで有効にするサーバーを選択してください
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    {editingProfile &&
                      Object.entries(servers).map(([serverName, serverConfig]) => (
                        <div
                          key={serverName}
                          className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex-1">
                            <Label
                              htmlFor={`${editingProfile}-${serverName}`}
                              className="text-sm font-medium cursor-pointer"
                            >
                              {serverName}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              {serverConfig.command} {serverConfig.args?.join(' ')}
                            </p>
                          </div>
                          <Switch
                            id={`${editingProfile}-${serverName}`}
                            checked={tempProfileServers[serverName] ?? false}
                            onCheckedChange={(checked) => {
                              setTempProfileServers({
                                ...tempProfileServers,
                                [serverName]: checked,
                              });
                            }}
                          />
                        </div>
                      ))}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingProfile(null);
                        setTempProfileServers({});
                      }}
                    >
                      キャンセル
                    </Button>
                    <Button
                      onClick={async () => {
                        if (editingProfile) {
                          await handleUpdateProfile(editingProfile, tempProfileServers);
                          setEditingProfile(null);
                          setTempProfileServers({});
                        }
                      }}
                    >
                      保存
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="space-y-8">
          {/* プロファイルに含まれているサーバー */}
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(servers)
                .filter(([name, config]) => {
                  // プロファイルの設定を確認
                  const currentProfile = profiles[activeProfile] || {};
                  // defaultプロファイルまたはプロファイルに設定がない場合は全て表示
                  if (activeProfile === 'default' || Object.keys(currentProfile).length === 0) {
                    return true;
                  }
                  // プロファイルで有効になっているサーバーのみ表示
                  return currentProfile[name] === true;
                })
                .map(([name, config]) => {
                  const status = serverStatus[name] || {
                    status: 'disabled',
                    toolCount: 0,
                  };
                  return (
                    <Card
                      key={name}
                      draggable
                      onDragStart={(e) => handleDragStart(e, name)}
                      onDragOver={(e) => handleDragOver(e, name)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, name)}
                      onDragEnd={handleDragEnd}
                      className={`cursor-move transition-all ${
                        dragOverServer === name ? 'ring-2 ring-primary' : ''
                      } ${draggedServer === name ? 'opacity-50' : ''}`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <GripVertical className="w-4 h-4 text-muted-foreground" />
                            <CardTitle>{name}</CardTitle>
                          </div>
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                                !config.enabled
                                  ? 'bg-gray-100 text-gray-600'
                                  : status.status === 'connected'
                                    ? 'bg-green-100 text-green-700'
                                    : status.status === 'updating'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-red-100 text-red-700'
                              }`}
                            >
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  !config.enabled
                                    ? 'bg-gray-400'
                                    : status.status === 'connected'
                                      ? 'bg-green-500'
                                      : status.status === 'updating'
                                        ? 'bg-blue-500 animate-pulse'
                                        : 'bg-red-500'
                                }`}
                              />
                              {!config.enabled
                                ? '無効'
                                : status.status === 'connected'
                                  ? '接続済み'
                                  : status.status === 'updating'
                                    ? '接続中...'
                                    : 'エラー'}
                            </div>
                          </div>
                        </div>
                        <CardDescription className="mt-2">
                          {config.command} {config.args?.join(' ')}
                        </CardDescription>

                        {(() => {
                          const enabledProfiles = Object.entries(profiles).filter(
                            ([profileName, profileConfig]) => {
                              return (
                                profileName !== 'default' &&
                                profileConfig &&
                                name in profileConfig &&
                                profileConfig[name] === true
                              );
                            }
                          );

                          if (enabledProfiles.length > 0) {
                            return (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {enabledProfiles.map(([profileName]) => (
                                  <span
                                    key={profileName}
                                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
                                  >
                                    {getProfileDisplayName(profileName)}
                                  </span>
                                ))}
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </CardHeader>
                      <CardContent className="pt-2">
                        {status.toolCount > 0 && (
                          <p
                            className="text-sm text-muted-foreground mb-3 cursor-pointer hover:text-primary transition-colors"
                            onClick={() => handleShowTools(name)}
                          >
                            ツール数: {status.toolCount} (クリックで表示)
                          </p>
                        )}
                        {status.error && (
                          <p className="text-sm text-red-600 mb-3">{status.error}</p>
                        )}

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditServer(name)}
                          >
                            <Settings className="w-4 h-4" />
                            編集
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteServer(name)}
                          >
                            <Trash2 className="w-4 h-4" />
                            削除
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}

              <Dialog
                open={isAddServerOpen}
                onOpenChange={(open) => {
                  setIsAddServerOpen(open);
                  if (!open) {
                    setEditingServer(null);
                    setNewServer({
                      name: '',
                      command: '',
                      args: '',
                      env: '',
                      enabled: true,
                      profilesState: {},
                    });
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Card className="border-dashed cursor-pointer hover:border-primary transition-colors">
                    <CardContent className="flex flex-col items-center justify-center h-full min-h-[200px]">
                      <Plus className="w-12 h-12 text-primary mb-2" />
                      <p className="text-muted-foreground">新しいMCPサーバーを追加</p>
                    </CardContent>
                  </Card>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>
                      {editingServer ? 'MCPサーバーを編集' : 'MCPサーバーを追加'}
                    </DialogTitle>
                    <DialogDescription>MCPサーバーの接続情報を入力してください</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="name">サーバー名</Label>
                      <Input
                        id="name"
                        value={newServer.name}
                        onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                        placeholder="例: github-mcp"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="command">コマンド</Label>
                      <Input
                        id="command"
                        value={newServer.command}
                        onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                        placeholder="例: npx"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="args">引数</Label>
                      <Input
                        id="args"
                        value={newServer.args}
                        onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
                        placeholder="例: @modelcontextprotocol/server-github"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="env">環境変数 (JSON形式)</Label>
                      <Textarea
                        id="env"
                        value={newServer.env}
                        onChange={(e) => setNewServer({ ...newServer, env: e.target.value })}
                        placeholder='{
  "API_KEY": "your-key",
  "GITHUB_TOKEN": "${GITHUB_TOKEN}"
}'
                        className="font-mono text-sm"
                        rows={5}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="enabled">有効化</Label>
                      <Switch
                        id="enabled"
                        checked={newServer.enabled}
                        onCheckedChange={(checked) =>
                          setNewServer({ ...newServer, enabled: checked })
                        }
                      />
                    </div>

                    {newServer.enabled && !editingServer && (
                      <div className="mt-6 space-y-4">
                        <div className="relative">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                          </div>
                          <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-background px-2 text-muted-foreground">
                              プロファイルに追加
                            </span>
                          </div>
                        </div>

                        <div className="text-sm text-muted-foreground mb-2">
                          新しいサーバーを以下のプロファイルに追加できます：
                        </div>

                        <div className="space-y-3">
                          {Object.keys(profiles)
                            .filter((p) => p !== 'default')
                            .map((profile) => (
                              <div
                                key={profile}
                                className="group relative flex items-center justify-between rounded-lg border p-4 transition-all hover:border-primary/50 hover:bg-secondary/20"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white font-bold text-sm">
                                    {getProfileDisplayName(profile).substring(0, 2).toUpperCase()}
                                  </div>
                                  <div>
                                    <Label
                                      htmlFor={`new-${profile}`}
                                      className="text-sm font-medium cursor-pointer"
                                    >
                                      {getProfileDisplayName(profile)}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                      {profileDescriptions[profile] || ''}
                                    </p>
                                  </div>
                                </div>
                                <Switch
                                  id={`new-${profile}`}
                                  checked={newServer.profilesState?.[profile] ?? (profile === activeProfile)}
                                  onCheckedChange={(checked) => {
                                    // 保存時に使用するために状態を保持
                                    setNewServer({
                                      ...newServer,
                                      profilesState: {
                                        ...newServer.profilesState,
                                        [profile]: checked,
                                      },
                                    });
                                  }}
                                />
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {editingServer && (
                    <div className="mt-6 space-y-4">
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-background px-2 text-muted-foreground">
                            プロファイル設定
                          </span>
                        </div>
                      </div>

                      <div className="text-sm text-muted-foreground mb-2">
                        各プロファイルでの有効/無効を設定：
                      </div>

                      <div className="space-y-3">
                        {Object.keys(profiles)
                          .filter((p) => p !== 'default')
                          .map((profile) => (
                            <div
                              key={profile}
                              className="group relative flex items-center justify-between rounded-lg border p-4 transition-all hover:border-primary/50 hover:bg-secondary/20"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white font-bold text-sm">
                                  {getProfileDisplayName(profile).substring(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <Label
                                    htmlFor={`edit-${editingServer}-${profile}`}
                                    className="text-sm font-medium cursor-pointer"
                                  >
                                    {getProfileDisplayName(profile)}
                                  </Label>
                                  <p className="text-xs text-muted-foreground">
                                    {profileDescriptions[profile] || ''}
                                  </p>
                                </div>
                              </div>
                              <Switch
                                id={`edit-${editingServer}-${profile}`}
                                checked={profiles[profile]?.[editingServer] ?? false}
                                onCheckedChange={async (checked) => {
                                  // プロファイルを更新
                                  const updatedProfile = {
                                    ...profiles[profile],
                                    [editingServer]: checked,
                                  };
                                  await handleUpdateProfile(profile, updatedProfile);
                                }}
                              />
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddServerOpen(false)}>
                      キャンセル
                    </Button>
                    <Button onClick={handleAddServer}>{editingServer ? '保存' : '追加'}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* ツール一覧ダイアログ */}
            </div>
          </div>

          {/* プロファイルに含まれていないサーバー */}
          {activeProfile !== 'default' && Object.keys(profiles[activeProfile] || {}).length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-lg font-semibold text-muted-foreground">利用可能なサーバー</h2>
                <p className="text-sm text-muted-foreground">
                  （このプロファイルに追加されていません）
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(servers)
                  .filter(([name, config]) => {
                    const currentProfile = profiles[activeProfile] || {};
                    // プロファイルで無効になっているサーバーのみ表示
                    return !currentProfile[name];
                  })
                  .map(([name, config]) => {
                    const status = serverStatus[name] || {
                      status: 'disabled',
                      toolCount: 0,
                    };
                    return (
                      <Card
                        key={name}
                        draggable
                        onDragStart={(e) => handleDragStart(e, name)}
                        onDragOver={(e) => handleDragOver(e, name)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, name)}
                        onDragEnd={handleDragEnd}
                        className={`cursor-move transition-all ${
                          dragOverServer === name ? 'ring-2 ring-primary' : ''
                        } ${draggedServer === name ? 'opacity-50' : ''}`}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <GripVertical className="w-4 h-4 text-muted-foreground" />
                              <CardTitle>{name}</CardTitle>
                            </div>
                            <div
                              className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                                !config.enabled
                                  ? 'bg-gray-100 text-gray-600'
                                  : status.status === 'connected'
                                    ? 'bg-green-100 text-green-700'
                                    : status.status === 'updating'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-red-100 text-red-700'
                              }`}
                            >
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  !config.enabled
                                    ? 'bg-gray-400'
                                    : status.status === 'connected'
                                      ? 'bg-green-500'
                                      : status.status === 'updating'
                                        ? 'bg-blue-500 animate-pulse'
                                        : 'bg-red-500'
                                }`}
                              />
                              {!config.enabled
                                ? '無効'
                                : status.status === 'connected'
                                  ? '接続済み'
                                  : status.status === 'updating'
                                    ? '接続中...'
                                    : 'エラー'}
                            </div>
                          </div>
                          <CardDescription className="mt-2">
                            {config.command} {config.args?.join(' ')}
                          </CardDescription>

                          {(() => {
                            const enabledProfiles = Object.entries(profiles).filter(
                              ([profileName, profileConfig]) => {
                                return (
                                  profileName !== 'default' &&
                                  profileConfig &&
                                  name in profileConfig &&
                                  profileConfig[name] === true
                                );
                              }
                            );

                            if (enabledProfiles.length > 0 || Object.keys(profiles).filter(p => p !== 'default').length > 0) {
                              return (
                                <div className="mt-2">
                                  <p className="text-xs text-muted-foreground mb-1">プロファイル:</p>
                                  <div className="flex flex-wrap gap-1">
                                    {Object.entries(profiles)
                                      .filter(([profileName]) => profileName !== 'default')
                                      .map(([profileName, profileConfig]) => {
                                        const isEnabled = profileConfig && name in profileConfig && profileConfig[name] === true;
                                        return (
                                          <button
                                            key={profileName}
                                            onClick={async () => {
                                              const updatedProfile = {
                                                ...profiles[profileName],
                                                [name]: !isEnabled,
                                              };
                                              await handleUpdateProfile(profileName, updatedProfile);
                                            }}
                                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                              isEnabled
                                                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                            }`}
                                          >
                                            {getProfileDisplayName(profileName)}
                                            {isEnabled && (
                                              <span className="ml-1">✓</span>
                                            )}
                                          </button>
                                        );
                                      })}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </CardHeader>
                        <CardContent className="pt-2">
                          {status.toolCount > 0 && (
                            <p
                              className="text-sm text-muted-foreground mb-3 cursor-pointer hover:text-primary transition-colors"
                              onClick={() => handleShowTools(name)}
                            >
                              ツール数: {status.toolCount} (クリックで表示)
                            </p>
                          )}
                          {status.error && (
                            <p className="text-sm text-red-600 mb-3">{status.error}</p>
                          )}

                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditServer(name)}
                            >
                              <Settings className="w-4 h-4" />
                              編集
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeleteServer(name)}
                            >
                              <Trash2 className="w-4 h-4" />
                              削除
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ツール表示ダイアログ */}
      <Dialog
        open={toolsDialogOpen !== null}
        onOpenChange={(open) => {
          if (!open) {
            setToolsDialogOpen(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{toolsDialogOpen} のツール一覧</DialogTitle>
            <DialogDescription>
              このサーバーが提供している利用可能なツール
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-4">
            {toolsDialogOpen && serverTools[toolsDialogOpen] && serverTools[toolsDialogOpen].length > 0 ? (
              serverTools[toolsDialogOpen].map((tool: any, index: number) => (
                <div key={index} className="border rounded-lg p-3">
                  <h4 className="font-semibold text-sm">{tool.name || tool}</h4>
                  {tool.description && (
                    <p className="text-xs text-muted-foreground mt-1">{tool.description}</p>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                ツール情報を読み込み中...
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
