#!/usr/bin/env bash
# Removes GNOMAC and its GTK tweaks. Extensions installed with --extras and
# the MacTahoe icons are left alone.

set -euo pipefail

UUID="gnomac@nayzer974.github.io"
EXT_DST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"

gnome-extensions disable "$UUID" 2>/dev/null || true
rm -rf "$EXT_DST"

for version in 3.0 4.0; do
  css="$CONFIG/gtk-$version/gtk.css"
  if [[ -f "$css" ]]; then
    sed -i '/@import url("gnomac.css");/d' "$css"
  fi
  rm -f "$CONFIG/gtk-$version/gnomac.css"
done

gsettings reset org.gnome.desktop.wm.preferences button-layout
echo "GNOMAC removed. Log out and back in to finish."
