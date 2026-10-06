#!/usr/bin/env bash
# GNOMAC, express install: one command, a few questions, everything set up.
#
#   ./ez-install.sh            asks what you want (Enter = yes for the safe parts)
#   ./ez-install.sh --yes      no questions: extension, boot splash and login screen
#   ./ez-install.sh --minimal  no questions: only the extension and window controls
#
# From the web, nothing to download first:
#   curl -fsSL https://raw.githubusercontent.com/Nayzer974/GNOMAC/main/get.sh | bash -s -- --ez
#
# The parts that need administrator rights (boot splash, login screen, packages)
# run with `sudo` and ask for YOUR password themselves: this script never
# reads, stores or sends it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE=ask
for arg in "$@"; do
  case "$arg" in
    --yes|-y) MODE=yes ;;
    --minimal) MODE=minimal ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

b() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[1;34m::\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }

[[ $EUID -ne 0 ]] || { warn "Run as your normal user, not root: sudo is called when needed."; exit 1; }

# ask "question" default(y|n) -> 0 for yes
ask() {
  case "$MODE" in
    yes) [[ "$2" == y ]] && return 0 || return 1 ;;
    minimal) return 1 ;;
  esac
  local prompt="[y/N]"; [[ "$2" == y ]] && prompt="[Y/n]"
  read -r -p "$1 $prompt " answer </dev/tty || answer=""
  answer="${answer:-$2}"
  [[ "${answer,,}" == y* ]]
}

clear 2>/dev/null || true
b "GNOMAC · express install"
echo "  macOS 27 look and feel for GNOME. About two minutes."
echo

WITH_DEPS=0; WITH_ICONS=0; WITH_CURSORS=0; WITH_PLY=0; WITH_GDM=0
ask "Install the needed packages with pacman (Inter font, git, curl…)?" y && WITH_DEPS=1
ask "Add the macOS-style cursors (WhiteSur)?" n && WITH_CURSORS=1
ask "Add the macOS-style icon theme (MacTahoe)?" n && WITH_ICONS=1
ask "Install the boot splash (the logo at start-up, needs sudo)?" y && WITH_PLY=1
ask "Install the macOS login screen (needs sudo)?" y && WITH_GDM=1
echo

# 1. The extension, window controls and your settings backup.
args=()
(( WITH_DEPS )) && args+=(--deps)
(( WITH_ICONS )) && args+=(--icons)
(( WITH_CURSORS )) && args+=(--cursors)
info "Installing the extension…"
"$ROOT/install.sh" "${args[@]}" || { warn "install.sh failed: see the messages above."; exit 1; }
ok "Extension installed (your previous settings are saved: ./uninstall.sh brings them back)"

# 2. Boot splash.
if (( WITH_PLY )); then
  info "Boot splash: sudo will ask for your password."
  if sudo cp -r "$ROOT/plymouth/gnomac" /usr/share/plymouth/themes/ \
     && sudo plymouth-set-default-theme gnomac \
     && { sudo mkinitcpio -P 2>/dev/null || sudo update-initramfs -u 2>/dev/null || sudo dracut -f 2>/dev/null; }; then
    ok "Boot splash installed"
  else
    warn "Boot splash not installed (is plymouth installed? sudo pacman -S plymouth)."
  fi
fi

# 3. Login screen.
if (( WITH_GDM )); then
  if [[ "$(basename "$(readlink -f /etc/systemd/system/display-manager.service 2>/dev/null)")" == gdm*.service ]] \
     || command -v gdm >/dev/null; then
    info "Login screen: sudo will ask for your password."
    if sudo "$ROOT/gdm/install-gdm.sh"; then
      ok "Login screen installed"
    else
      warn "Login screen: see the ✗ lines above."
    fi
  else
    warn "GDM was not found (your login manager is another one): login screen skipped."
  fi
fi

echo
b "Done."
echo "  • Log out and back in to load GNOMAC (Wayland cannot reload the shell)."
echo "  • Press Super+Space then type 'guide' for every shortcut."
echo "  • Make it yours: gnome-extensions prefs gnomac@nayzer974.github.io"
echo "    (section Thème), or edit ~/.config/gnomac/user.css: docs/THEMING.md"
echo "  • Undo everything: ./uninstall.sh"
