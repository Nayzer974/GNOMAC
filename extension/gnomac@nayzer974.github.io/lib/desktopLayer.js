// The desktop layer: one transparent, full-screen layer that desktop icons and
// widgets live on, and that takes the desktop's own clicks (so the right-click
// menu is ours, and the same with or without a wallpaper window).
//
// WHERE IT SITS. At the very bottom of the window group: above the wallpaper,
// below every window. A wallpaper that is itself a window (Hidamari and the
// like: windows of type DESKTOP, or named like a wallpaper app) would hide
// anything behind it, so the layer is kept just above such a window: the icons
// and widgets stay visible and clickable over a video wallpaper.
//
// Several modules share it (acquire / release); it is built with the first and
// destroyed with the last.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {t} from './i18n.js';

function run(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch {
        Main.notify('GNOMAC', `${t('Could not start:', 'Lancement impossible :')} ${argv[0]}`);
    }
}

const WALLPAPER_WINDOW = /hidamari|wallpaper|paperview|xwinwrap|mpvpaper|komorebi|livewallpaper/i;

class DesktopLayer {
    constructor() {
        this._users = new Set();
        this.actor = null;
        this.pressHandlers = new Set();     // (event) => true when it took the press
        this.menuProviders = new Set();     // (menu, add, separator) => void, in order
        this.keyHandlers = new Set();       // (event) => EVENT_STOP / EVENT_PROPAGATE
    }

    acquire(owner) {
        this._users.add(owner);
        if (!this.actor)
            this._build();
        return this;
    }

    release(owner) {
        this._users.delete(owner);
        if (!this._users.size)
            this._destroy();
    }

    _build() {
        this.actor = new St.Widget({name: 'gnomacDesktop', reactive: true, can_focus: true});
        this._size();
        global.window_group.add_child(this.actor);
        this.actor.connect('button-press-event', (_a, event) => this._onPress(event));
        // The menu opens when the right button is RELEASED (as GNOME's own does):
        // opened on the press, the release would land on its first entry.
        this.actor.connect('button-release-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY || !this._menuAt)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = this._menuAt;
            this._menuAt = null;
            this.openDesktopMenu(x, y);
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('key-press-event', (_a, event) => {
            for (const handler of this.keyHandlers) {
                if (handler(event) === Clutter.EVENT_STOP)
                    return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._ids = [
            [global.display, global.display.connect('restacked', () => this._queuePin())],
            [global.display, global.display.connect('window-created', () => this._queuePin())],
            [global.window_manager, global.window_manager.connect('map', () => this._queuePin())],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._size())],
        ];
        this._pin();
    }

    _destroy() {
        for (const [object, id] of this._ids ?? []) {
            try {
                object.disconnect(id);
            } catch {}
        }
        this._ids = [];
        if (this._pinLater) {
            GLib.source_remove(this._pinLater);
            this._pinLater = 0;
        }
        this.closeMenu();
        this.actor?.destroy();
        this.actor = null;
    }

    _size() {
        this.actor?.set_position(0, 0);
        this.actor?.set_size(global.stage.width, global.stage.height);
    }

    _isWallpaperWindow(window) {
        try {
            const text = `${window.get_wm_class() ?? ''} ${window.get_gtk_application_id() ?? ''} ${window.get_title() ?? ''}`;
            return window.get_window_type() === Meta.WindowType.DESKTOP || WALLPAPER_WINDOW.test(text);
        } catch {
            return false;
        }
    }

    _queuePin() {
        if (this._pinLater)
            return;
        this._pinLater = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pinLater = 0;
            this._pin();
            return GLib.SOURCE_REMOVE;
        });
    }

    _pin() {
        const layer = this.actor;
        const group = global.window_group;
        if (!layer || layer.get_parent() !== group)
            return;
        const children = group.get_children();
        let above = null;
        let best = -1;
        for (const actor of global.get_window_actors()) {
            if (!this._isWallpaperWindow(actor.meta_window))
                continue;
            const index = children.indexOf(actor);
            if (index > best) {
                best = index;
                above = actor;
            }
        }
        if (above) {
            if (children[best + 1] !== layer)
                group.set_child_above_sibling(layer, above);
        } else {
            // The wallpapers are a group inside the window group, at the bottom:
            // the layer goes right above it.
            const background = Main.layoutManager._backgroundGroup;
            const index = children.indexOf(background);
            if (children[index + 1] !== layer)
                group.set_child_above_sibling(layer, background);
        }
    }

    focus() {
        this.actor?.grab_key_focus();
    }

    _onPress(event) {
        // Only presses on the layer itself; icons and widgets handle their own.
        if (event.get_source() !== this.actor)
            return Clutter.EVENT_PROPAGATE;
        this.focus();
        const [x, y] = event.get_coords();
        if (event.get_button() === Clutter.BUTTON_SECONDARY) {
            this._menuAt = [x, y];
            return Clutter.EVENT_STOP;
        }
        this.closeMenu();
        for (const handler of this.pressHandlers) {
            if (handler(event))
                return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_STOP;
    }

    // ---------------------------------------------------------------- menus

    closeMenu() {
        if (this._menu) {
            const menu = this._menu;
            this._menu = null;
            try {
                menu.destroy();
            } catch {}
        }
        this._anchor?.destroy();
        this._anchor = null;
    }

    // A menu at the pointer. build(menu, add, separator) fills it.
    popup(x, y, build) {
        this.closeMenu();
        const anchor = new St.Widget({width: 1, height: 1, x, y, reactive: false});
        Main.uiGroup.add_child(anchor);
        const menu = new PopupMenu.PopupMenu(anchor, 0, St.Side.TOP);
        menu.actor.add_style_class_name('gnomac-desk-menu');
        Main.uiGroup.add_child(menu.actor);
        const manager = new PopupMenu.PopupMenuManager(anchor);
        manager.addMenu(menu);
        const add = (label, action, target = menu) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => action());
            target.addMenuItem(item);
            return item;
        };
        const separator = () => menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        build(menu, add, separator);
        menu.connect('open-state-changed', (_m, open) => {
            if (!open) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this._menu === menu)
                        this.closeMenu();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        this._menu = menu;
        this._anchor = anchor;
        menu.open(true);
    }

    openDesktopMenu(x, y) {
        this.popup(x, y, (menu, add, separator) => {
            for (const provider of this.menuProviders)
                provider(menu, add, separator);
            separator();
            add(t('Change Background…', 'Modifier l’arrière-plan…'), () => run(['gnome-control-center', 'background']));
            add(t('Display Settings…', 'Paramètres d’affichage…'), () => run(['gnome-control-center', 'display']));
            add(t('GNOMAC Preferences…', 'Préférences de GNOMAC…'), () => run(['gnome-extensions', 'prefs', 'gnomac@nayzer974.github.io']));
        });
    }
}

export const desktopLayer = new DesktopLayer();
