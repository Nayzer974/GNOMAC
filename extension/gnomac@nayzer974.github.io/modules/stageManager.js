// Stage Manager, as a simplified version of macOS's: the window you work in
// stays on stage, every other window of the workspace steps aside into a
// strip of cards on the left. Click a card to bring that window on stage; the
// one it replaces goes to the strip.
//
// "Stepping aside" is a minimize (so the Genie animation plays), and the
// windows it minimized are restored when Stage Manager is turned off.
// Super+Ctrl+M toggles it; the `enable-stage-manager` setting only decides
// whether it starts on.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {cascade, press} from '../lib/motion.js';
import {t} from '../lib/i18n.js';

const CARD_WIDTH = 108;

const isStageWindow = window =>
    window && window.get_window_type() === Meta.WindowType.NORMAL && !window.get_transient_for() &&
    !window.is_skip_taskbar() && !window.is_on_all_workspaces();

export class StageManager {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._active = false;
        this._ours = new Set();
        this._ids = [];
    }

    enable() {
        Main.wm.addKeybinding('stage-manager-shortcut', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL, () => this.toggle());
        if (this._settings.get_boolean('enable-stage-manager'))
            this._start();
    }

    disable() {
        Main.wm.removeKeybinding('stage-manager-shortcut');
        this._stop();
    }

    toggle() {
        if (this._active)
            this._stop();
        else
            this._start();
        Main.osdWindowManager?.showAll?.(Gio.ThemedIcon.new('view-dual-symbolic'), this._active
            ? t('Stage Manager on', 'Stage Manager activé')
            : t('Stage Manager off', 'Stage Manager désactivé'));
    }

    // ------------------------------------------------------------ lifecycle

    _start() {
        if (this._active)
            return;
        this._active = true;

        this._strip = new St.BoxLayout({style_class: 'gnomac-stage-strip', vertical: true, reactive: true,
            visible: false});
        const monitor = Main.layoutManager.primaryMonitor;
        this._strip.set_position(monitor.x, monitor.y + Main.panel.height);
        // A left strut keeps maximised windows beside the strip, not under it.
        Main.layoutManager.addChrome(this._strip, {affectsStruts: true, trackFullscreen: true});

        const connect = (object, signal) =>
            this._ids.push([object, object.connect(signal, () => this._queue())]);
        connect(global.display, 'notify::focus-window');
        connect(global.window_manager, 'minimize');
        connect(global.window_manager, 'unminimize');
        connect(global.window_manager, 'destroy');
        connect(global.workspace_manager, 'active-workspace-changed');
        this._queue();
    }

    _stop() {
        if (!this._active)
            return;
        this._active = false;
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._ids = [];
        if (this._idle) {
            GLib.source_remove(this._idle);
            this._idle = 0;
        }
        this._strip?.destroy();
        this._strip = null;
        for (const window of this._ours) {
            try {
                window.unminimize();
            } catch {}
        }
        this._ours.clear();
    }

    // ------------------------------------------------------------- staging

    _queue() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _workspaceWindows() {
        const workspace = global.workspace_manager.get_active_workspace();
        return workspace.list_windows().filter(isStageWindow);
    }

    _refresh() {
        if (!this._active || !this._strip)
            return;
        const focus = global.display.focus_window;
        // Only a real application window takes the stage; focusing a dialog,
        // a popup or the desktop must not push anything aside.
        if (isStageWindow(focus) && !focus.minimized) {
            for (const window of this._workspaceWindows()) {
                if (window !== focus && !window.minimized && !window.is_fullscreen?.()) {
                    this._ours.add(window);
                    window.minimize();
                }
            }
        }
        this._rebuild();
    }

    _rebuild() {
        const windows = this._workspaceWindows().filter(window => window.minimized);
        // Same set as the cards on screen: nothing to redraw.
        const key = windows.map(w => w.get_stable_sequence()).join(',');
        if (key === this._key)
            return;
        this._key = key;

        this._strip.destroy_all_children();
        for (const window of windows)
            this._strip.add_child(this._card(window));
        this._strip.visible = windows.length > 0;
        if (windows.length)
            cascade([...this._strip.get_children()], {delay: 40, duration: 300, from: 0.85});
    }

    _card(window) {
        const tracker = Shell.WindowTracker.get_default();
        const app = tracker.get_window_app(window);
        const column = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
        const icon = app ? app.create_icon_texture(48) : new St.Icon({icon_name: 'application-x-executable', icon_size: 48});
        icon.x_align = Clutter.ActorAlign.CENTER;
        column.add_child(icon);
        const label = new St.Label({style_class: 'gnomac-stage-title', text: window.get_title() ?? '',
            x_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        column.add_child(label);
        const card = new St.Button({style_class: 'gnomac-stage-card', child: column, can_focus: false,
            width: CARD_WIDTH});
        press(card, {down: 0.94});
        card.connect('clicked', () => {
            this._ours.delete(window);
            Main.activateWindow(window);
        });
        return card;
    }
}
