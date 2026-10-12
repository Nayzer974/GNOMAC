#!/usr/bin/env bash
# Start GNOME Shell headless with the extension from this checkout, in a
# throw-away session (own D-Bus, own settings, own data dir), drive it with
# tools/smoke-driver.js and report what GNOMAC logs. Your real session and
# settings are not touched.
#
#   tools/smoke-test.sh [max-seconds]       default: 150
#   SMOKE_KEEP=1 tools/smoke-test.sh        also keep the full log
#   SMOKE_MONITORS='1280x800 1024x768' tools/smoke-test.sh   several monitors
#   GNOMAC_SMOKE_SHOT=DIR tools/smoke-test.sh   also save screenshots in DIR
#
# Exit status: 0 = loaded, driven to the end, no error; 1 = errors or the
# driver did not finish; 2 = the test could not run.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="gnomac@nayzer974.github.io"
MAX_SECONDS="${1:-150}"

command -v gnome-shell >/dev/null || { echo "gnome-shell not found" >&2; exit 2; }
command -v dbus-run-session >/dev/null || { echo "dbus-run-session not found" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
EXT="$WORK/data/gnome-shell/extensions/$UUID"
mkdir -p "$WORK/data/gnome-shell/extensions" "$WORK/config/glib-2.0/settings" "$WORK/cache" "$WORK/Desktop"
cp -r "$ROOT/extension/$UUID" "$EXT"
cp "$ROOT/tools/smoke-driver.js" "$EXT/smoke-driver.js"
glib-compile-schemas "$EXT/schemas"

# Start the driver a few seconds after the extension is enabled.
python3 - "$EXT/extension.js" <<'EOF'
import sys
path = sys.argv[1]
src = open(path).read()
hook = """        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {
            import('./smoke-driver.js').then(m => m.run(this))
                .catch(e => console.log(`GNOMAC-SMOKE: FAIL import: ${e}`));
            return GLib.SOURCE_REMOVE;
        });
"""
marker = "        this._start();\n"
assert marker in src, "extension.js changed: cannot place the smoke hook"
open(path, 'w').write(src.replace(marker, marker + hook, 1))
EOF

# Wallpapers for the picker and a few launchers for the dock to build.
mkdir -p "$WORK/Pictures/Wallpapers"
python3 - "$WORK/Pictures/Wallpapers" <<'EOF2'
import struct, sys, zlib

def png(path, w, h, color):
    raw = b''.join(b'\x00' + b''.join(bytes(color(x, y)) for x in range(w)) for y in range(h))

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    header = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
                           + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

for i in range(4):
    png(f"{sys.argv[1]}/wall{i}.png", 480, 300,
        lambda x, y, i=i: ((x * 255) // 480, (y * 255) // 300, 60 + 50 * i))
EOF2

favorites=""
for app in org.gnome.Nautilus org.gnome.Console org.gnome.TextEditor org.gnome.Calculator org.gnome.Settings; do
    [[ -f "/usr/share/applications/$app.desktop" ]] && favorites+="'$app.desktop', "
done

cat > "$WORK/config/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$UUID']
disable-user-extensions=false
welcome-dialog-last-shown-version='999'
favorite-apps=[${favorites%, }]
EOF
{
    echo "XDG_DESKTOP_DIR=\"$WORK/Desktop\""
    echo "XDG_PICTURES_DIR=\"$WORK/Pictures\""
} > "$WORK/config/user-dirs.dirs"

# SMOKE_MONITORS="1280x800 1920x1080" runs with several virtual monitors.
MONITOR_ARGS=()
for size in ${SMOKE_MONITORS:-1280x800}; do
    MONITOR_ARGS+=(--virtual-monitor "$size")
done

LOG="$WORK/shell.log"
env XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" XDG_CACHE_HOME="$WORK/cache" \
    GSETTINGS_BACKEND=keyfile \
    timeout "$((MAX_SECONDS + 15))" dbus-run-session -- \
    timeout "$MAX_SECONDS" gnome-shell --headless --wayland --no-x11 \
        --wayland-display gnomac-smoke "${MONITOR_ARGS[@]}" > "$LOG" 2>&1

if [[ "${SMOKE_KEEP:-0}" == 1 ]]; then
    cp "$LOG" "${TMPDIR:-/tmp}/gnomac-smoke.log"
    echo "full log: ${TMPDIR:-/tmp}/gnomac-smoke.log"
fi

# Only what happens while the shell is running counts: objects are destroyed
# in no particular order while it shuts down.
RUN="$WORK/run.log"
awk '/Shutting down GNOME Shell/ {exit} {print}' "$LOG" > "$RUN"
echo "---- $(wc -l < "$RUN") log lines before shutdown, $(grep -c 'GNOMAC-SMOKE:' "$RUN") driver lines"

status=0
grep -E "GNOMAC-SMOKE: (modules|done|after reloads)" "$RUN" | cut -c1-200

if ! grep -q "GNOMAC-SMOKE: done" "$RUN"; then
    echo "!! the driver did not reach its end"
    status=1
fi

errors="$(grep -E "GNOMAC-SMOKE: FAIL|JS ERROR|Gjs-CRITICAL|-CRITICAL|TypeError|ReferenceError|SyntaxError|has been already disposed|is not a function|is not defined|GNOMAC [a-z ]*:|GNOMAC:" "$RUN" \
    | sed -E 's/^\(gnome-shell:[0-9]+\): //; s/[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+: //' \
    | grep -vE "KMS thread|search provider" || true)"
if [[ -n "$errors" ]]; then
    status=1
    echo "---- errors (count, message)"
    echo "$errors" | cut -c1-260 | sort | uniq -c | sort -rn | head -40
fi

(( status == 0 )) && echo "RESULT: ok" || echo "RESULT: FAILED"
exit "$status"
