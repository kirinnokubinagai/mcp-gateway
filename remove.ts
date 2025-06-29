#!/usr/bin/env bun
import { config } from "dotenv";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";

// .envファイルを読み込み
config();

// コマンドライン引数を取得
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("使用方法: ./remove.ts <docker-compose.ymlファイルのパス>");
  console.error("例: ./remove.ts ~/Claude-Project/docker-compose-base.yml");
  process.exit(1);
}

const composeFilePath = path.resolve(args[0].replace(/^~/, process.env.HOME!));

// 削除対象のファイルを表示
console.log("🎯 MCP Gateway削除スクリプト");
console.log(`📋 対象ファイル: ${composeFilePath}`);
console.log("");

// ファイルの存在確認
if (!fs.existsSync(composeFilePath)) {
  console.error(
    `❌ エラー: Docker Composeファイルが見つかりません: ${composeFilePath}`
  );
  process.exit(1);
}

// バックアップ作成
const backupPath = `${composeFilePath}.backup-remove`;
fs.copyFileSync(composeFilePath, backupPath);
console.log(`📄 バックアップを作成しました: ${backupPath}`);

// YAMLファイルを読み込み
const fileContent = fs.readFileSync(composeFilePath, "utf8");
const composeData = yaml.load(fileContent) as any;

let updated = false;

// MCP Gatewayサービスを削除
if (composeData.services) {
  if (
    composeData.services["mcp-gateway-server"] ||
    composeData.services["mcp-gateway-client"]
  ) {
    console.log("🔧 MCP Gatewayサービスを削除中...");
    delete composeData.services["mcp-gateway-server"];
    delete composeData.services["mcp-gateway-client"];
    updated = true;
  }

  // プロキシチェッカーを削除
  if (composeData.services["mcp-proxy-check"]) {
    console.log("🔧 プロキシチェッカーを削除中...");
    delete composeData.services["mcp-proxy-check"];
    updated = true;
  }

  // claude-codeサービスからMCP Gateway関連の設定を削除
  if (composeData.services["claude-code"]) {
    const claudeCode = composeData.services["claude-code"];
    let claudeCodeUpdated = false;

    // environmentからMCP_GATEWAY_URLを削除
    if (claudeCode.environment && Array.isArray(claudeCode.environment)) {
      const originalLength = claudeCode.environment.length;
      claudeCode.environment = claudeCode.environment.filter(
        (env: string) => !env.includes("MCP_GATEWAY_URL")
      );
      if (claudeCode.environment.length !== originalLength) {
        claudeCodeUpdated = true;
      }
    }

    // depends_onからmcp-gateway-serverを削除
    if (claudeCode.depends_on && Array.isArray(claudeCode.depends_on)) {
      const index = claudeCode.depends_on.indexOf("mcp-gateway-server");
      if (index > -1) {
        claudeCode.depends_on.splice(index, 1);
        claudeCodeUpdated = true;
      }
      // 空の配列になった場合は削除
      if (claudeCode.depends_on.length === 0) {
        delete claudeCode.depends_on;
      }
    }

    // volumesからmcp-servers-gateway.jsonを削除
    if (claudeCode.volumes && Array.isArray(claudeCode.volumes)) {
      const originalLength = claudeCode.volumes.length;
      claudeCode.volumes = claudeCode.volumes.filter(
        (vol: string) =>
          !vol.includes("mcp-servers-gateway.json") &&
          !vol.includes("mcp-config.json")
      );
      if (claudeCode.volumes.length !== originalLength) {
        claudeCodeUpdated = true;
      }
    }

    // extra_hostsからshared-mcp-gateway-serverを削除
    if (claudeCode.extra_hosts && Array.isArray(claudeCode.extra_hosts)) {
      const originalLength = claudeCode.extra_hosts.length;
      claudeCode.extra_hosts = claudeCode.extra_hosts.filter(
        (host: string) => !host.includes("shared-mcp-gateway-server")
      );
      if (claudeCode.extra_hosts.length !== originalLength) {
        claudeCodeUpdated = true;
      }
    }

    // networksからshared-mcp-networkを削除
    if (claudeCode.networks && Array.isArray(claudeCode.networks)) {
      const index = claudeCode.networks.indexOf("shared-mcp-network");
      if (index > -1) {
        claudeCode.networks.splice(index, 1);
        claudeCodeUpdated = true;
      }
    }

    if (claudeCodeUpdated) {
      console.log("🔧 claude-codeサービスからMCP Gateway設定を削除しました");
      updated = true;
    }
  }
}

// networksセクションからshared-mcp-networkを削除
if (composeData.networks && composeData.networks["shared-mcp-network"]) {
  console.log("🔧 共有ネットワーク設定を削除中...");
  delete composeData.networks["shared-mcp-network"];
  updated = true;

  // networksセクションが空になった場合は削除
  if (Object.keys(composeData.networks).length === 0) {
    delete composeData.networks;
  }
}

// 変更があった場合のみYAMLファイルを更新
if (updated) {
  const newYaml = yaml.dump(composeData, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  fs.writeFileSync(composeFilePath, newYaml);
  console.log("✅ Docker Composeファイルを更新しました");
} else {
  console.log("ℹ️  削除する設定が見つかりませんでした");
}

// .envファイルからMCP Gateway関連の環境変数を削除
const envPath = path.join(path.dirname(composeFilePath), ".env");
if (fs.existsSync(envPath)) {
  console.log("");
  console.log("🔧 .envファイルからMCP Gateway環境変数を削除中...");

  let envContent = fs.readFileSync(envPath, "utf8");
  const originalContent = envContent;

  // MCP Gateway環境変数セクションを削除
  envContent = envContent.replace(
    /\n?# =+\n# MCP Gateway環境変数\n# =+[\s\S]*?(?=\n# =|$)/g,
    ""
  );

  // 個別のMCP Gateway環境変数を削除（セクション外にある場合）
  const mcpVars = [
    "MCP_PROXY_PORT",
    "MCP_API_PORT",
    "MCP_WEB_PORT",
    "MCP_CONFIG_PATH",
  ];
  mcpVars.forEach((varName) => {
    const regex = new RegExp(`^${varName}=.*$`, "gm");
    envContent = envContent.replace(regex, "");
  });

  // 連続する空行を1つに削減
  envContent = envContent.replace(/\n\n+/g, "\n\n");

  if (envContent !== originalContent) {
    fs.writeFileSync(envPath, envContent.trim() + "\n");
    console.log("✅ .envファイルを更新しました");
  }
}

console.log("");
console.log("✅ MCP Gateway設定の削除が完了しました！");
console.log("");
console.log("📝 次のステップ:");
console.log("1. Docker Composeを再起動してください:");
console.log(`   cd ${path.dirname(composeFilePath)}`);
console.log("   docker compose down");
console.log("   docker compose up -d");
