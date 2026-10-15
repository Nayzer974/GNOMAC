// The clipboard history as plain data, with no link to the shell: it is
// shared by Spotlight and the Dynamic Island (lib/clipboardHistory.js feeds
// it), and it only exists while at least one of them uses it.
//
// Copied passwords must not outlive the session UI. Reading the clipboard is
// asynchronous: a read started before the last user stopped can answer after
// the history was wiped. Every read therefore takes a ticket (begin()) and is
// dropped by remember() when that ticket is out of date.

const MAX = 30;

export class ClipboardStore {
    constructor() {
        this._users = 0;
        this._generation = 0;
        this._items = [];
        this._listeners = new Set();
    }

    // true for the first user: the caller then starts watching the clipboard.
    start() {
        if (this._users++ > 0)
            return false;
        this._generation++;
        return true;
    }

    // true for the last user: the history is wiped and watching must stop.
    stop() {
        if (--this._users > 0)
            return false;
        this._users = 0;
        // Reads still in flight now carry an old ticket.
        this._generation++;
        this._items = [];
        return true;
    }

    // A ticket for one clipboard read.
    begin() {
        return this._generation;
    }

    // Records the text a read returned; false when it is empty or too late.
    remember(text, ticket) {
        if (this._users === 0 || ticket !== this._generation)
            return false;
        if (!text || !text.trim())
            return false;
        this._items = [text, ...this._items.filter(entry => entry !== text)].slice(0, MAX);
        this._notify();
        return true;
    }

    get items() {
        return this._items;
    }

    clear() {
        // A read in flight must not put back what was just cleared.
        this._generation++;
        this._items = [];
        this._notify();
    }

    onChange(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _notify() {
        for (const listener of this._listeners)
            listener();
    }
}
