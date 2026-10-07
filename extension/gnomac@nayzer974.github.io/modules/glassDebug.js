// Liquid Glass debug overlay, off by default (setting glass-debug, or Spotlight
// "Liquid Glass debug"). Shows the number of live glass surfaces, the quality
// level, the wallpaper brightness steering the glass, whether animations are
// on, and the frame rate. `glass-debug-mode` additionally shows one layer of
// the material alone (1 backdrop, 2 refraction, 3 fresnel, 4 specular, 5 rim,
// 6 tint) on every surface.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {liveSurfaces} from '../lib/glass.js';
import {adaptive} from '../lib/adaptive.js';

const MODES = ['off', 'backdrop', 'refraction', 'fresnel', 'specular', 'rim', 'tint'];

export class GlassDebug {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._frames = 0;
    }

    enable() {
        this._extension.glassDebug = this;
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key === 'glass-debug')
                this._sync();
            else if (key === 'glass-debug-mode')
                this._applyMode();
        });
        this._sync();
    }

    disable() {
        if (this._extension.glassDebug === this)
            this._extension.glassDebug = null;
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        this._hide();
    }

    toggle() {
        this._settings.set_boolean('glass-debug', !this._settings.get_boolean('glass-debug'));
    }

    _applyMode() {
        const mode = this._settings.get_int('glass-debug-mode');
        for (const surface of liveSurfaces)
            surface.setDebugMode(mode);
    }

    _sync() {
        if (this._settings.get_boolean('glass-debug'))
            this._show();
        else
            this._hide();
    }

    _show() {
        if (this._label)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        this._label = new St.Label({style_class: 'gnomac-glass-debug', reactive: false,
            x: monitor.x + monitor.width - 270, y: monitor.y + Main.panel.height + 12});
        Main.layoutManager.uiGroup.add_child(this._label);
        this._frameId = global.stage.connect('after-paint', () => this._frames++);
        this._since = GLib.get_monotonic_time();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
        this._update();
    }

    _hide() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._frameId) {
            global.stage.disconnect(this._frameId);
            this._frameId = 0;
        }
        this._label?.destroy();
        this._label = null;
    }

    _update() {
        if (!this._label)
            return;
        const now = GLib.get_monotonic_time();
        const fps = Math.round(this._frames / Math.max(0.1, (now - this._since) / 1e6));
        this._frames = 0;
        this._since = now;
        const mode = MODES[this._settings.get_int('glass-debug-mode')] ?? 'off';
        this._label.text = [
            `Liquid Glass · ${this._settings.get_string('glass-quality')}`,
            `surfaces ${liveSurfaces.size}   fps ${fps}`,
            `wallpaper luminance ${adaptive.luminance.toFixed(2)} (adapt ${adaptive.amount.toFixed(2)})`,
            `animations ${St.Settings.get().enable_animations ? 'on' : 'off'}   layer ${mode}`,
        ].join('\n');
    }
}
