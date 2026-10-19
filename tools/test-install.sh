#!/usr/bin/env bash
# Runs install.sh --update and uninstall.sh in a throw-away home (own D-Bus,
# in-memory settings), and the login screen sync script as an ordinary user, to
# check that:
#   - a gnomac.css of your own survives install and uninstall,
#   - GNOMAC's own style files are installed and removed again,
#   - the login screen sync follows a non-default XDG data folder,
#   - the systemd units carry the folders they are given.
# Nothing of your real session is touched. Exit status 1 if a check fails.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="gnomac@nayzer974.github.io"
command -v dbus-run-session >/dev/null || { echo "dbus-run-session not found, skipped"; exit 0; }
command -v gnome-shell >/dev/null || { echo "gnome-shell not found, skipped"; exit 0; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failed=0
check() {
    if [[ "$2" == ok ]]; then echo "ok   $1"; else echo "FAIL $1  $3"; failed=1; fi
}
same() { cmp -s "$1" "$2" && echo ok || echo bad; }

# One isolated environment per scenario.
sandbox() {   # sandbox NAME -> prints the HOME
    local home="$WORK/$1"
    mkdir -p "$home/config" "$home/data"
    echo "$home"
}
run() {       # run HOME script args...
    local home="$1"; shift
    env -i PATH="$PATH" HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_DATA_HOME="$home/data" \
        GSETTINGS_BACKEND=memory DCONF_PROFILE=/dev/null \
        dbus-run-session -- "$@" >"$home/out.log" 2>&1
}

# 1. Fresh install, then uninstall: our files come and go.
h="$(sandbox fresh)"
run "$h" "$ROOT/install.sh" --update
for v in 3.0 4.0; do
    [[ -f "$h/config/gtk-$v/gnomac.css" ]] && r=ok || r=bad
    check "fresh install puts GNOMAC's gtk-$v style in place" "$r" "$(tail -3 "$h/out.log")"
done
[[ -f "$h/data/gnome-shell/extensions/$UUID/extension.js" ]] && r=ok || r=bad
check "fresh install copies the extension" "$r"
run "$h" "$ROOT/uninstall.sh"
for v in 3.0 4.0; do
    [[ ! -e "$h/config/gtk-$v/gnomac.css" && ! -e "$h/config/gtk-$v/gtk.css" ]] && r=ok || r=bad
    check "uninstall removes GNOMAC's gtk-$v style and the empty gtk.css" "$r" "$(ls "$h/config/gtk-$v" 2>&1)"
done

# 2. A gnomac.css of your own is kept, through an update too, and given back.
h="$(sandbox own)"
for v in 3.0 4.0; do
    mkdir -p "$h/config/gtk-$v"
    printf '/* my own tweaks */\nwindow { background: red; }\n' > "$h/config/gtk-$v/gnomac.css"
    printf '@import url("gnomac.css");\n' > "$h/config/gtk-$v/gtk.css"
    cp "$h/config/gtk-$v/gnomac.css" "$h/own-$v.css"
done
run "$h" "$ROOT/install.sh" --update
run "$h" "$ROOT/install.sh" --update   # an update must not replace the backup with GNOMAC's file
for v in 3.0 4.0; do
    r="$(same "$h/own-$v.css" "$h/config/gtk-$v/gnomac.css.user-backup")"
    check "install keeps your own gnomac.css (gtk-$v) aside, also after an update" "$r"
    head -n 3 "$h/config/gtk-$v/gnomac.css" | grep -q GNOMAC && r=ok || r=bad
    check "and puts GNOMAC's style in its place (gtk-$v)" "$r"
done
run "$h" "$ROOT/uninstall.sh"
for v in 3.0 4.0; do
    r="$(same "$h/own-$v.css" "$h/config/gtk-$v/gnomac.css")"
    check "uninstall gives your own gnomac.css back (gtk-$v)" "$r"
    grep -qF '@import url("gnomac.css");' "$h/config/gtk-$v/gtk.css" 2>/dev/null && r=ok || r=bad
    check "and leaves the import line you already had (gtk-$v)" "$r"
done

# 3. Login screen sync with a data folder that is not ~/.local/share.
h="$(sandbox gdm)"
src="$h/elsewhere/gnome-shell/extensions/$UUID"
mkdir -p "$src"
cp -r "$ROOT/extension/$UUID/." "$src/"
dest="$h/system/extensions/$UUID"
GNOMAC_SYNC_SRC="$src" GNOMAC_SYNC_DEST="$dest" bash "$ROOT/gdm/sync-login.sh" tester >"$h/sync.log" 2>&1
[[ -f "$dest/extension.js" && -f "$dest/schemas/gschemas.compiled" ]] && r=ok || r=bad
check "login screen sync copies from GNOMAC_SYNC_SRC and compiles the schema" "$r" "$(cat "$h/sync.log")"
ln -s /etc/passwd "$src/evil"
GNOMAC_SYNC_SRC="$src" GNOMAC_SYNC_DEST="$dest.2" bash "$ROOT/gdm/sync-login.sh" tester >"$h/sync2.log" 2>&1
status=$?
[[ $status -ne 0 && ! -d "$dest.2" ]] && grep -q "symbolic links" "$h/sync2.log" && r=ok || r=bad
check "login screen sync refuses a folder with symbolic links" "$r" "$(cat "$h/sync2.log")"

# shellcheck source=gdm/sync-units.sh
source "$ROOT/gdm/sync-units.sh"
service="$(sync_service_unit /usr/share/gnomac/sync-login.sh tester /srv/data "/usr/share/gnome-shell/extensions/$UUID" "$UUID")"
path="$(sync_path_unit /srv/config)"
grep -q "^Environment=GNOMAC_SYNC_SRC=/srv/data/gnome-shell/extensions/$UUID\$" <<<"$service" && r=ok || r=bad
check "the service unit passes the user's data folder" "$r" "$service"
grep -q "^Environment=GNOMAC_SYNC_DEST=/usr/share/gnome-shell/extensions/$UUID\$" <<<"$service" && r=ok || r=bad
check "the service unit passes the destination" "$r"
grep -q "^PathChanged=/srv/config/gnomac/installed.json\$" <<<"$path" && r=ok || r=bad
check "the path unit watches the user's config folder" "$r" "$path"

echo
(( failed )) && { echo "INSTALL TESTS FAILED"; exit 1; }
echo "all install tests passed"
