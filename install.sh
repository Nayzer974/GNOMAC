#!/usr/bin/env bash
# GNOMAC installer — CachyOS / Arch first, works on any GNOME 50+ distro.
#
#   ./install.sh            extension + GTK window controls + macOS button layout
#   ./install.sh --deps     also install packages with pacman (asks sudo itself)
#   ./install.sh --extras   also install Magic Lamp (genie) + Global Menu from extensions.gnome.org
#   ./install.sh --icons    also install the MacTahoe icon theme
#   ./install.sh --cursors  also install macOS-style cursors (WhiteSur)
#   ./install.sh --all      everything above
#
# Never stores or pipes your password: sudo prompts you directly.

set -euo pipefail

UUID="gnomac@nayzer974.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_SRC="$ROOT/extension/$UUID"
EXT_DST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"

# extensions.gnome.org ids: Compiz alike magic lamp effect, Global Menu for GNOME
EXTRA_EXTENSIONS=(3740 10288)

WITH_DEPS=0 WITH_EXTRAS=0 WITH_ICONS=0 WITH_CURSORS=0
for arg in "$@"; do
  case "$arg" in
    --deps) WITH_DEPS=1 ;;
    --extras) WITH_EXTRAS=1 ;;
    --icons) WITH_ICONS=1 ;;
    --cursors) WITH_CURSORS=1 ;;
    --all) WITH_DEPS=1 WITH_EXTRAS=1 WITH_ICONS=1 WITH_CURSORS=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

info() { printf '\033[1;34m::\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -ne 0 ]] || die "Run as your normal user, not root."
command -v gnome-shell >/dev/null || die "gnome-shell not found."

SHELL_MAJOR="$(gnome-shell --version | grep -oE '[0-9]+' | head -1)"
info "GNOME Shell $SHELL_MAJOR detected"
if (( SHELL_MAJOR < 50 )); then
  die "GNOMAC needs GNOME 50 or newer."
fi

# ---------------------------------------------------------------- packages
if (( WITH_DEPS )); then
  if command -v pacman >/dev/null; then
    info "Installing packages (sudo will ask for your password)"
    sudo pacman -S --needed glib2 inter-font gnome-shell-extensions gnome-tweaks git curl unzip
  else
    warn "--deps only knows pacman; install glib2, Inter, git, curl, unzip yourself."
  fi
fi

command -v glib-compile-schemas >/dev/null || die "glib-compile-schemas missing (package glib2)."

# ---------------------------------------------------------------- extension
info "Installing the extension to $EXT_DST"
rm -rf "$EXT_DST"
mkdir -p "$EXT_DST"
cp -r "$EXT_SRC/." "$EXT_DST/"
glib-compile-schemas "$EXT_DST/schemas"

enable_extension() {
  local uuid="$1"
  # A freshly copied extension is unknown to a running Wayland session, so
  # gnome-extensions enable fails until the next login: edit the list instead.
  if gnome-extensions enable "$uuid" 2>/dev/null; then
    return
  fi
  python3 - "$uuid" <<'PY'
import ast, subprocess, sys
uuid = sys.argv[1]
raw = subprocess.run(["gsettings", "get", "org.gnome.shell", "enabled-extensions"],
                     capture_output=True, text=True, check=True).stdout.strip()
if raw.startswith("@as"):
    raw = raw[3:].strip()
current = ast.literal_eval(raw) if raw else []
if uuid not in current:
    current.append(uuid)
    subprocess.run(["gsettings", "set", "org.gnome.shell", "enabled-extensions", str(current)], check=True)
PY
}

enable_extension "$UUID"
gsettings set org.gnome.shell disable-user-extensions false

# Docks fight over the same screen edge.
for other in dash-to-dock@micxgx.gmail.com ubuntu-dock@ubuntu.com dash2dock-lite@icedman.github.com; do
  if gnome-extensions list --enabled 2>/dev/null | grep -qx "$other"; then
    warn "Disabling $other (conflicts with the GNOMAC dock)"
    gnome-extensions disable "$other" || true
  fi
done

# ---------------------------------------------------------------- GTK theme
install_gtk_css() {
  local version="$1"
  local dir="$CONFIG/gtk-$version"
  mkdir -p "$dir"
  cp "$ROOT/theme/gtk-$version/gnomac.css" "$dir/gnomac.css"
  local line='@import url("gnomac.css");'
  touch "$dir/gtk.css"
  if ! grep -qF "$line" "$dir/gtk.css"; then
    cp "$dir/gtk.css" "$dir/gtk.css.gnomac-backup"
    printf '%s\n' "$line" >> "$dir/gtk.css"
  fi
}
info "Installing Golden Gate window controls (GTK 3 + GTK 4)"
install_gtk_css 3.0
install_gtk_css 4.0

info "Applying macOS window button layout and fonts"
gsettings set org.gnome.desktop.wm.preferences button-layout 'close,minimize,maximize:'
if fc-list 2>/dev/null | grep -qi 'Inter'; then
  gsettings set org.gnome.desktop.interface font-name 'Inter 11'
  gsettings set org.gnome.desktop.interface document-font-name 'Inter 11'
  gsettings set org.gnome.desktop.wm.preferences titlebar-font 'Inter Bold 11'
fi

# ---------------------------------------------------------------- extras
if (( WITH_EXTRAS )); then
  command -v curl >/dev/null && command -v unzip >/dev/null || die "--extras needs curl and unzip."
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  for pk in "${EXTRA_EXTENSIONS[@]}"; do
    info "Fetching extension #$pk from extensions.gnome.org"
    meta="$(curl -fsSL "https://extensions.gnome.org/extension-info/?pk=$pk&shell_version=$SHELL_MAJOR")" || {
      warn "Extension #$pk has no release for GNOME $SHELL_MAJOR, skipped."; continue; }
    read -r uuid url < <(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["uuid"], d["download_url"])' <<<"$meta")
    curl -fsSL "https://extensions.gnome.org$url" -o "$tmp/$pk.zip"
    gnome-extensions install --force "$tmp/$pk.zip"
    enable_extension "$uuid"
  done
fi

if (( WITH_ICONS )); then
  command -v git >/dev/null || die "--icons needs git."
  info "Installing the MacTahoe icon theme"
  icons_tmp="$(mktemp -d)"
  git clone --depth 1 https://github.com/vinceliuice/MacTahoe-icon-theme.git "$icons_tmp/MacTahoe-icon-theme"
  (cd "$icons_tmp/MacTahoe-icon-theme" && ./install.sh)
  rm -rf "$icons_tmp"
  gsettings set org.gnome.desktop.interface icon-theme 'MacTahoe-dark'
fi

if (( WITH_CURSORS )); then
  command -v git >/dev/null || die "--cursors needs git."
  info "Installing macOS-style cursors (WhiteSur)"
  cursors_tmp="$(mktemp -d)"
  git clone --depth 1 https://github.com/vinceliuice/WhiteSur-cursors.git "$cursors_tmp/WhiteSur-cursors"
  mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/icons/WhiteSur-cursors"
  cp -r "$cursors_tmp/WhiteSur-cursors/dist/." "${XDG_DATA_HOME:-$HOME/.local/share}/icons/WhiteSur-cursors/"
  rm -rf "$cursors_tmp"
  gsettings set org.gnome.desktop.interface cursor-theme 'WhiteSur-cursors'
fi

echo
info "Done. Log out and back in to load GNOMAC (Wayland cannot reload the shell)."
info "Settings: gnome-extensions prefs $UUID"
