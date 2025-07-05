# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP Gateway is a sophisticated gateway system that integrates multiple MCP (Model Context Protocol) servers into a single unified interface. It provides WebSocket-based proxy functionality for Docker containers and supports multiple client profiles (Claude Desktop, Claude Code, Gemini CLI).

## Runtime Requirements

- **Bun**: v1.0+ (REQUIRED for proxy server - will NOT work with Node.js)
- **Node.js**: v18+ (for watch-config.js and general development)
- **Docker & Docker Compose**: v20+ and v2+ (for Web UI deployment)

## Key Architecture Components

### 1. MCP Proxy Server (Bun-only)
- **Location**: `mcp-proxy-server/server.ts`
- **Purpose**: WebSocket proxy that bridges Docker containers with MCP servers
- **Port**: ws://localhost:9999 (configurable via MCP_PROXY_PORT)
- **Critical**: This server MUST be run with Bun runtime due to native WebSocket implementation

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
- **Framework**: Hono (lightweight web framework)

### 4. Web UI
- **Location**: `src/` (React/Vite app)
- **Purpose**: Browser-based MCP server management interface
- **Port**: http://localhost:3002
- **Stack**: React + TypeScript + Tailwind CSS + shadcn/ui

### 5. Profile Manager
- **Location**: `server/profile-manager.ts`
- **Purpose**: Manages different client profiles (claude-desktop, claude-code, gemini-cli)
- **Config Files**: 
  - `mcp-config-claude-desktop.json`
  - `mcp-config-claude-code.json`
  - `mcp-config-gemini-cli.json`

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

# Start specific profile
npm run start:claude-desktop
npm run start:claude-code
npm run start:gemini-cli

# Build Docker containers
docker-compose build

# Rebuild without cache
npm run rebuild

# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint
```

## Configuration Management

### Profile-based Config Structure
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
- Example: `"apiKey": "${OPENAI_API_KEY}"`

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

The gateway implements comprehensive error handling with Japanese error messages:
- Package not found errors
- Command not found errors
- Connection refused errors
- Timeout errors
- Permission denied errors

Each error type provides user-friendly messages and suggested solutions.

## State Management

### Status Files
- `mcp-status.json`: Server connection statuses
- `mcp-tools.json`: Available tools from all servers
- Both files are updated in real-time via WebSocket events

### Server States
- `disabled`: Server is disabled in config
- `updating`: Connection in progress
- `connected`: Successfully connected
- `error`: Connection failed (with detailed error info)

## Testing & Development

### Test Individual Components
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

### Running Tests
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- path/to/test.spec.ts
```

## Important Development Notes

1. **Bun Requirement**: The proxy server (`mcp-proxy-server/`) is optimized for Bun runtime and will not work correctly with Node.js due to native WebSocket implementation
2. **Config Watching**: The system automatically reloads when profile config files change
3. **Error States**: Web UI showing servers as "error" is normal until Claude Code connects
4. **Docker First**: Always ensure proxy server is running before starting Docker containers
5. **Profile Selection**: Use environment variable `MCP_PROFILE` or npm scripts to select profile
6. **WebSocket Stability**: The proxy server includes automatic reconnection logic for dropped connections

## Architecture Decisions

1. **Bun for Proxy**: Chosen for superior WebSocket performance and lower memory footprint
2. **Profile System**: Allows different configurations for different AI clients without conflicts
3. **Status Broadcasting**: Uses WebSocket for real-time status updates instead of polling
4. **Error Recovery**: Implements exponential backoff for connection retries
5. **Host Command Security**: Whitelist approach prevents arbitrary command execution from containers