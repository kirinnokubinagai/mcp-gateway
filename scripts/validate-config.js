#!/usr/bin/env node

/**
 * MCP Gateway設定ファイル検証ツール
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { configValidator } from '../server/config-validator.js';
import chalk from 'chalk';

const PROFILE_NAMES = ['claude-desktop', 'claude-code', 'gemini-cli'];

/**
 * 設定ファイルを読み込み
 */
function loadConfig(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(chalk.red(`❌ ファイルが見つかりません: ${filePath}`));
    } else if (error instanceof SyntaxError) {
      console.error(chalk.red(`❌ JSONパースエラー: ${error.message}`));
    } else {
      console.error(chalk.red(`❌ ファイル読み込みエラー: ${error.message}`));
    }
    return null;
  }
}

/**
 * 検証結果を表示
 */
function displayResults(filePath, result) {
  console.log(chalk.bold(`\n📋 ${filePath}`));

  if (result.valid) {
    console.log(chalk.green('✅ 検証成功'));
  } else {
    console.log(chalk.red('❌ 検証失敗'));
  }

  // エラーの表示
  if (result.errors && result.errors.length > 0) {
    console.log(chalk.red('\nエラー:'));
    result.errors.forEach((error, index) => {
      console.log(chalk.red(`  ${index + 1}. ${error.path || 'ルート'}: ${error.message}`));
      if (error.value !== undefined) {
        console.log(chalk.gray(`     値: ${JSON.stringify(error.value)}`));
      }
      if (error.suggestion) {
        console.log(chalk.yellow(`     提案: ${error.suggestion}`));
      }
    });
  }

  // 警告の表示
  if (result.warnings && result.warnings.length > 0) {
    console.log(chalk.yellow('\n警告:'));
    result.warnings.forEach((warning, index) => {
      console.log(chalk.yellow(`  ${index + 1}. ${warning.path}: ${warning.message}`));
      if (warning.suggestion) {
        console.log(chalk.gray(`     提案: ${warning.suggestion}`));
      }
    });
  }

  console.log('');
}

/**
 * 設定ファイルの修復
 */
async function repairConfig(filePath, isProfileConfig = false) {
  const config = loadConfig(filePath);
  if (!config) return false;

  console.log(chalk.blue(`\n🔧 ${filePath} を修復しています...`));

  try {
    const repairResult = await configValidator.repairConfig(config, isProfileConfig);

    if (repairResult.repaired) {
      console.log(chalk.green('✅ 修復が完了しました'));
      console.log(chalk.gray('変更内容:'));
      repairResult.changes.forEach((change) => {
        console.log(chalk.gray(`  - ${change}`));
      });

      // バックアップを作成
      const backupPath = `${filePath}.backup`;
      writeFileSync(backupPath, JSON.stringify(config, null, 2));
      console.log(chalk.gray(`バックアップを作成しました: ${backupPath}`));

      // 修復された設定を保存
      writeFileSync(filePath, JSON.stringify(repairResult.config, null, 2));
      console.log(chalk.green(`✅ ファイルを更新しました: ${filePath}`));

      return true;
    } else {
      console.log(chalk.gray('修復の必要はありません'));
      return true;
    }
  } catch (error) {
    console.error(chalk.red(`❌ 修復エラー: ${error.message}`));
    return false;
  }
}

/**
 * メイン処理
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log(chalk.bold.blue('MCP Gateway 設定検証ツール\n'));

  if (command === '--help' || command === '-h') {
    console.log('使用方法:');
    console.log('  node validate-config.js [オプション] [ファイル]');
    console.log('\nオプション:');
    console.log('  --repair, -r     設定ファイルを自動修復');
    console.log('  --all, -a        すべてのプロファイル設定を検証');
    console.log('  --help, -h       このヘルプを表示');
    console.log('\n例:');
    console.log('  node validate-config.js mcp-config.json');
    console.log('  node validate-config.js --repair mcp-config-claude-desktop.json');
    console.log('  node validate-config.js --all');
    return;
  }

  const isRepair = command === '--repair' || command === '-r';
  const isAll = command === '--all' || command === '-a';

  if (isAll) {
    // すべてのプロファイル設定を検証
    console.log(chalk.bold('すべてのプロファイル設定を検証します...\n'));

    // メイン設定ファイル
    const mainConfigPath = resolve('mcp-config.json');
    if (existsSync(mainConfigPath)) {
      const config = loadConfig(mainConfigPath);
      if (config) {
        const result = await configValidator.validateConfig(config, false);
        displayResults('mcp-config.json', result);

        if (isRepair && !result.valid) {
          await repairConfig(mainConfigPath, false);
        }
      }
    }

    // プロファイル設定ファイル
    for (const profile of PROFILE_NAMES) {
      const profilePath = resolve(`mcp-config-${profile}.json`);
      if (existsSync(profilePath)) {
        const config = loadConfig(profilePath);
        if (config) {
          const result = await configValidator.validateConfig(config, true);
          displayResults(`mcp-config-${profile}.json`, result);

          if (isRepair && !result.valid) {
            await repairConfig(profilePath, true);
          }
        }
      }
    }
  } else {
    // 特定のファイルを検証
    const filePath = isRepair ? args[1] : args[0];

    if (!filePath) {
      console.error(chalk.red('❌ ファイルパスを指定してください'));
      console.log(chalk.gray('ヘルプを表示: node validate-config.js --help'));
      process.exit(1);
    }

    const resolvedPath = resolve(filePath);
    const config = loadConfig(resolvedPath);

    if (config) {
      // プロファイル設定かどうかを判定
      const isProfileConfig = PROFILE_NAMES.some((profile) =>
        filePath.includes(`mcp-config-${profile}`)
      );

      const result = await configValidator.validateConfig(config, isProfileConfig);
      displayResults(filePath, result);

      if (isRepair && !result.valid) {
        await repairConfig(resolvedPath, isProfileConfig);
      }
    }
  }
}

// エラーハンドリング
process.on('unhandledRejection', (error) => {
  console.error(chalk.red(`\n❌ 予期しないエラー: ${error.message}`));
  process.exit(1);
});

// 実行
main().catch((error) => {
  console.error(chalk.red(`\n❌ エラー: ${error.message}`));
  process.exit(1);
});
