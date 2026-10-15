// GNOME Shell keeps, for each popup menu, the "settings" items added with
// addSettingsAction() (Network, Bluetooth, power profiles... in the quick
// settings) and sets their visibility at every change of session mode, i.e. at
// every lock and unlock. When such an item is destroyed (a network device or a
// Bluetooth device goes away), GNOME forgets to drop it from that list: the next
// lock then writes to a destroyed object, and the journal fills with a warning
// and a stack trace for each one (hundreds over a few days, each costing time at
// the very moment the screen locks or unlocks).
//
// installMenuGuard() makes the items remove themselves from the list when they
// are destroyed: the ones that exist now and the ones built later.

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const hooked = new WeakSet();

function forget(item) {
    const settings = item._parent?._settingsActions;
    if (!settings)
        return;
    for (const id of Object.keys(settings)) {
        if (settings[id] === item)
            delete settings[id];
    }
}

function hook(item) {
    if (hooked.has(item))
        return;
    hooked.add(item);
    item.connect('destroy', () => forget(item));
}

function walk(actor, visit, depth = 0) {
    if (depth > 12)
        return;
    visit(actor);
    for (const child of actor.get_children?.() ?? [])
        walk(child, visit, depth + 1);
}

export function installMenuGuard() {
    const proto = PopupMenu.PopupBaseMenuItem.prototype;
    const original = proto._init;
    proto._init = function (...args) {
        original.apply(this, args);
        hook(this);
    };
    // The items that already exist (the quick settings were built before us).
    try {
        walk(Main.layoutManager.uiGroup, actor => {
            if (actor instanceof PopupMenu.PopupBaseMenuItem)
                hook(actor);
        });
    } catch (e) {
        logError(e, 'GNOMAC menu guard');
    }
    return () => {
        if (proto._init !== original)
            proto._init = original;
    };
}
