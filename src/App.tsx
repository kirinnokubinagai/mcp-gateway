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
  status: 'connected' | 'error' | 'disabled'
  toolCount: number
  error?: string
}

function App() {
  const [servers, setServers] = useState<Record<string, ServerConfig>>({})
  const [serverStatus, setServerStatus] = useState<Record<string, ServerStatus>>({})
  const [isAddServerOpen, setIsAddServerOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [newServer, setNewServer] = useState({
    name: '',
    command: '',
    args: '',
    env: '',
    enabled: true
  })

  useEffect(() => {
    // 初期データ読み込み
    fetchConfig()
    
    // 定期的に状態を更新
    const interval = setInterval(fetchConfig, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/config')
      const data = await response.json()
      setServers(data.config.servers || {})
      setServerStatus(data.status || {})
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
          return
        }
      }
      
      if (editingServer && editingServer !== newServer.name) {
        // 名前が変更された場合は、古いサーバーを削除して新規作成
        await fetch(`/api/servers/${editingServer}`, {
          method: 'DELETE'
        })
      }
      
      const response = await fetch(`/api/servers/${newServer.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: newServer.command,
          args,
          env,
          enabled: newServer.enabled
        })
      })
      
      if (response.ok) {
        await fetchConfig()
        // 成功時のみモーダルを閉じる
        setIsAddServerOpen(false)
        setEditingServer(null)
        setNewServer({ name: '', command: '', args: '', env: '', enabled: true })
        // 成功メッセージ（オプション）
        // alert(editingServer ? 'サーバーを更新しました' : 'サーバーを追加しました')
      } else {
        const error = await response.text()
        alert(`サーバーエラー: ${error}`)
        // エラー時はモーダルを閉じない
      }
    } catch (error) {
      console.error(editingServer ? 'サーバーの更新に失敗しました:' : 'サーバーの追加に失敗しました:', error)
      if ((error as Error).name === 'AbortError') {
        alert('タイムアウトしました。サーバー設定は保存されましたが、接続に失敗している可能性があります。')
        // タイムアウトでも設定を再読み込み
        await fetchConfig()
        setIsAddServerOpen(false)
        setEditingServer(null)
        setNewServer({ name: '', command: '', args: '', env: '', enabled: true })
      } else {
        alert(`エラー: ${(error as Error).message}`)
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteServer = async (name: string) => {
    try {
      const response = await fetch(`/api/servers/${name}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        await fetchConfig()
      }
    } catch (error) {
      console.error('サーバーの削除に失敗しました:', error)
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
                          !config.enabled ? 'bg-gray-100 text-gray-600' :
                          status.status === 'connected' ? 'bg-green-100 text-green-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          <div className={`w-2 h-2 rounded-full ${
                            !config.enabled ? 'bg-gray-400' :
                            status.status === 'connected' ? 'bg-green-500' :
                            'bg-red-500'
                          }`} />
                          {!config.enabled ? '無効' :
                           status.status === 'connected' ? '接続中' : 'エラー'}
                        </div>
                      </div>
                      <CardDescription>
                        {config.command} {config.args?.join(' ')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {status.toolCount > 0 && (
                        <p className="text-sm text-muted-foreground mb-3">
                          ツール数: {status.toolCount}
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
                    <Button onClick={handleAddServer} disabled={isSaving}>
                      {isSaving ? '保存中...' : (editingServer ? '保存' : '追加')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
      </main>
    </div>
  )
}

export default App