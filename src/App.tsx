import { Plus, Settings, Trash2, GripVertical } from 'lucide-react'
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
}

function App() {
  const [servers, setServers] = useState<Record<string, ServerConfig>>({})
  const [serverStatus, setServerStatus] = useState<Record<string, ServerStatus>>({})
  const [isAddServerOpen, setIsAddServerOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [toolsDialogOpen, setToolsDialogOpen] = useState<string | null>(null)
  const [serverTools, setServerTools] = useState<Record<string, any[]>>({})
  const [newServer, setNewServer] = useState({
    name: '',
    command: '',
    args: '',
    env: '',
    enabled: true
  })
  const [draggedServer, setDraggedServer] = useState<string | null>(null)
  const [dragOverServer, setDragOverServer] = useState<string | null>(null)

  // APIのベースURLを取得
  const getApiBaseUrl = () => {
    // Viteのプロキシが効く開発環境では空文字を返す
    if (import.meta.env.DEV) {
      return '';
    }
    // プロダクション環境では同じホストの3003ポートを使用
    return `http://${window.location.hostname}:3003`;
  };

  // WebSocketのURLを取得
  const getWsUrl = () => {
    // プロダクション環境では同じホストの3003ポートを使用
    if (!import.meta.env.DEV) {
      return `ws://${window.location.hostname}:3003/ws`;
    }
    // 開発環境
    return 'ws://localhost:3003/ws';
  };

  useEffect(() => {
    // 初期データ読み込み
    fetchConfig()
    
    // WebSocket接続
    const ws = new WebSocket(getWsUrl())
    
    ws.onopen = () => {
      console.log('WebSocket接続成功')
    }
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'status') {
          setServerStatus(message.data)
        }
      } catch (error) {
        console.error('WebSocketメッセージエラー:', error)
      }
    }
    
    ws.onerror = (error) => {
      console.error('WebSocketエラー:', error)
    }
    
    ws.onclose = () => {
      console.log('WebSocket切断')
    }
    
    return () => {
      ws.close()
    }
  }, [])

  const fetchConfig = async () => {
    try {
      // 設定を取得
      const configResponse = await fetch(`${getApiBaseUrl()}/api/servers`)
      const configData = await configResponse.json()
      setServers(configData)
      
      // ステータスを取得
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
    // 入力値の検証
    const args = newServer.args.split(' ').filter(arg => arg)
    let env = {}
    
    if (newServer.env) {
      try {
        env = JSON.parse(newServer.env)
      } catch (e) {
        alert('環境変数のJSON形式が正しくありません')
        return
      }
    }
    
    const serverConfig = {
      command: newServer.command,
      args,
      env,
      enabled: newServer.enabled
    }
    
    // 編集モードかどうかを保存
    const isEditing = editingServer
    const oldServerName = editingServer
    
    // すぐにダイアログを閉じる
    setIsAddServerOpen(false)
    setEditingServer(null)
    setNewServer({ name: '', command: '', args: '', env: '', enabled: true })
    
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
            ...serverConfig
          })
        })
      } else {
        // 新規作成モード
        response = await fetch(`${getApiBaseUrl()}/api/servers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newServer.name,
            ...serverConfig
          })
        })
      }
      
      if (response.ok) {
        // 成功時は設定を再取得
        fetchConfig()
      } else {
        // エラー時の処理
        const errorData = await response.json()
        alert(`エラー: ${errorData.error}`)
      }
    } catch (error) {
      console.error('サーバーの操作に失敗しました:', error)
      alert(`通信エラー: ${(error as Error).message}`)
    }
  }

  const handleDeleteServer = async (name: string) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/servers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
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

  const handleDragStart = (e: React.DragEvent, name: string) => {
    console.log('Drag start:', name)
    setDraggedServer(name)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, name: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedServer && draggedServer !== name) {
      setDragOverServer(name)
    }
  }

  const handleDragLeave = () => {
    setDragOverServer(null)
  }

  const handleDrop = async (e: React.DragEvent, targetName: string) => {
    e.preventDefault()
    console.log('Drop:', draggedServer, '->', targetName)
    setDragOverServer(null)
    
    if (!draggedServer || draggedServer === targetName) {
      return
    }

    try {
      // サーバーの順序を再配置
      const serverKeys = Object.keys(servers)
      const draggedIndex = serverKeys.indexOf(draggedServer)
      const targetIndex = serverKeys.indexOf(targetName)
      
      if (draggedIndex === -1 || targetIndex === -1) {
        return
      }
      
      // 配列を再配置
      const newKeys = [...serverKeys]
      newKeys.splice(draggedIndex, 1)
      newKeys.splice(targetIndex, 0, draggedServer)
      
      // 新しい順序でサーバーオブジェクトを作成
      const orderedServers: Record<string, ServerConfig> = {}
      newKeys.forEach(key => {
        orderedServers[key] = servers[key]
      })
      
      console.log('Sending reorder request:', { servers: orderedServers })
      
      // APIで更新
      const response = await fetch(`${getApiBaseUrl()}/api/servers/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: orderedServers })
      })
      
      if (response.ok) {
        setServers(orderedServers)
      } else {
        const errorData = await response.json()
        alert(`順序変更エラー: ${errorData.error}`)
        await fetchConfig() // エラー時は元に戻す
      }
    } catch (error) {
      console.error('順序変更に失敗しました:', error)
      alert(`エラー: ${(error as Error).message}`)
      await fetchConfig()
    } finally {
      setDraggedServer(null)
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
                  <Card 
                    key={name}
                    draggable
                    onDragStart={(e) => handleDragStart(e, name)}
                    onDragOver={(e) => handleDragOver(e, name)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, name)}
                    className={`cursor-move transition-all ${
                      dragOverServer === name ? 'ring-2 ring-primary' : ''
                    } ${
                      draggedServer === name ? 'opacity-50' : ''
                    }`}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-muted-foreground" />
                          <CardTitle>{name}</CardTitle>
                        </div>
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                          !config.enabled ? 'bg-gray-100 text-gray-600' :
                          status.status === 'connected' ? 'bg-green-100 text-green-700' :
                          status.status === 'updating' ? 'bg-blue-100 text-blue-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          <div className={`w-2 h-2 rounded-full ${
                            !config.enabled ? 'bg-gray-400' :
                            status.status === 'connected' ? 'bg-green-500' :
                            status.status === 'updating' ? 'bg-blue-500 animate-pulse' :
                            'bg-red-500'
                          }`} />
                          {!config.enabled ? '無効' :
                           status.status === 'connected' ? '接続済み' : 
                           status.status === 'updating' ? '接続中...' : 'エラー'}
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
                        <p className="text-sm text-red-600 mb-3">
                          {status.error}
                        </p>
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
                    <Button onClick={handleAddServer}>
                      {editingServer ? '保存' : '追加'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* ツール一覧ダイアログ */}
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