#!/usr/bin/env bash
# One-line installer:
#
#   curl -fsSL https://raw.githubusercontent.com/Nayzer974/GNOMAC/main/get.sh | bash
#
# Downloads GNOMAC to ~/.local/share/gnomac-src (a git clone, or the source
# archive when git is missing) and runs its install.sh. Pass options after `-s --`:
#
#   curl -fsSL .../get.sh | bash -s -- --deps --plymouth
#
# Express (a few questions, boot splash and login screen included):
#   curl -fsSL .../get.sh | bash -s -- --ez
#
# Nothing here uses sudo; install.sh only runs it for --deps, and asks for your
# password itself.

set -euo pipefail

REPO="Nayzer974/GNOMAC"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnomac-src"

[[ $EUID -ne 0 ]] || { echo "Run as your normal user, not root." >&2; exit 1; }

if command -v git >/dev/null; then
  if [[ -d "$DEST/.git" ]]; then
    git -C "$DEST" pull --ff-only
  else
    rm -rf "$DEST"
    git clone --depth 1 "https://github.com/$REPO.git" "$DEST"
  fi
else
  command -v curl >/dev/null && command -v tar >/dev/null || { echo "Need git, or curl and tar." >&2; exit 1; }
  rm -rf "$DEST"
  mkdir -p "$DEST"
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar -xz --strip-components=1 -C "$DEST"
  curl -fsSL "https://api.github.com/repos/$REPO/commits/main" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])' > "$DEST/.gnomac-sha" 2>/dev/null || true
fi

# Piped from curl, stdin is this script: whatever the installer reads (a
# pacman question, a prompt) would swallow it. Give it the terminal instead.
if [[ ! -t 0 && -r /dev/tty ]]; then
  exec </dev/tty
fi

# `--ez` runs the express installer (asks a few questions, sets everything up).
if [[ "${1:-}" == "--ez" ]]; then
  shift
  exec "$DEST/ez-install.sh" "$@"
fi
exec "$DEST/install.sh" "$@"
