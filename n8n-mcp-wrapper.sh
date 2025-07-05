#!/bin/bash

# n8n-mcp コンテナのラッパースクリプト
# 既存のコンテナがある場合は再利用し、ない場合のみ新規作成

CONTAINER_NAME="n8n-mcp-gateway"
IMAGE="ghcr.io/czlonkowski/n8n-mcp:latest"

# 既存のコンテナをチェック
if docker ps -a --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    # コンテナが存在する場合
    if docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        # 実行中の場合はそのまま使用
        docker attach ${CONTAINER_NAME}
    else
        # 停止している場合は起動してから使用
        docker start -i ${CONTAINER_NAME}
    fi
else
    # コンテナが存在しない場合は新規作成
    docker run -i --rm --name ${CONTAINER_NAME} \
        -e MCP_MODE="${MCP_MODE}" \
        -e LOG_LEVEL="${LOG_LEVEL}" \
        -e DISABLE_CONSOLE_OUTPUT="${DISABLE_CONSOLE_OUTPUT}" \
        -e N8N_API_URL="${N8N_API_URL}" \
        -e N8N_API_KEY="${N8N_API_KEY}" \
        ${IMAGE}
fi