#!/usr/bin/env bash
# GNOMAC on the GDM login screen (CachyOS / Arch GNOME).
#
#   sudo ./gdm/install-gdm.sh                       install, using your current wallpaper
#   sudo ./gdm/install-gdm.sh --wallpaper IMAGE     install, with this image behind the login
#   sudo ./gdm/install-gdm.sh --check               show what is installed, change nothing
#   sudo ./gdm/install-gdm.sh --remove              put the stock login screen back
#
# Run it from a full copy of the repository (the folder that contains
# `extension/` next to `gdm/`), not from the `gdm` folder alone.
#
# What it does, nothing else:
#   1. copies the extension to /usr/share/gnome-shell/extensions (GDM's shell
#      cannot read your home folder) and compiles its schema,
#   2. copies the wallpaper to /usr/share/gnomac/login.jpg,
#   3. writes /etc/dconf/db/gdm.d/90-gnomac to enable the extension for GDM
#      (and /etc/dconf/profile/gdm if the system has none), then `dconf update`,
#   4. checks every step and says so if one is missing.
# The login screen restyles at the next boot, or after `sudo systemctl restart gdm`
# (which ends your session: save your work first).

set -euo pipefail

UUID="gnomac@nayzer974.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/extension/$UUID"
DST="/usr/share/gnome-shell/extensions/$UUID"
SHARE="/usr/share/gnomac"
DB="/etc/dconf/db/gdm.d/90-gnomac"
PROFILE="/etc/dconf/profile/gdm"

ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAILED=1; }
info() { printf '\033[1;34m::\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
FAILED=0

check() {
  info "State of the GNOMAC login screen"
  [[ -f "$DST/metadata.json" ]] && ok "extension copied: $DST" || bad "extension missing: $DST"
  grep -q '"gdm"' "$DST/metadata.json" 2>/dev/null && ok "metadata lists the gdm session mode" \
    || bad "metadata.json has no \"gdm\" in session-modes"
  [[ -f "$DST/schemas/gschemas.compiled" ]] && ok "schema compiled" || bad "schema not compiled in $DST/schemas"
  [[ -f "$SHARE/login.jpg" ]] && ok "wallpaper: $SHARE/login.jpg" || bad "no wallpaper at $SHARE/login.jpg (GNOME's background stays)"
  if [[ -s "$DB" ]] && grep -q "$UUID" "$DB"; then ok "GDM enables the extension: $DB"; else bad "$DB is missing or empty"; fi
  if [[ -f "$PROFILE" || -f /usr/share/dconf/profile/gdm ]]; then ok "dconf profile for GDM present"; else bad "no dconf profile for GDM"; fi
  if [[ -f /etc/dconf/db/gdm ]] && strings /etc/dconf/db/gdm 2>/dev/null | grep -q "$UUID"; then
    ok "dconf database for GDM contains the extension"
  else
    bad "the compiled dconf database /etc/dconf/db/gdm does not contain the extension (run: sudo dconf update)"
  fi
}

[[ $EUID -eq 0 ]] || die "Run this with sudo."

case "${1:-}" in
  --check) check; exit $FAILED ;;
  --remove)
    rm -rf "$DST" "$SHARE" "$DB"
    dconf update
    echo ":: Stock login screen restored (takes effect at the next boot)."
    exit 0 ;;
esac

[[ -d "$SRC" ]] || die "Extension sources not found in $SRC. Run this script from a full copy of the repository (git clone, or ~/.local/share/gnomac-src)."

WALLPAPER=""
if [[ "${1:-}" == "--wallpaper" ]]; then
  WALLPAPER="${2:-}"
  [[ -f "$WALLPAPER" ]] || die "Not a file: $WALLPAPER"
elif [[ -n "${SUDO_USER:-}" ]]; then
  # The wallpaper of the user who ran sudo.
  uid="$(id -u "$SUDO_USER")"
  for key in picture-uri-dark picture-uri; do
    uri="$(sudo -u "$SUDO_USER" env XDG_RUNTIME_DIR="/run/user/$uid" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" \
      gsettings get org.gnome.desktop.background "$key" 2>/dev/null | tr -d "'")" || uri=""
    path="${uri#file://}"
    if [[ -n "$path" && -f "$path" ]]; then WALLPAPER="$path"; break; fi
  done
fi

info "Copying the extension to $DST"
rm -rf "$DST"
mkdir -p "$(dirname "$DST")"
cp -r "$SRC" "$DST"
glib-compile-schemas "$DST/schemas"
chmod -R a+rX "$DST"

mkdir -p "$SHARE"
if [[ -n "$WALLPAPER" ]]; then
  info "Wallpaper: $WALLPAPER"
  cp "$WALLPAPER" "$SHARE/login.jpg"
  chmod a+r "$SHARE/login.jpg"
else
  echo "!! No wallpaper found: pass one with --wallpaper IMAGE (the login screen keeps GNOME's background)."
fi

if [[ ! -f "$PROFILE" && ! -f /usr/share/dconf/profile/gdm ]]; then
  info "Creating $PROFILE"
  mkdir -p "$(dirname "$PROFILE")"
  printf 'user-db:user\nsystem-db:gdm\nfile-db:/usr/share/gdm/greeter-dconf-defaults\n' > "$PROFILE"
fi

info "Enabling the extension for GDM"
mkdir -p "$(dirname "$DB")"
printf "[org/gnome/shell]\nenabled-extensions=['%s']\n" "$UUID" > "$DB"
chmod a+r "$DB"
dconf update

echo
check
echo
if (( FAILED )); then
  echo "!! Something above is marked ✗: send me this output."
  exit 1
fi
echo ":: Done. The new login screen shows at the next boot (or after: sudo systemctl restart gdm)."
echo "   To see what GDM's shell says:  sudo journalctl -b | grep -i gnomac"
echo "   To undo:  sudo $0 --remove"
