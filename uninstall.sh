#!/usr/bin/env bash
# Removes GNOMAC and gives GNOME the look it had before ./install.sh:
#   - the extension and its settings,
#   - the GTK window controls,
#   - the window buttons, fonts, icon/cursor theme, colour scheme, accent colour
#     and shortcuts, put back to the values recorded at install time
#     (~/.config/gnomac/backup.json; without it, GNOME's defaults),
#   - the docks the installer turned off, turned back on.
# Extensions installed with --extras and the icon/cursor themes stay on disk,
# only the settings pointing at them are reverted.
#
# The parts that need root (boot splash, login screen) are not touched here:
# the commands are printed at the end.

set -euo pipefail

UUID="gnomac@nayzer974.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"

info() { printf '\033[1;34m::\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }

[[ $EUID -ne 0 ]] || { warn "Run as your normal user, not root."; exit 1; }

info "Turning the extension off and removing it"
gnome-extensions disable "$UUID" 2>/dev/null || true
rm -rf "$EXT_DST"

info "Removing the GTK window controls"
for version in 3.0 4.0; do
  css="$CONFIG/gtk-$version/gtk.css"
  if [[ -f "$css" ]]; then
    sed -i '/@import url("gnomac.css");/d' "$css"
    # The installer created an empty gtk.css when there was none: remove it again.
    if [[ ! -s "$css" ]]; then rm -f "$css"; fi
  fi
  rm -f "$CONFIG/gtk-$version/gnomac.css" "$CONFIG/gtk-$version/gtk.css.gnomac-backup"
done

info "Putting your previous GNOME settings back"
if command -v dconf >/dev/null && command -v python3 >/dev/null; then
  python3 "$ROOT/scripts/state.py" restore
else
  warn "dconf or python3 missing: resetting the main keys to GNOME's defaults"
  gsettings reset org.gnome.desktop.wm.preferences button-layout || true
  gsettings reset org.gnome.desktop.wm.preferences titlebar-font || true
  gsettings reset org.gnome.desktop.interface font-name || true
  gsettings reset org.gnome.desktop.interface document-font-name || true
  gsettings reset org.gnome.desktop.wm.keybindings switch-input-source || true
fi
rmdir "$CONFIG/gnomac" 2>/dev/null || true

if [[ -d /usr/share/plymouth/themes/gnomac ]]; then
  echo
  echo "A GNOMAC boot theme is installed. To remove it (needs root):"
  echo "  sudo plymouth-set-default-theme -R cachyos && sudo rm -rf /usr/share/plymouth/themes/gnomac"
fi
if [[ -d /usr/share/gnomac || -f /etc/dconf/db/gdm.d/90-gnomac ]]; then
  echo
  echo "The GNOMAC login screen is installed. To remove it (needs root):"
  echo "  sudo $ROOT/gdm/install-gdm.sh --remove"
fi

echo
info "GNOMAC removed. Log out and back in to finish: Wayland cannot unload the shell."
