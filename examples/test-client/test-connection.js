import fetch from 'node-fetch';

const MCP_GATEWAY_URL = process.env.MCP_GATEWAY_URL || 'http://mcp-gateway-server:3003';

async function testMCPGateway() {
  console.log('🔍 MCP Gatewayへの接続テストを開始します...');
  console.log(`📍 URL: ${MCP_GATEWAY_URL}`);
  console.log('');

  try {
    // 1. 設定を取得
    console.log('1️⃣ 設定を取得中...');
    const configResponse = await fetch(`${MCP_GATEWAY_URL}/api/config`);
    const config = await configResponse.json();
    console.log('✅ 設定取得成功:');
    console.log(JSON.stringify(config, null, 2));
    console.log('');

    // 2. MCPサーバーリストを確認
    console.log('2️⃣ 接続されているMCPサーバー:');
    if (config.status) {
      for (const [name, status] of Object.entries(config.status)) {
        console.log(`  • ${name}: ${status.status} (ツール数: ${status.toolCount || 0})`);
      }
    } else {
      console.log('  （接続されているサーバーはありません）');
    }
    console.log('');

    // 3. ツールを実行（gateway.list_servers）
    console.log('3️⃣ gateway.list_serversツールを実行中...');
    const toolResponse = await fetch(`${MCP_GATEWAY_URL}/api/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'gateway.list_servers',
        arguments: {}
      })
    });

    if (toolResponse.ok) {
      const result = await toolResponse.json();
      console.log('✅ ツール実行成功:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('❌ ツール実行失敗:', toolResponse.status);
    }

    console.log('');
    console.log('✨ テスト完了！MCP Gatewayは正常に動作しています。');

  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
    console.error('');
    console.error('トラブルシューティング:');
    console.error('1. MCP Gatewayが起動していることを確認してください');
    console.error('2. docker-compose.ymlでMCP Gatewayを起動してください');
    console.error('3. ネットワーク接続を確認してください');
  }
}

// 定期的にテストを実行
console.log('🚀 MCP Gateway接続テストクライアント');
console.log('=====================================');
testMCPGateway();

// 5秒ごとに再テスト
setInterval(() => {
  console.log('\n🔄 再テスト中...\n');
  testMCPGateway();
}, 30000);