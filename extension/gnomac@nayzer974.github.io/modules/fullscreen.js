// True full screen, on any window, from the keyboard (Super+Ctrl+F, like the
// macOS Control+Command+F; Super+F11 too).
//
// GNOME has no shortcut for it by default, and most applications only go full
// screen through their own button or F11 (Files, Settings, a terminal and
// plenty of others do not at all). This asks the window manager itself, so it
// works on whatever window has the focus, whatever the application supports.
// A window that is full screen covers its monitor: the menu bar, the dock and
// the stage strip step aside (GNOME's own tracking), and the island too,
// even if its "hide over full-screen windows" setting is off.
// The same shortcut leaves full screen; so does the application's own way.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {t} from '../lib/i18n.js';

const KEY = 'fullscreen-shortcut';
// What can go full screen: not the desktop, docks, menus, tooltips.
const ELIGIBLE = new Set([Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY]);

export class TrueFullscreen {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._window = null;
        this._ids = [];
    }

    enable() {
        Main.wm.addKeybinding(KEY, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL, () => this.toggle());
        this._extension.trueFullscreen = null;
    }

    disable() {
        Main.wm.removeKeybinding(KEY);
        this._release();
    }

    toggle() {
        const window = global.display.focus_window;
        if (!window || !ELIGIBLE.has(window.get_window_type()))
            return;
        if (window.is_fullscreen()) {
            // Leaving: the island comes back before the window shrinks.
            this._release();
            window.unmake_fullscreen();
            return;
        }
        this._release();
        // The island steps aside while this window is full screen on its monitor.
        this._window = window;
        this._extension.trueFullscreen = window;
        window.make_fullscreen();
        if (!window.is_fullscreen()) {
            this._release();
            Main.notify('GNOMAC', t('This window does not accept full screen.', 'Cette fenêtre n’accepte pas le plein écran.'));
            return;
        }
        // Whoever ends it (this shortcut, the application, closing the window).
        this._ids = [
            [window, window.connect('notify::fullscreen', () => {
                if (!window.is_fullscreen())
                    this._release();
            })],
            [window, window.connect('unmanaged', () => this._release())],
        ];
    }

    _release() {
        for (const [window, id] of this._ids) {
            try {
                window.disconnect(id);
            } catch {}
        }
        this._ids = [];
        this._window = null;
        this._extension.trueFullscreen = null;
        // The island follows at once, whichever signal comes first.
        this._extension._modules?.find(m => m.constructor.name === 'DynamicIsland')?._syncFullscreen?.();
    }
}
