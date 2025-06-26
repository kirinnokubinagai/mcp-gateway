#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { config } from 'dotenv';

// .envファイルを読み込み
config();

// コマンドライン引数を取得
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('使用方法: ./integrate.ts <docker-compose.ymlファイルのパス>');
  console.error('例: ./integrate.ts ~/Claude-Project/docker-compose-base.yml');
  process.exit(1);
}

const composeFilePath = path.resolve(args[0].replace(/^~/, process.env.HOME!));

// 統合対象のファイルを表示
console.log('🎯 MCP Gateway統合スクリプト');
console.log(`📋 統合対象: ${composeFilePath}`);
console.log('');

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
const isAlreadyIntegrated = composeData.services && composeData.services['mcp-gateway-server'];
if (isAlreadyIntegrated) {
  console.log('⚠️  MCP Gatewayは既に統合されています');
  console.log('📝 .envファイルの更新を確認します...');
}

// servicesセクションがない場合は作成
if (!composeData.services) {
  composeData.services = {};
}

// MCP Gatewayサービスを追加
console.log('🔧 MCP Gatewayサービスを追加中...');



// MCP Gateway APIサーバー
composeData.services['mcp-gateway-server'] = {
  build: {
    context: '${CLAUDE_PROJECT_DIR}/mcp-gateway',
    dockerfile: 'Dockerfile.server'
  },
  image: 'mcp-gateway-server:latest',  // 固定イメージ名を追加
  container_name: 'mcp-gateway-server',  // 固定名に変更
  volumes: ['${CLAUDE_PROJECT_DIR}/mcp-gateway/mcp-config.json:/app/mcp-config.json:ro'],
  environment: [
    'MCP_PROXY_PORT=${MCP_PROXY_PORT:-9999}',
    'DOCKER_ENV=true'
  ],
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'unless-stopped'
};

// MCP管理用Web UI
composeData.services['mcp-gateway-client'] = {
  build: {
    context: '${CLAUDE_PROJECT_DIR}/mcp-gateway',
    dockerfile: 'Dockerfile.client'
  },
  image: 'mcp-gateway-client:latest',  // 固定イメージ名を追加
  container_name: 'mcp-gateway-client',  // 固定名に変更
  environment: [
    'API_URL=http://host.docker.internal:${MCP_API_PORT:-3003}',
    'MCP_API_PORT=${MCP_API_PORT:-3003}'
  ],
  depends_on: ['mcp-gateway-server'],
  ports: ['${MCP_WEB_PORT:-3002}:3002'],  // ポートマッピング
  extra_hosts: ['host.docker.internal:host-gateway'],
  restart: 'unless-stopped'
};

// Claude-Projectはnetwork_mode: hostを使用
composeData.services['mcp-gateway-server'].network_mode = 'host';

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

// YAMLファイルに書き込み（常に更新して固定名を確実に適用）
const newYaml = yaml.dump(composeData, {
  lineWidth: -1,
  noRefs: true,
  sortKeys: false
});

fs.writeFileSync(composeFilePath, newYaml);
console.log('✅ Docker Composeファイルを更新しました');

// git submodule として mcp-gateway を追加
const targetDir = path.dirname(composeFilePath);
console.log('');
console.log('🔧 mcp-gatewayをgit submoduleとして追加中...');

// 対象ディレクトリに移動してgit submodule add を実行
const { execSync } = require('child_process');
try {
  // 既にサブモジュールが存在するかチェック
  const gitmodulesPath = path.join(targetDir, '.gitmodules');
  let isSubmoduleExists = false;
  
  if (fs.existsSync(gitmodulesPath)) {
    const gitmodulesContent = fs.readFileSync(gitmodulesPath, 'utf8');
    isSubmoduleExists = gitmodulesContent.includes('[submodule "mcp-gateway"]');
  }
  
  if (!isSubmoduleExists) {
    // サブモジュールを追加
    execSync('git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway', {
      cwd: targetDir,
      stdio: 'inherit'
    });
    console.log('✅ mcp-gatewayをサブモジュールとして追加しました');
    
    // サブモジュールを初期化
    execSync('git submodule update --init --recursive', {
      cwd: targetDir,
      stdio: 'inherit'
    });
    console.log('✅ サブモジュールを初期化しました');
  } else {
    console.log('ℹ️  mcp-gatewayは既にサブモジュールとして存在します');
    // 既存のサブモジュールを最新に更新
    execSync('git submodule update --init --recursive', {
      cwd: targetDir,
      stdio: 'inherit'
    });
    console.log('✅ サブモジュールを更新しました');
  }
} catch (error: any) {
  console.error('⚠️  git submodule追加中にエラーが発生しました:', error.message);
  console.log('手動で以下のコマンドを実行してください:');
  console.log(`cd ${targetDir}`);
  console.log('git submodule add https://github.com/kirinnokubinagai/mcp-gateway.git mcp-gateway');
  console.log('git submodule update --init --recursive');
}

// .envファイルのパスを取得
const envPath = path.join(path.dirname(composeFilePath), '.env');

// .envファイルが存在しない場合は作成
if (!fs.existsSync(envPath)) {
  console.log('📝 .envファイルを作成します...');
  const defaultEnvContent = `# Claude-Project環境変数
CLAUDE_PROJECT_DIR=${path.dirname(composeFilePath)}
MCP_PROXY_PORT=9999
MCP_API_PORT=3003
MCP_WEB_PORT=3002
`;
  fs.writeFileSync(envPath, defaultEnvContent);
  console.log(`✅ .envファイルを作成しました: ${envPath}`);
} else {
  // 既存の.envファイルを読み込み
  let envContent = fs.readFileSync(envPath, 'utf8');
  
  // 必要な環境変数が存在しない場合は追加
  const requiredVars = {
    'CLAUDE_PROJECT_DIR': path.dirname(composeFilePath),
    'MCP_PROXY_PORT': '9999',
    'MCP_API_PORT': '3003',
    'MCP_WEB_PORT': '3002'
  };
  
  let updated = false;
  
  // MCP Gateway設定セクションを追加
  if (!envContent.includes('MCP Gateway環境変数')) {
    envContent += `\n# ==============================================
# MCP Gateway環境変数
# ==============================================`;
    updated = true;
  }
  
  for (const [key, value] of Object.entries(requiredVars)) {
    if (!envContent.includes(`${key}=`)) {
      envContent += `\n${key}=${value}`;
      updated = true;
    }
  }
  
  if (updated) {
    fs.writeFileSync(envPath, envContent);
    console.log(`✅ .envファイルを更新しました: ${envPath}`);
  }
}

console.log('✅ MCP Gateway統合が完了しました！');
console.log('');
console.log(`📋 統合ファイル: ${composeFilePath}`);
console.log(`📋 環境変数ファイル: ${envPath}`);
console.log('');
console.log('📝 次のステップ:');
console.log('1. プロキシサーバーを起動（別ターミナル）:');
console.log('   cd ~/Claude-Project/mcp-gateway && bun run proxy');
console.log('');
console.log('2. Docker Composeを再起動:');
console.log('   cd ~/Claude-Project');
console.log('   docker compose down');
console.log('   ./create-project.sh <プロジェクト名>');
console.log('');
console.log('3. MCP Gatewayを追加:');
console.log('   docker exec -it claude-code-<プロジェクト名> bash');
console.log('   claude mcp add gateway -- docker exec -i mcp-gateway-server bun server/index.ts');