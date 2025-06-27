import { Plus, Settings, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import './App.css'
import { Button } from "./components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./components/ui/dialog"
import { Input } from "./components/ui/input"
import { Label } from "./components/ui/label"
import { Switch } from "./components/ui/switch"
import { Textarea } from "./components/ui/textarea"

interface ServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled: boolean
}

interface ServerStatus {
  status: 'connected' | 'error' | 'disabled' | 'updating'
  toolCount: number
  error?: string
  errorType?: 'connection' | 'timeout' | 'not_found' | 'command' | 'auth' | 'unknown'
}

const STATUS_COLORS = {
  disabled: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  connected: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  updating: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500 animate-pulse' },
  error: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' }
} as const

const ERROR_ICONS = {
  connection: '🔌 接続エラー',
  timeout: '⏱️ タイムアウト',
  not_found: '❓ パッケージが見つかりません',
  command: '⚠️ コマンドエラー',
  auth: '🔐 認証エラー',
  unknown: '❌ エラー'
} as const

function App() {
  const [servers, setServers] = useState<Record<string, ServerConfig>>({})
  const [serverStatus, setServerStatus] = useState<Record<string, ServerStatus>>({})
  const [isAddServerOpen, setIsAddServerOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [toolsDialogOpen, setToolsDialogOpen] = useState<string | null>(null)
  const [serverTools, setServerTools] = useState<Record<string, any[]>>({})
  const [newServer, setNewServer] = useState({
    name: '',
    command: '',
    args: '',
    env: '',
    enabled: true
  })

  const getApiBaseUrl = () => {
    if (import.meta.env.DEV) {
      return '';
    }
    const apiPort = import.meta.env.VITE_MCP_API_PORT || '3003';
    return `http://${window.location.hostname}:${apiPort}`;
  };

  const getWsUrl = () => {
    const apiPort = import.meta.env.VITE_MCP_API_PORT || '3003';
    if (!import.meta.env.DEV) {
      return `ws://${window.location.hostname}:${apiPort}/ws`;
    }
    return `ws://localhost:${apiPort}/ws`;
  };

  useEffect(() => {
    fetchConfig()
    
    const ws = new WebSocket(getWsUrl())
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'status') {
          setServerStatus(message.data)
        } else if (message.type === 'config') {
          setServers(message.data.mcpServers || {})
        }
      } catch (error) {
        console.error('WebSocketメッセージエラー:', error)
      }
    }
    
    ws.onerror = (error) => {
      console.error('WebSocketエラー:', error)
    }
    
    const interval = setInterval(fetchConfig, 30000)
    
    return () => {
      clearInterval(interval)
      ws.close()
    }
  }, [])

  const fetchConfig = async () => {
    try {
      const configResponse = await fetch(`${getApiBaseUrl()}/api/config`)
      const configData = await configResponse.json()
      setServers(configData.mcpServers || {})
      
      const statusResponse = await fetch(`${getApiBaseUrl()}/api/status`)
      if (statusResponse.ok) {
        const statusData = await statusResponse.json()
        setServerStatus(statusData)
      }
    } catch (error) {
      console.error('設定の取得に失敗しました:', error)
    }
  }

  const handleAddServer = async () => {
    setIsSaving(true)
    try {
      const args = newServer.args.split(' ').filter(arg => arg)
      let env = {}
      
      if (newServer.env) {
        try {
          env = JSON.parse(newServer.env)
        } catch (e) {
          alert('環境変数のJSON形式が正しくありません')
          setIsSaving(false)
          return
        }
      }
      
      const serverConfig = {
        command: newServer.command,
        args,
        env,
        enabled: newServer.enabled
      }
      
      let response;
      
      if (editingServer) {
        response = await fetch(`${getApiBaseUrl()}/api/servers/${editingServer}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...serverConfig,
            newName: newServer.name
          })
        })
      } else {
        response = await fetch(`${getApiBaseUrl()}/api/servers/${newServer.name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serverConfig)
        })
      }
      
      if (response.ok) {
        await fetchConfig()
        setIsAddServerOpen(false)
        setEditingServer(null)
        setNewServer({ name: '', command: '', args: '', env: '', enabled: true })
      } else {
        const errorData = await response.json()
        alert(`エラー: ${errorData.error}`)
      }
    } catch (error) {
      console.error('サーバーの操作に失敗しました:', error)
      alert(`エラー: ${(error as Error).message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteServer = async (name: string) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/servers/${name}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        await fetchConfig()
      } else {
        const errorData = await response.json()
        alert(`削除エラー: ${errorData.error}`)
      }
    } catch (error) {
      console.error('サーバーの削除に失敗しました:', error)
      alert(`エラー: ${(error as Error).message}`)
    }
  }

  const handleEditServer = (name: string) => {
    const server = servers[name]
    if (server) {
      setNewServer({
        name,
        command: server.command,
        args: server.args?.join(' ') || '',
        env: server.env ? JSON.stringify(server.env, null, 2) : '',
        enabled: server.enabled
      })
      setEditingServer(name)
      setIsAddServerOpen(true)
    }
  }

  const handleShowTools = async (serverName: string) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/servers/${serverName}/tools`)
      if (response.ok) {
        const tools = await response.json()
        setServerTools({ ...serverTools, [serverName]: tools })
        setToolsDialogOpen(serverName)
      }
    } catch (error) {
      console.error('ツールの取得に失敗しました:', error)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold">MCP Gateway</h1>
          <p className="text-muted-foreground mt-2">複数のMCPサーバーを統合管理</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(servers).map(([name, config]) => {
                const status = serverStatus[name] || { status: 'disabled', toolCount: 0 }
                return (
                  <Card key={name}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle>{name}</CardTitle>
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                          !config.enabled ? STATUS_COLORS.disabled.bg + ' ' + STATUS_COLORS.disabled.text :
                          status.status === 'connected' ? STATUS_COLORS.connected.bg + ' ' + STATUS_COLORS.connected.text :
                          status.status === 'updating' ? STATUS_COLORS.updating.bg + ' ' + STATUS_COLORS.updating.text :
                          STATUS_COLORS.error.bg + ' ' + STATUS_COLORS.error.text
                        }`}>
                          <div className={`w-2 h-2 rounded-full ${
                            !config.enabled ? STATUS_COLORS.disabled.dot :
                            status.status === 'connected' ? STATUS_COLORS.connected.dot :
                            status.status === 'updating' ? STATUS_COLORS.updating.dot :
                            STATUS_COLORS.error.dot
                          }`} />
                          {!config.enabled ? '無効' :
                           status.status === 'connected' ? '接続中' : 
                           status.status === 'updating' ? '更新中' : 'エラー'}
                        </div>
                      </div>
                      <CardDescription>
                        {config.command} {config.args?.join(' ')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {status.toolCount > 0 && (
                        <p 
                          className="text-sm text-muted-foreground mb-3 cursor-pointer hover:text-primary transition-colors"
                          onClick={() => handleShowTools(name)}
                        >
                          ツール数: {status.toolCount} (クリックで表示)
                        </p>
                      )}
                      {status.error && (
                        <div className="mb-3">
                          <p className="text-sm text-red-600 flex items-center gap-1">
                            {ERROR_ICONS[status.errorType || 'unknown']}
                          </p>
                          <p className="text-xs text-gray-500 mt-1 break-all">
                            {status.error}
                          </p>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleEditServer(name)}>
                          <Settings className="w-4 h-4" />
                          編集
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDeleteServer(name)}>
                          <Trash2 className="w-4 h-4" />
                          削除
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
              
              <Dialog open={isAddServerOpen} onOpenChange={(open) => {
                setIsAddServerOpen(open)
                if (!open) {
                  setEditingServer(null)
                  setNewServer({ name: '', command: '', args: '', env: '', enabled: true })
                }
              }}>
                <DialogTrigger asChild>
                  <Card className="border-dashed cursor-pointer hover:border-primary transition-colors">
                    <CardContent className="flex flex-col items-center justify-center h-full min-h-[200px]">
                      <Plus className="w-12 h-12 text-primary mb-2" />
                      <p className="text-muted-foreground">新しいMCPサーバーを追加</p>
                    </CardContent>
                  </Card>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>{editingServer ? 'MCPサーバーを編集' : 'MCPサーバーを追加'}</DialogTitle>
                    <DialogDescription>
                      MCPサーバーの接続情報を入力してください
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="name">サーバー名</Label>
                      <Input
                        id="name"
                        value={newServer.name}
                        onChange={(e) => setNewServer({...newServer, name: e.target.value})}
                        placeholder="例: github-mcp"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="command">コマンド</Label>
                      <Input
                        id="command"
                        value={newServer.command}
                        onChange={(e) => setNewServer({...newServer, command: e.target.value})}
                        placeholder="例: npx"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="args">引数</Label>
                      <Input
                        id="args"
                        value={newServer.args}
                        onChange={(e) => setNewServer({...newServer, args: e.target.value})}
                        placeholder="例: @modelcontextprotocol/server-github"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="env">環境変数 (JSON形式)</Label>
                      <Textarea
                        id="env"
                        value={newServer.env}
                        onChange={(e) => setNewServer({...newServer, env: e.target.value})}
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
                        onCheckedChange={(checked) => setNewServer({...newServer, enabled: checked})}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddServerOpen(false)}>キャンセル</Button>
                    <Button onClick={handleAddServer} disabled={isSaving}>
                      {isSaving ? '保存中...' : (editingServer ? '保存' : '追加')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={toolsDialogOpen !== null} onOpenChange={(open) => {
                if (!open) setToolsDialogOpen(null)
              }}>
                <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{toolsDialogOpen} のツール一覧</DialogTitle>
                    <DialogDescription>
                      利用可能なツールの詳細
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    {serverTools[toolsDialogOpen || '']?.map((tool, index) => (
                      <div key={index} className="border rounded-lg p-4">
                        <h4 className="font-semibold text-sm mb-2">{tool.name}</h4>
                        <p className="text-xs text-muted-foreground">{tool.description}</p>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
      </main>
    </div>
  )
}

export default App