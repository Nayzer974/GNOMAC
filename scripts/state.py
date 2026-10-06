#!/usr/bin/env python3
"""Remembers the GNOME settings GNOMAC changes, so uninstall.sh can put them back.

  state.py save                  record the current values (only the first time)
  state.py disabled UUID         note an extension the installer turned off
  state.py restore               put every recorded value back, forget GNOMAC's own settings

Values are read and written with dconf, which tells "never set" (the key
follows GNOME's default) from "set to something": a key that was never set is
reset, not frozen to today's default.
"""
import ast
import json
import os
import subprocess
import sys

UUID = "gnomac@nayzer974.github.io"
STATE = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "gnomac", "backup.json")

# Everything install.sh, the extension's Appearance section or --icons/--cursors can touch.
KEYS = [
    "/org/gnome/desktop/wm/preferences/button-layout",
    "/org/gnome/desktop/wm/preferences/titlebar-font",
    "/org/gnome/desktop/interface/font-name",
    "/org/gnome/desktop/interface/document-font-name",
    "/org/gnome/desktop/interface/icon-theme",
    "/org/gnome/desktop/interface/cursor-theme",
    "/org/gnome/desktop/interface/color-scheme",
    "/org/gnome/desktop/interface/accent-color",
    "/org/gnome/desktop/interface/enable-animations",
    "/org/gnome/desktop/wm/keybindings/switch-input-source",
    "/org/gnome/desktop/wm/keybindings/switch-input-source-backward",
    "/org/gnome/shell/disable-user-extensions",
]


def dconf(*args):
    return subprocess.run(["dconf", *args], capture_output=True, text=True)


def read(path):
    out = dconf("read", path).stdout.strip()
    return out or None


def load():
    try:
        with open(STATE, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def store(data):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)


def enabled_extensions():
    raw = read("/org/gnome/shell/enabled-extensions") or "[]"
    if raw.startswith("@as"):
        raw = raw[3:].strip()
    try:
        return list(ast.literal_eval(raw))
    except (ValueError, SyntaxError):
        return []


def write_extensions(items):
    dconf("write", "/org/gnome/shell/enabled-extensions", repr(items))


def save():
    if load() is not None:
        print("backup already exists, keeping the original values:", STATE)
        return
    store({"keys": {path: read(path) for path in KEYS}, "disabled": []})
    print("recorded the current settings in", STATE)


def disabled(uuid):
    data = load() or {"keys": {}, "disabled": []}
    if uuid not in data["disabled"]:
        data["disabled"].append(uuid)
    store(data)


def restore():
    data = load()
    if data is None:
        print("no backup found: resetting the keys GNOMAC changes to GNOME's defaults")
        data = {"keys": {path: None for path in KEYS}, "disabled": []}
    for path, value in data["keys"].items():
        if value is None:
            dconf("reset", path)
        else:
            dconf("write", path, value)
    # Our own extension settings go away with the extension.
    dconf("reset", "-f", "/org/gnome/shell/extensions/gnomac/")
    # Leave GNOMAC out of the enabled list, give back the docks the installer
    # turned off, and keep whatever else the user enabled in the meantime.
    items = [item for item in enabled_extensions() if item != UUID]
    for uuid in data["disabled"]:
        if uuid not in items:
            items.append(uuid)
    write_extensions(items)
    try:
        os.remove(STATE)
    except OSError:
        pass
    print("settings restored")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "save":
        save()
    elif command == "disabled" and len(sys.argv) > 2:
        disabled(sys.argv[2])
    elif command == "restore":
        restore()
    else:
        sys.exit(__doc__)
