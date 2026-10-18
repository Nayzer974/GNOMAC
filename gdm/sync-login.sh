#!/usr/bin/env bash
# Copies the user's GNOMAC extension to the system folder GDM reads, so the
# login screen follows updates. Run as root by gnomac-gdm-sync.service when the
# user's ~/.config/gnomac/installed.json changes (that file is rewritten by every
# install or update). Installed by `sudo gdm/install-gdm.sh --auto-sync`.
#
#   sync-login.sh USER
#
# It copies ONLY the extension folder, refuses symbolic links, compiles the
# schema, makes everything root-owned, and swaps the folder in one step.

set -euo pipefail

UUID="gnomac@nayzer974.github.io"
USER_NAME="${1:?usage: sync-login.sh USER}"
# The unit passes GNOMAC_SYNC_SRC (the user's XDG_DATA_HOME may not be ~/.local/share);
# without it the default folder of the user is used.
if [[ -n "${GNOMAC_SYNC_SRC:-}" ]]; then
  SRC="$GNOMAC_SYNC_SRC"
else
  HOME_DIR="${GNOMAC_SYNC_HOME:-$(getent passwd "$USER_NAME" | cut -d: -f6)}"
  SRC="$HOME_DIR/.local/share/gnome-shell/extensions/$UUID"
fi
DST="${GNOMAC_SYNC_DEST:-/usr/share/gnome-shell/extensions/$UUID}"

log() { printf 'gnomac-gdm-sync: %s\n' "$*"; }

[[ -f "$SRC/metadata.json" && -f "$SRC/extension.js" ]] || { log "no extension in $SRC, nothing to do"; exit 0; }
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("uuid")==sys.argv[2] else 1)' "$SRC/metadata.json" "$UUID" || { log "unexpected metadata, refusing"; exit 1; }

PARENT="$(dirname "$DST")"
mkdir -p "$PARENT"
TMP="$(mktemp -d "$PARENT/.gnomac-sync.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

cp -r --no-preserve=all "$SRC/." "$TMP/"
if find "$TMP" -type l | grep -q .; then
  log "the extension folder contains symbolic links, refusing"
  exit 1
fi
if [[ -d "$TMP/schemas" ]]; then
  glib-compile-schemas "$TMP/schemas" || { log "schema compilation failed"; exit 1; }
fi
if [[ $EUID -eq 0 ]]; then
  chown -R root:root "$TMP"
fi
chmod -R u=rwX,go=rX "$TMP"

rm -rf "$DST.old"
if [[ -d "$DST" ]]; then
  mv -T "$DST" "$DST.old" 2>/dev/null || mv "$DST" "$DST.old"
fi
mv "$TMP" "$DST"
trap - EXIT
rm -rf "$DST.old"
log "login screen extension updated from $SRC"
