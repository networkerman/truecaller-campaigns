#!/usr/bin/env bash
# Stores a Truecaller Campaigns workspace API key in the macOS Keychain for the MCP server.
# Make the key on the dashboard's API keys page. The key decides which workspace the MCP acts in.
#   ./mcp/login.sh          store or replace the key (prompted, hidden)
#   ./mcp/login.sh logout   remove it
set -euo pipefail
SERVICE=truecaller-campaigns-mcp

if [ "${1:-}" = "logout" ]; then
  security delete-generic-password -s "$SERVICE" >/dev/null 2>&1 && echo "Key removed." || echo "No key stored."
  exit 0
fi

# -w with no value makes security prompt for it, so the key never appears in argv or shell history.
security add-generic-password -U -s "$SERVICE" -a "${USER}" -l "Truecaller Campaigns MCP" -w
echo "Key stored in the Keychain as \"$SERVICE\"."
