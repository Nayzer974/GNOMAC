#!/usr/bin/env bash
# GNOMAC updater: fetch the newest version and refresh the extension and styles.
# Run by the extension (notification "Update" or automatic mode), or by hand:
#
#   ~/.local/share/gnomac-src/scripts/update.sh
#
# It never uses sudo and never touches your personal settings or user.css. The
# boot splash and login screen (installed with sudo) are refreshed by running
# `sudo ./gdm/install-gdm.sh` again from the source folder.

set -euo pipefail

CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/gnomac"
LOG="$CONFIG/update.log"
mkdir -p "$CONFIG"
exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) update started"

REPO="Nayzer974/GNOMAC"
SRC="$(python3 - "$CONFIG/installed.json" <<'PY' 2>/dev/null || true
import json, sys
try:
    print(json.load(open(sys.argv[1]))["source"])
except Exception:
    pass
PY
)"
SRC="${SRC:-${XDG_DATA_HOME:-$HOME/.local/share}/gnomac-src}"

if [[ -d "$SRC/.git" ]] && command -v git >/dev/null; then
  git -C "$SRC" fetch --quiet origin main
  git -C "$SRC" merge --ff-only --quiet origin/main
else
  # No clone: download the source archive into a fresh folder.
  command -v curl >/dev/null && command -v tar >/dev/null || { echo "need git, or curl and tar"; exit 1; }
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar -xz --strip-components=1 -C "$tmp"
  sha="$(curl -fsSL "https://api.github.com/repos/$REPO/commits/main" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])' 2>/dev/null || echo unknown)"
  echo "$sha" > "$tmp/.gnomac-sha"
  rm -rf "$SRC"
  mkdir -p "$(dirname "$SRC")"
  mv "$tmp" "$SRC"
fi

"$SRC/install.sh" --update
echo "=== update done"
