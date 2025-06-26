#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// コマンドライン引数を取得
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('使用方法: ./integrate.ts <docker-compose.ymlファイルのパス>');
  console.error('例: ./integrate.ts ~/Claude-Project/docker-compose-base.yml');
  process.exit(1);
}

const composeFilePath = path.resolve(args[0]);

// ファイルの存在確認
if (!fs.existsSync(composeFilePath)) {
  console.error(`❌ エラー: Docker Composeファイルが見つかりません: ${composeFilePath}`);
  process.exit(1);
}

// バックアップ作成
const backupPath = `${composeFilePath}.backup`;
fs.copyFileSync(composeFilePath, backupPath);
console.log(`📄 バックアップを作成しました: ${backupPath}`);

// YAMLファイルを読み込み
const fileContent = fs.readFileSync(composeFilePath, 'utf8');
const composeData = yaml.load(fileContent) as any;

// MCP Gatewayが既に追加されているかチェック
if (composeData.services && composeData.services['mcp-gateway-server']) {
  console.log('⚠️  MCP Gatewayは既に統合されています');
  process.exit(0);
}

// servicesセクションがない場合は作成
if (!composeData.services) {
  composeData.services = {};
}

// MCP Gatewayサービスを追加
console.log('🔧 MCP Gatewayサービスを追加中...');

// claude-codeがnetwork_mode: hostを使用しているかチェック
const useHostNetwork = composeData.services['claude-code']?.network_mode === 'host';

// プロキシチェッカーサービス
composeData.services['mcp-proxy-check'] = {
  image: 'busybox',
  command: `sh -c "
    if ! nc -z host.docker.internal 9999 2>/dev/null; then
      echo '❌ エラー: MCPプロキシサーバーが起動していません！'
      echo '👉 cd mcp-gateway && bun run proxy'
      exit 1
    fi
  "`,
  extra_hosts: ['host.docker.internal:host-gateway']
};

// MCP Gateway APIサーバー
composeData.services['mcp-gateway-server'] = {
  build: {
    context: '${CLAUDE_PROJECT_DIR}/mcp-gateway',
    dockerfile: 'Dockerfile.server'
  },
  container_name: 'mcp-gateway-server-${PROJECT_NAME}',
  volumes: ['${CLAUDE_PROJECT_DIR}/mcp-gateway/mcp-config.json:/app/mcp-config.json'],
  environment: [
    'MCP_PROXY_PORT=${MCP_PROXY_PORT:-9999}',
    'DOCKER_ENV=true'
  ],
  extra_hosts: ['host.docker.internal:host-gateway'],
  depends_on: {
    'mcp-proxy-check': {
      condition: 'service_completed_successfully'
    }
  },
  restart: 'unless-stopped'
};

// MCP管理用Web UI
composeData.services['mcp-gateway-client'] = {
  build: {
    context: '${CLAUDE_PROJECT_DIR}/mcp-gateway',
    dockerfile: 'Dockerfile.client'
  },
  container_name: 'mcp-gateway-client-${PROJECT_NAME}',
  environment: ['API_URL=http://mcp-gateway-server:3003'],
  depends_on: ['mcp-gateway-server'],
  restart: 'unless-stopped'
};

// network_mode: hostの場合はnetworksを追加しない
if (!useHostNetwork) {
  // 通常のネットワークモード
  composeData.services['mcp-proxy-check'].networks = ['app-network'];
  composeData.services['mcp-gateway-server'].networks = ['app-network'];
  composeData.services['mcp-gateway-client'].networks = ['app-network'];
  
  // ポート設定を追加
  composeData.services['mcp-gateway-server'].ports = ['${MCP_API_PORT:-3003}:3003'];
  composeData.services['mcp-gateway-client'].ports = ['${MCP_WEB_PORT:-3002}:3002'];
  
  // networksセクションがない場合は追加
  if (!composeData.networks) {
    composeData.networks = {};
  }
  if (!composeData.networks['app-network']) {
    composeData.networks['app-network'] = {
      driver: 'bridge'
    };
  }
} else {
  // hostネットワークモードの場合
  composeData.services['mcp-gateway-server'].network_mode = 'host';
  composeData.services['mcp-gateway-client'].network_mode = 'host';
  // portsは設定しない（host networkモードでは不要）
}

// claude-codeサービスを更新
console.log('🔧 claude-codeサービスを更新中...');
if (composeData.services['claude-code']) {
  const claudeCode = composeData.services['claude-code'];
  
  // environmentに追加
  if (!claudeCode.environment) {
    claudeCode.environment = [];
  }
  if (Array.isArray(claudeCode.environment)) {
    if (!claudeCode.environment.includes('MCP_GATEWAY_URL=http://mcp-gateway-server:3003')) {
      claudeCode.environment.push('MCP_GATEWAY_URL=http://mcp-gateway-server:3003');
    }
  }
  
  // depends_onに追加
  if (!claudeCode.depends_on) {
    claudeCode.depends_on = [];
  }
  if (Array.isArray(claudeCode.depends_on)) {
    if (!claudeCode.depends_on.includes('mcp-gateway-server')) {
      claudeCode.depends_on.push('mcp-gateway-server');
    }
  }
  
  // volumesに追加
  if (!claudeCode.volumes) {
    claudeCode.volumes = [];
  }
  const mcpConfigVolume = '${CLAUDE_PROJECT_DIR}/mcp-gateway/claude-project-integration/mcp-servers-gateway.json:/home/developer/.config/claude/mcp-servers.json:ro';
  if (!claudeCode.volumes.includes(mcpConfigVolume)) {
    claudeCode.volumes.push(mcpConfigVolume);
  }
}

// YAMLファイルに書き込み
const newYaml = yaml.dump(composeData, {
  lineWidth: -1,
  noRefs: true,
  sortKeys: false
});

fs.writeFileSync(composeFilePath, newYaml);

console.log('✅ MCP Gateway統合が完了しました！');
console.log('');
console.log('📝 次のステップ:');
console.log('1. Git Submoduleを追加:');
console.log('   cd ~/Claude-Project');
console.log('   git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git');
console.log('');
console.log('2. 依存関係をインストール:');
console.log('   cd mcp-gateway && bun install');
console.log('');
console.log('3. プロキシサーバーを起動:');
console.log('   cd mcp-gateway && bun run proxy');
console.log('');
console.log('4. Docker Composeを再起動:');
console.log('   ./create-project.sh <プロジェクト名>');