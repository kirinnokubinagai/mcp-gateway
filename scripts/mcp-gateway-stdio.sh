#!/usr/bin/env bash
# Helper to launch mcp-gateway (STDIO mode) with a predictable PATH.
# Claude MCP CLI can call this script directly:
#   claude mcp add -s user mcp-gateway -- /Users/kirinnokubinagaiyo/Claude-Project/mcp-gateway/scripts/mcp-gateway-stdio.sh --profile=dev

set -euo pipefail

# Ensure asdf shims / Homebrew / common bin dirs are in PATH
export PATH="$HOME/.asdf/shims:$HOME/.asdf/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Move to repo root (this script lives in scripts/)
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# Default port can be overridden by PORT env
PORT="${PORT:-8787}"

node src/gateway-stdio.js --port="$PORT" "$@"
