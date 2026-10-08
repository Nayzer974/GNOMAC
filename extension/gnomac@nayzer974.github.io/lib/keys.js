// Sends keyboard shortcuts to the focused window, so menu bar items like
// Edit › Copy act on the app the way the real shortcut would.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

let device = null;

function getDevice() {
    if (!device) {
        const seat = (global.stage.context?.get_backend?.() ?? Clutter.get_default_backend()).get_default_seat();
        device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }
    return device;
}

// Shortcuts waiting for the window to take the focus back.
const pending = new Set();

export function cancelShortcuts() {
    for (const id of pending)
        GLib.source_remove(id);
    pending.clear();
}

const MODIFIERS = {
    ctrl: Clutter.KEY_Control_L,
    shift: Clutter.KEY_Shift_L,
    alt: Clutter.KEY_Alt_L,
    super: Clutter.KEY_Super_L,
};

// combo: e.g. "ctrl+shift+z", "ctrl+comma", "F1", "F11".
function parse(combo) {
    const parts = combo.split('+');
    const key = parts.pop();
    const mods = parts.map(m => MODIFIERS[m.toLowerCase()]).filter(Boolean);
    let keyval = Clutter[`KEY_${key}`];
    if (keyval === undefined && key.length === 1)
        keyval = Clutter.unicode_to_keysym(key.charCodeAt(0));
    return {mods, keyval};
}

// Menus hold a grab while open; send once the window has focus back.
export function sendShortcut(combo, delay = 140) {
    const {mods, keyval} = parse(combo);
    if (!keyval)
        return;
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        pending.delete(id);
        const dev = getDevice();
        let time = GLib.get_monotonic_time();
        for (const mod of mods)
            dev.notify_keyval(time++, mod, Clutter.KeyState.PRESSED);
        dev.notify_keyval(time++, keyval, Clutter.KeyState.PRESSED);
        dev.notify_keyval(time++, keyval, Clutter.KeyState.RELEASED);
        for (const mod of [...mods].reverse())
            dev.notify_keyval(time++, mod, Clutter.KeyState.RELEASED);
        return GLib.SOURCE_REMOVE;
    });
    pending.add(id);
}

// "ctrl+shift+z" -> "⇧⌃Z", the macOS way of writing shortcuts.
export function shortcutLabel(combo) {
    const parts = combo.split('+');
    const key = parts.pop();
    const symbols = {ctrl: '⌃', shift: '⇧', alt: '⌥', super: '⌘'};
    const order = ['ctrl', 'alt', 'shift', 'super'];
    const mods = parts.map(p => p.toLowerCase()).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const names = {comma: ',', period: '.', Return: '↩', Escape: '⎋', Left: '←', Right: '→',
        Up: '↑', Down: '↓', space: '␣', Delete: '⌫', Tab: '⇥', plus: '+', minus: '−'};
    const label = names[key] ?? (key.length === 1 ? key.toUpperCase() : key);
    return mods.map(m => symbols[m]).join('') + label;
}

export function destroyKeys() {
    device = null;
}
