#!/usr/bin/env bash
# apiKeyHelper for Claude Code (example). Claude Code runs the command configured in the
# `apiKeyHelper` setting and sends what it prints on stdout as the API key, so the key never
# lives in settings.json, in the repo, or in a long-lived shell variable.
#
# Configure it in USER or MANAGED settings, not in the committed project settings:
#   ~/.claude/settings.json   { "apiKeyHelper": "/opt/ai-sdlc/api-key-helper.sh" }
#
# Sources, in order:
#   1. CLAUDE_KEY_FILE: a file readable only by you (chmod 600), e.g. mounted by your secret agent.
#   2. HashiCorp Vault CLI, if installed and logged in: secret/ai-sdlc/claude/<user>, field api_key.
# Prints nothing and exits 1 when no source is available, so Claude Code reports an auth error
# instead of silently falling back to a shared key.
set -euo pipefail

if [[ -n "${CLAUDE_KEY_FILE:-}" ]]; then
  if [[ ! -r "$CLAUDE_KEY_FILE" ]]; then
    echo "api-key-helper: CLAUDE_KEY_FILE=$CLAUDE_KEY_FILE is not readable" >&2
    exit 1
  fi
  perms=$(stat -c '%a' "$CLAUDE_KEY_FILE" 2>/dev/null || stat -f '%Lp' "$CLAUDE_KEY_FILE")
  if [[ "$perms" != "600" && "$perms" != "400" ]]; then
    echo "api-key-helper: $CLAUDE_KEY_FILE has mode $perms; run chmod 600 on it" >&2
    exit 1
  fi
  tr -d '\r\n' < "$CLAUDE_KEY_FILE"
  exit 0
fi

if command -v vault >/dev/null 2>&1; then
  vault kv get -field=api_key "secret/ai-sdlc/claude/${USER:-unknown}"
  exit 0
fi

echo "api-key-helper: no key source found (set CLAUDE_KEY_FILE or log in to Vault)" >&2
exit 1
