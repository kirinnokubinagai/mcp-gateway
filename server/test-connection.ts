#!/usr/bin/env bun

import { WebSocketTransport } from './websocket-transport';

async function testConnection() {
  console.log('=== MCP WebSocketプロキシ接続テスト ===\n');
  
  const proxyHost = process.env.DOCKER_ENV ? 'host.docker.internal' : 'localhost';
  const proxyPort = process.env.MCP_PROXY_PORT || '9999';
  const proxyUrl = `ws://${proxyHost}:${proxyPort}`;
  
  console.log('環境情報:');
  console.log(`  DOCKER_ENV: ${process.env.DOCKER_ENV}`);
  console.log(`  プロキシHost: ${proxyHost}`);
  console.log(`  プロキシPort: ${proxyPort}`);
  console.log(`  プロキシURL: ${proxyUrl}`);
  
  // テスト1: filesystemサーバー
  console.log('\n1. filesystemサーバーへの接続テスト...');
  try {
    const transport1 = new WebSocketTransport({
      url: proxyUrl,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/app'],
      env: {}
    });
    
    const client1 = await transport1.connect();
    console.log('   ✅ 接続成功');
    
    const tools = await client1.listTools();
    console.log(`   ツール数: ${tools.tools.length}`);
    console.log(`   ツール: ${tools.tools.map(t => t.name).join(', ')}`);
    
    await client1.close();
  } catch (error) {
    console.error('   ❌ エラー:', error);
  }
  
  // テスト2: echoコマンド（MCPサーバーではない）
  console.log('\n2. echoコマンドのテスト...');
  try {
    const transport2 = new WebSocketTransport({
      url: proxyUrl,
      command: 'echo',
      args: ['test'],
      env: {}
    });
    
    const client2 = await transport2.connect();
    console.log('   ✅ 接続成功（ただしMCPサーバーではない）');
    
    await client2.close();
  } catch (error) {
    console.error('   ❌ 予想通りのエラー:', error.message);
  }
  
  // テスト3: 存在しないコマンド
  console.log('\n3. 存在しないコマンドのテスト...');
  try {
    const transport3 = new WebSocketTransport({
      url: proxyUrl,
      command: 'nonexistent-command',
      args: [],
      env: {}
    });
    
    const client3 = await transport3.connect();
    console.log('   接続成功（予期しない）');
    await client3.close();
  } catch (error) {
    console.error('   ❌ 予想通りのエラー:', error.message);
  }
  
  console.log('\n=== テスト完了 ===');
}

testConnection().catch(console.error);