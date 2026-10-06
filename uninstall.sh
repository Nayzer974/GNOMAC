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
# Spotlight lifts Super+Space from the input source switcher; give it back
# even if the shell never ran the extension's disable().
if ! gsettings get org.gnome.desktop.wm.keybindings switch-input-source | grep -q "<Super>space"; then
  gsettings reset org.gnome.desktop.wm.keybindings switch-input-source
fi
if [[ -d /usr/share/plymouth/themes/gnomac ]]; then
  echo "A GNOMAC boot theme is installed. To remove it (needs root):"
  echo "  sudo plymouth-set-default-theme -R cachyos && sudo rm -rf /usr/share/plymouth/themes/gnomac"
fi
if [[ -d /usr/share/gnomac || -f /etc/dconf/db/gdm.d/90-gnomac ]]; then
  echo "The GNOMAC login screen is installed. To remove it (needs root):"
  echo "  sudo ./gdm/install-gdm.sh --remove"
fi
echo "GNOMAC removed. Log out and back in to finish."
