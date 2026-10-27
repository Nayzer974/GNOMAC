// What the screen really is: resolution and refresh rate of each monitor, read
// from Mutter's DisplayConfig service (the same source as GNOME Settings).
// Nothing is assumed: until the answer arrives, or if it cannot be read,
// `refreshHz` is null ("N/A"), never 60.
//
// Animations do not depend on it: every motion is a duration on the monotonic
// clock (lib/animationTimeline.js), so 420 ms is 420 ms at 60 or at 144 Hz;
// only the number of frames in it changes.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {applyArguments, parseState, planLayout} from './displayLayout.js';

class DisplayInfo {
    constructor() {
        this.monitors = [];           // [{connector, width, height, refreshHz, primary}]
        this.state = null;            // {serial, displays}: what lib/displayLayout.js plans from
        this._id = 0;
        this._timeout = 0;
    }

    // Refresh rate of the primary monitor, in Hz, or null when unknown.
    get refreshHz() {
        const primary = this.monitors.find(m => m.primary) ?? this.monitors[0];
        return primary?.refreshHz ?? null;
    }

    get resolution() {
        const primary = this.monitors.find(m => m.primary) ?? this.monitors[0];
        return primary ? `${primary.width}x${primary.height}` : null;
    }

    start() {
        if (this._id)
            return;
        this.refresh();
        this._id = Main.layoutManager.connect('monitors-changed', () => this.refresh());
    }

    stop() {
        if (this._id) {
            Main.layoutManager.disconnect(this._id);
            this._id = 0;
        }
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
    }

    refresh(done = null) {
        Gio.DBus.session.call('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig', 'GetCurrentState', null, null,
            Gio.DBusCallFlags.NONE, 2000, null, (conn, res) => {
                try {
                    const raw = conn.call_finish(res).recursiveUnpack();
                    this.monitors = this._parse(raw);
                    this.state = parseState(raw);
                } catch (e) {
                    this.monitors = [];
                    this.state = null;
                }
                done?.(this.monitors);
            });
    }

    // Changes the layout: action 'primary' | 'off' | 'on' | 'only' | 'place' |
    // 'mirror' | 'extend' (see lib/displayLayout.js; `options` is for 'place'). The state is read again first: Mutter refuses
    // a request made from an out-of-date serial. Rejects with the reason.
    apply(action, connector = null, options = {}) {
        return new Promise((resolve, reject) => {
            this.refresh(() => {
                if (!this.state) {
                    reject(new Error('the displays cannot be read'));
                    return;
                }
                const plan = planLayout(this.state.displays, action, connector, options);
                if (plan.error) {
                    reject(new Error(plan.error));
                    return;
                }
                const params = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', applyArguments(this.state.serial, plan.logical));
                Gio.DBus.session.call('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
                    'org.gnome.Mutter.DisplayConfig', 'ApplyMonitorsConfig', params, null,
                    Gio.DBusCallFlags.NONE, 5000, null, (conn, res) => {
                        try {
                            conn.call_finish(res);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
            });
        });
    }

    // GetCurrentState: (serial, monitors, logical_monitors, properties).
    _parse([_serial, monitors, logical]) {
        const primaries = new Set();
        for (const lm of logical) {
            if (lm[4])
                lm[5].forEach(spec => primaries.add(spec[0]));
        }
        return monitors.map(([[connector], modes]) => {
            const current = modes.find(mode => mode[6]?.['is-current']) ?? null;
            return {
                connector,
                width: current?.[1] ?? null,
                height: current?.[2] ?? null,
                refreshHz: current ? Math.round(current[3] * 100) / 100 : null,
                primary: primaries.has(connector),
            };
        });
    }
}

export const displayInfo = new DisplayInfo();
