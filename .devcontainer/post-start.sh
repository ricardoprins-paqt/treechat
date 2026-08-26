#!/usr/bin/env bash
set -euo pipefail

# Ensure config dirs exist and are owned by node (volumes may mount as root)
mkdir -p /home/node/.config/github-copilot /home/node/.copilot
sudo chown -R node:node /home/node/.config/github-copilot /home/node/.copilot

corepack enable >/dev/null 2>&1 || true

pnpm install --prefer-offline
