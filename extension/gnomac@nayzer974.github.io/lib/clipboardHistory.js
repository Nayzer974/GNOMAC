// Clipboard history shared by Spotlight (Clipboard mode) and the Dynamic
// Island. It only exists while at least one module uses it, and is wiped
// when the last one stops: copied passwords never outlive the session UI.
// The data and its rules live in clipboardStore.js (tested apart).

import Meta from 'gi://Meta';
import St from 'gi://St';

import {ClipboardStore} from './clipboardStore.js';

const store = new ClipboardStore();
let selection = null;
let handlerId = 0;

export function startClipboard() {
    if (!store.start())
        return;
    selection = global.display.get_selection();
    handlerId = selection.connect('owner-changed', (_sel, type) => {
        if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
            return;
        // The read is asynchronous: its answer is only kept if the history it
        // was meant for is still the current one.
        const ticket = store.begin();
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => {
            store.remember(text, ticket);
        });
    });
}

export function stopClipboard() {
    if (!store.stop())
        return;
    if (selection && handlerId)
        selection.disconnect(handlerId);
    selection = null;
    handlerId = 0;
}

export const clipboardItems = () => store.items;

export function clearClipboard() {
    store.clear();
}

export function onClipboardChange(callback) {
    return store.onChange(callback);
}

export function copyText(text) {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
}
