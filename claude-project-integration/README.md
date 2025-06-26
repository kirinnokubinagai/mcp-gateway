# MCP Gateway統合ガイド

## 統合方法

### 方法1: integrate.sh（Docker Compose拡張ファイル使用）
```bash
./integrate.sh ~/Claude-Project docker-compose-base.yml
```

### 方法2: integrate-properly.sh（Docker Composeファイルに直接追加）
```bash
./integrate-properly.sh ~/Claude-Project docker-compose-base.yml
```

## 違い

- **integrate.sh**: 拡張ファイル（-f オプション）を使用
- **integrate-properly.sh**: 既存のdocker-compose.ymlに直接サービスを追加

## ファイル構成

```
mcp-gateway/
├── integrate.sh                    # 拡張ファイル方式の統合スクリプト
├── integrate-properly.sh           # 直接追加方式の統合スクリプト
└── claude-project-integration/
    ├── docker-compose.yml         # Docker Compose拡張ファイル
    ├── mcp-servers-gateway.json   # MCP設定ファイル
    └── README.md                  # このファイル
```