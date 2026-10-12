// A menu bar on every screen but the primary one, as on macOS: the focused
// app's name on the left, the clock on the right. GNOME's own panel only
// exists on the primary monitor, so without this the other screens have none.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {t} from '../lib/i18n.js';

const FALLBACK_HEIGHT = 26;

export class SecondaryBars {
    constructor(extension) {
        this._extension = extension;
        this._bars = [];
    }

    enable() {
        this._tracker = Shell.WindowTracker.get_default();
        this._focusId = this._tracker.connect('notify::focus-app', () => this._syncApp());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._build());
        this._build();
    }

    disable() {
        if (this._focusId) {
            this._tracker.disconnect(this._focusId);
            this._focusId = 0;
        }
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        this._clear();
        this._tracker = null;
    }

    _clear() {
        if (this._clockTimeout) {
            GLib.source_remove(this._clockTimeout);
            this._clockTimeout = 0;
        }
        for (const {actor} of this._bars) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._bars = [];
    }

    _build() {
        this._clear();
        const height = Main.panel?.height || FALLBACK_HEIGHT;
        Main.layoutManager.monitors.forEach((monitor, index) => {
            if (index === Main.layoutManager.primaryIndex)
                return;
            const actor = new St.BoxLayout({
                style_class: 'gnomac-secondary-bar',
                x: monitor.x, y: monitor.y, width: monitor.width, height,
                reactive: false,
            });
            const app = new St.Label({style_class: 'gnomac-secondary-app', y_align: Clutter.ActorAlign.CENTER});
            const spacer = new St.Widget({x_expand: true});
            const clock = new St.Label({style_class: 'gnomac-secondary-clock', y_align: Clutter.ActorAlign.CENTER});
            actor.add_child(app);
            actor.add_child(spacer);
            actor.add_child(clock);
            // Room is kept for it, and it steps aside for a full-screen window.
            Main.layoutManager.addChrome(actor, {affectsStruts: true, trackFullscreen: true});
            this._bars.push({actor, app, clock});
        });
        this._syncApp();
        this._updateClock();
    }

    _syncApp() {
        const app = this._tracker?.focus_app;
        const name = app ? app.get_name() : t('Desktop', 'Bureau');
        for (const bar of this._bars)
            bar.app.text = name;
    }

    _updateClock() {
        if (!this._bars.length)
            return;
        const now = GLib.DateTime.new_now_local();
        for (const bar of this._bars)
            bar.clock.text = now.format('%a %-d %b  %H:%M');
        // Re-arm on the next minute boundary.
        this._clockTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60 - now.get_second(), () => {
            this._clockTimeout = 0;
            this._updateClock();
            return GLib.SOURCE_REMOVE;
        });
    }
}
