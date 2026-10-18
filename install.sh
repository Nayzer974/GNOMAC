#!/usr/bin/env bash
# GNOMAC installer — CachyOS / Arch first, works on any GNOME 50+ distro.
#
#   ./install.sh            extension + GTK window controls + macOS button layout
#   ./install.sh --deps     also install packages with pacman (asks sudo itself)
#   ./install.sh --extras   also install rounded window corners + app tray icons (extensions.gnome.org)
#   ./install.sh --icons    also install the MacTahoe icon theme
#   ./install.sh --cursors  also install macOS-style cursors (WhiteSur)
#   ./install.sh --plymouth prepare the macOS-style boot splash (prints the sudo commands, never runs them)
#   ./install.sh --gdm      prepare the macOS-style login screen (prints the sudo command, never runs it)
#   ./install.sh --update   refresh the extension and styles only (used by the automatic updater)
#   ./install.sh --all      everything above
#
# Never stores or pipes your password: sudo prompts you directly.

set -euo pipefail

UUID="gnomac@nayzer974.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_SRC="$ROOT/extension/$UUID"
EXT_DST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"

# extensions.gnome.org ids: Rounded Window Corners Reborn (rounded corners on
# every window), AppIndicator (app icons in the menu bar). GNOMAC has its own
# Genie and app menus, so Magic Lamp / Global Menu would now conflict.
EXTRA_EXTENSIONS=(7048 615)

WITH_DEPS=0 WITH_EXTRAS=0 WITH_ICONS=0 WITH_CURSORS=0 WITH_PLYMOUTH=0 WITH_GDM=0 UPDATE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --deps) WITH_DEPS=1 ;;
    --extras) WITH_EXTRAS=1 ;;
    --icons) WITH_ICONS=1 ;;
    --cursors) WITH_CURSORS=1 ;;
    --plymouth) WITH_PLYMOUTH=1 ;;
    --gdm) WITH_GDM=1 ;;
    --update) UPDATE_ONLY=1 ;;
    --all) WITH_DEPS=1 WITH_EXTRAS=1 WITH_ICONS=1 WITH_CURSORS=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
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
    # --noconfirm: you already said yes; and when the script is piped from curl,
    # pacman's question would otherwise read the script itself as the answer.
    sudo pacman -S --needed --noconfirm glib2 inter-font gnome-shell-extensions gnome-tweaks git curl unzip
  else
    warn "--deps only knows pacman; install glib2, Inter, git, curl, unzip yourself."
  fi
fi

# Remember today's settings so ./uninstall.sh can give GNOME its old look back.
if command -v dconf >/dev/null; then
  python3 "$ROOT/scripts/state.py" save
else
  warn "dconf not found: uninstall.sh will reset the settings to GNOME's defaults instead of your previous values."
fi

command -v glib-compile-schemas >/dev/null || die "glib-compile-schemas missing (package glib2)."

# ---------------------------------------------------------------- extension
info "Installing the extension to $EXT_DST"
rm -rf "$EXT_DST"
mkdir -p "$EXT_DST"
cp -r "$EXT_SRC/." "$EXT_DST/"
glib-compile-schemas "$EXT_DST/schemas"

# Automatically add any schema keys that the user's saved config does not yet
# have (e.g. after several pushes of updates). Existing custom values are
# never overwritten: only missing keys receive the schema default.
migrate_settings() {
  local schema="$EXT_DST/schemas/org.gnome.shell.extensions.gnomac.gschema.xml"
  [[ -f "$schema" ]] || return 0
  python3 - "$schema" <<'PY'
import xml.etree.ElementTree as ET, subprocess, sys
schema_file = sys.argv[1]
tree = ET.parse(schema_file)
root = tree.getroot()
schema_el = root.find('schema')
if schema_el is None:
    sys.exit(0)
schema_id = schema_el.get('id')
for key in schema_el.findall('key'):
    name = key.get('name')
    default_el = key.find('default')
    if default_el is None or not default_el.text:
        continue
    raw_default = default_el.text.strip()
    key_type = key.get('type', 's')
    # Check whether the key already exists in the user's dconf.
    check = subprocess.run(
        ['gsettings', 'read', schema_id, name],
        capture_output=True, text=True)
    if check.returncode == 0:
        continue  # key already set by the user: keep it
    # Convert the XML default to a gsettings-friendly value.
    if key_type == 'b':
        val = raw_default  # true / false
    elif key_type == 's':
        # XML stores strings as 'value': strip the surrounding quotes.
        val = raw_default
        if val.startswith("'") and val.endswith("'"):
            val = val[1:-1]
        val = f"'{val}'"
    elif key_type in ('i', 'd', 'u', 'x', 't'):
        val = raw_default
    elif key_type == 'as':
        val = raw_default  # e.g. ['home', 'stats']
    else:
        val = raw_default
    subprocess.run(
        ['gsettings', 'set', schema_id, name, val],
        capture_output=True)
PY
}

migrate_settings

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

if (( ! UPDATE_ONLY )); then
enable_extension "$UUID"
gsettings set org.gnome.shell disable-user-extensions false
fi

