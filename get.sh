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
fi

exec "$DEST/install.sh" "$@"
