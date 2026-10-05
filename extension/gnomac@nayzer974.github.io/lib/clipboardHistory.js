// Clipboard history shared by Spotlight (Clipboard mode) and the Dynamic
// Island. It only exists while at least one module uses it, and is wiped
// when the last one stops: copied passwords never outlive the session UI.

import Meta from 'gi://Meta';
import St from 'gi://St';

const MAX = 30;

let users = 0;
let items = [];
let selection = null;
let handlerId = 0;
const listeners = new Set();

export function startClipboard() {
    if (users++ > 0)
        return;
    selection = global.display.get_selection();
    handlerId = selection.connect('owner-changed', (_sel, type) => {
        if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
            return;
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => {
            if (!text || !text.trim())
                return;
            items = [text, ...items.filter(entry => entry !== text)].slice(0, MAX);
            for (const listener of listeners)
                listener();
        });
    });
}

export function stopClipboard() {
    if (--users > 0)
        return;
    users = 0;
    if (selection && handlerId)
        selection.disconnect(handlerId);
    selection = null;
    handlerId = 0;
    items = [];
}

export const clipboardItems = () => items;

export function clearClipboard() {
    items = [];
    for (const listener of listeners)
        listener();
}

export function onClipboardChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

export function copyText(text) {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
}