# Docks fight over the same screen edge.
(( UPDATE_ONLY )) || for other in dash-to-dock@micxgx.gmail.com ubuntu-dock@ubuntu.com dash2dock-lite@icedman.github.com; do
  if gnome-extensions list --enabled 2>/dev/null | grep -qx "$other"; then
    warn "Disabling $other (conflicts with the GNOMAC dock)"
    gnome-extensions disable "$other" || true
    command -v dconf >/dev/null && python3 "$ROOT/scripts/state.py" disabled "$other"
  fi
done

# ---------------------------------------------------------------- GTK theme
install_gtk_css() {
  local version="$1"
  local dir="$CONFIG/gtk-$version"
  mkdir -p "$dir"
  # A gnomac.css of your own (ours always names GNOMAC in its first lines) is
  # kept aside, once, and given back by uninstall.sh.
  if [[ -f "$dir/gnomac.css" && ! -e "$dir/gnomac.css.user-backup" ]] &&
     ! head -n 3 "$dir/gnomac.css" | grep -q 'GNOMAC'; then
    warn "$dir/gnomac.css is not GNOMAC's: kept as gnomac.css.user-backup"
    cp "$dir/gnomac.css" "$dir/gnomac.css.user-backup"
  fi
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

if (( ! UPDATE_ONLY )); then
info "Applying macOS window button layout and fonts"
gsettings set org.gnome.desktop.wm.preferences button-layout 'close,minimize,maximize:'
if fc-list 2>/dev/null | grep -qi 'Inter'; then
  gsettings set org.gnome.desktop.interface font-name 'Inter 11'
  gsettings set org.gnome.desktop.interface document-font-name 'Inter 11'
  gsettings set org.gnome.desktop.wm.preferences titlebar-font 'Inter Bold 11'
fi
# A laptop trackpad: GNOME ships tap-to-click off, and then neither the light tap,
# the two-finger tap (right click) nor tap-and-drag work. Turned on, like a Mac.
# (Preferences > Pavé tactile changes them later; uninstall.sh puts them back.)
if gsettings list-keys org.gnome.desktop.peripherals.touchpad >/dev/null 2>&1; then
  info "Turning on tap to click and tap and drag for the trackpad"
  gsettings set org.gnome.desktop.peripherals.touchpad tap-to-click true
  gsettings set org.gnome.desktop.peripherals.touchpad tap-and-drag true
fi
fi

# ---------------------------------------------------------------- version record
# The automatic updater compares this commit with the latest one on GitHub.
SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || cat "$ROOT/.gnomac-sha" 2>/dev/null || echo unknown)"
mkdir -p "$CONFIG/gnomac"
python3 -c 'import json,datetime,sys; print(json.dumps({"sha": sys.argv[1], "source": sys.argv[2], "installed": datetime.datetime.utcnow().isoformat() + "Z"}))' "$SHA" "$ROOT" > "$CONFIG/gnomac/installed.json"

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
  trap 'rm -rf "$icons_tmp"' EXIT
  git clone --depth 1 https://github.com/vinceliuice/MacTahoe-icon-theme.git "$icons_tmp/MacTahoe-icon-theme"
  (cd "$icons_tmp/MacTahoe-icon-theme" && ./install.sh)
  trap - EXIT
  rm -rf "$icons_tmp"
  gsettings set org.gnome.desktop.interface icon-theme 'MacTahoe-dark'
fi

if (( WITH_CURSORS )); then
  command -v git >/dev/null || die "--cursors needs git."
  info "Installing macOS-style cursors (WhiteSur)"
  cursors_tmp="$(mktemp -d)"
  trap 'rm -rf "$cursors_tmp"' EXIT
  git clone --depth 1 https://github.com/vinceliuice/WhiteSur-cursors.git "$cursors_tmp/WhiteSur-cursors"
  mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/icons/WhiteSur-cursors"
  cp -r "$cursors_tmp/WhiteSur-cursors/dist/." "${XDG_DATA_HOME:-$HOME/.local/share}/icons/WhiteSur-cursors/"
  trap - EXIT
  rm -rf "$cursors_tmp"
  gsettings set org.gnome.desktop.interface cursor-theme 'WhiteSur-cursors'
fi

if (( WITH_PLYMOUTH )); then
  info "Boot splash (Plymouth): needs root, so these commands are for you to run:"
  cat <<PLY

    sudo cp -r "$ROOT/plymouth/gnomac" /usr/share/plymouth/themes/gnomac
    sudo plymouth-set-default-theme gnomac
    sudo mkinitcpio -P          # Arch / CachyOS (use 'sudo update-initramfs -u' on Debian/Ubuntu)

  Make sure the kernel command line has "quiet splash" and that mkinitcpio's HOOKS
  contain "plymouth" (CachyOS has both by default). To go back:
    sudo plymouth-set-default-theme -R cachyos

PLY
fi

if (( WITH_GDM )); then
  info "Login screen (GDM): needs root, so this command is for you to run:"
  cat <<GDM

    sudo "$ROOT/gdm/install-gdm.sh"                      # uses your current wallpaper
    sudo "$ROOT/gdm/install-gdm.sh" --wallpaper IMAGE    # or pick the image
    sudo "$ROOT/gdm/install-gdm.sh" --remove             # to go back

  Run it again after updating GNOMAC, so GDM gets the new version.

GDM
fi

echo
info "Done. Log out and back in to load GNOMAC (Wayland cannot reload the shell)."
info "Settings: gnome-extensions prefs $UUID"
