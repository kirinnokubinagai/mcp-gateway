# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP Gateway is a Bun-specific gateway that integrates multiple MCP (Model Context Protocol) servers into a single interface. It allows Docker containers and Claude Desktop/Code to access multiple MCP servers through a unified WebSocket proxy.

## Key Architecture Components

### 1. MCP Proxy Server (Bun-only)
- **Location**: `mcp-proxy-server/server.ts`
- **Purpose**: WebSocket proxy that bridges Docker containers with MCP servers
- **Port**: ws://localhost:9999 (configurable via MCP_PROXY_PORT)
- **Important**: This server MUST be run with Bun runtime, not Node.js

### 2. Gateway MCP Server
- **Location**: `server/index.ts`
- **Purpose**: Aggregates multiple MCP servers into a single interface
- **Features**:
  - Tool name transformation: `serverName_toolName`
  - Dynamic server connection management
  - WebSocket transport for Docker environments
  - Host command execution support

### 3. API Server
- **Location**: `server/api-server.ts`
- **Purpose**: REST API for managing MCP server configurations
- **Port**: http://localhost:3003

### 4. Web UI
- **Location**: `src/` (React/Vite app)
- **Purpose**: Browser-based MCP server management interface
- **Port**: http://localhost:3002

## Common Development Commands

```bash
# Start everything (proxy + Docker containers)
npm start
# or
./start.sh

# Stop everything
npm stop
# or
./stop.sh

# Run proxy server only (Bun required)
bun run proxy

# Run proxy with config file watching
bun run proxy:daemon

# Build Docker containers
docker-compose build

# Rebuild without cache
npm run rebuild
```

## Configuration Management

### mcp-config.json Structure
```json
{
  "servers": {
    "serverName": {
      "command": "command-to-run",
      "args": ["arg1", "arg2"],
      "env": {
        "ENV_VAR": "value"
      },
      "enabled": true
    }
  }
}
```

### Environment Variable Expansion
- Supports `${ENV_VAR}` syntax in config values
- Automatically expands environment variables in command, args, and env fields

## WebSocket Transport Protocol

The proxy server implements a custom WebSocket protocol for MCP communication:

### Message Types
1. **init**: Initialize MCP server connection
2. **stdin**: Forward stdin data to MCP server
3. **stdout/stderr**: Receive output from MCP server
4. **host-command**: Execute allowed commands on host machine
5. **exit**: Server process termination

### Host Command Whitelist
- `say` (macOS text-to-speech)
- `osascript` (macOS automation)
- `notify-send` (Linux notifications)
- `open` (open files/URLs)

## Docker Integration

### Network Configuration
- Uses `shared-mcp-network` for inter-container communication
- Requires `host.docker.internal` for accessing host services from containers

### Container Structure
1. **proxy-check**: Validates proxy server is running before starting other services
2. **mcp-gateway-server**: Main gateway server container
3. **mcp-gateway-client**: Web UI container

## Error Handling Patterns

The gateway implements comprehensive error handling:
- Package not found errors
- Command not found errors
- Connection refused errors
- Timeout errors
- Permission denied errors

Each error type provides user-friendly messages in Japanese.

## State Management

### Status Files
- `mcp-status.json`: Server connection statuses
- `mcp-tools.json`: Available tools from all servers
- Both files are updated in real-time

### Server States
- `disabled`: Server is disabled in config
- `updating`: Connection in progress
- `connected`: Successfully connected
- `error`: Connection failed (with detailed error info)

## Testing Individual Components

```bash
# Test proxy server connection
websocat ws://localhost:9999

# Test API server
curl http://localhost:3003/api/servers

# Check server status
curl http://localhost:3003/api/status

# List available tools
curl http://localhost:3003/api/tools
```

## Important Notes

1. **Bun Requirement**: The proxy server (`mcp-proxy-server/`) is optimized for Bun runtime and will not work correctly with Node.js
2. **Config Watching**: The system automatically reloads when `mcp-config.json` changes
3. **Error States**: Web UI showing servers as "error" is normal until Claude Code connects
4. **Docker First**: Always ensure proxy server is running before starting Docker containers