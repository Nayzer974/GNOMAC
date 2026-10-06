#!/usr/bin/env bash
# GNOMAC on the GDM login screen (CachyOS / Arch GNOME).
#
#   sudo ./gdm/install-gdm.sh                       install, using your current wallpaper
#   sudo ./gdm/install-gdm.sh --wallpaper IMAGE     install, with this image behind the login
#   sudo ./gdm/install-gdm.sh --remove              put the stock login screen back
#
# What it does, nothing else:
#   1. copies the extension to /usr/share/gnome-shell/extensions (GDM's shell
#      cannot read your home folder) and compiles its schema,
#   2. copies the wallpaper to /usr/share/gnomac/login.jpg,
#   3. writes /etc/dconf/db/gdm.d/90-gnomac to enable the extension for GDM
#      (and /etc/dconf/profile/gdm if the distribution did not ship one),
#      then runs `dconf update`.
# The login screen restyles at the next boot or after `sudo systemctl restart gdm`
# (which ends your session: save your work first).

set -euo pipefail

UUID="gnomac@nayzer974.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/extension/$UUID"
DST="/usr/share/gnome-shell/extensions/$UUID"
SHARE="/usr/share/gnomac"
DB="/etc/dconf/db/gdm.d/90-gnomac"
PROFILE="/etc/dconf/profile/gdm"

die() { printf 'xx %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Run this with sudo."

if [[ "${1:-}" == "--remove" ]]; then
  rm -rf "$DST" "$SHARE" "$DB"
  dconf update
  echo ":: Stock login screen restored (takes effect at the next boot)."
  exit 0
fi

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

[[ -d "$SRC" ]] || die "Extension sources not found in $SRC"

echo ":: Copying the extension to $DST"
rm -rf "$DST"
mkdir -p "$(dirname "$DST")"
cp -r "$SRC" "$DST"
glib-compile-schemas "$DST/schemas"
chmod -R a+rX "$DST"

mkdir -p "$SHARE"
if [[ -n "$WALLPAPER" ]]; then
  echo ":: Wallpaper: $WALLPAPER"
  cp "$WALLPAPER" "$SHARE/login.jpg"
  chmod a+r "$SHARE/login.jpg"
else
  echo "!! No wallpaper found: pass one with --wallpaper IMAGE (the login screen keeps GNOME's background)."
fi

if [[ ! -f "$PROFILE" ]]; then
  echo ":: Creating $PROFILE"
  mkdir -p "$(dirname "$PROFILE")"
  printf 'user-db:user\nsystem-db:gdm\nfile-db:/usr/share/gdm/greeter-dconf-defaults\n' > "$PROFILE"
fi

echo ":: Enabling the extension for GDM"
mkdir -p "$(dirname "$DB")"
cat > "$DB" <<DCONF
[org/gnome/shell]
enabled-extensions=['$UUID']
DCONF
dconf update

echo ":: Done. The new login screen shows at the next boot."
echo "   To undo:  sudo $0 --remove"
