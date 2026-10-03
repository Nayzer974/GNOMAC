// GNOMAC — macOS 27 (Golden Gate) feel for GNOME Shell.

import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Dock} from './modules/dock.js';
import {TopBar} from './modules/topbar.js';
import {destroyTicker} from './lib/spring.js';

const MODULES = [
    {key: 'enable-topbar', Module: TopBar},
    {key: 'enable-dock', Module: Dock},
];

export default class GnomacExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._modules = [];
        this._start();
        // Any change rebuilds the modules; debounce so dragging a slider in
        // the preferences does not rebuild on every step.
        this._settingsId = this._settings.connect('changed', () => this._scheduleReload());
    }

    disable() {
        if (this._reloadId) {
            GLib.source_remove(this._reloadId);
            this._reloadId = 0;
        }
        this._settings.disconnect(this._settingsId);
        this._stop();
        destroyTicker();
        this._settings = null;
    }

    _start() {
        for (const {key, Module} of MODULES) {
            if (!this._settings.get_boolean(key))
                continue;
            const module = new Module(this);
            try {
                module.enable();
                this._modules.push(module);
            } catch (e) {
                logError(e, `GNOMAC: cannot enable ${key}`);
                try {
                    module.disable();
                } catch {}
            }
        }
    }

    _stop() {
        for (const module of this._modules.reverse()) {
            try {
                module.disable();
            } catch (e) {
                logError(e, 'GNOMAC: error while disabling a module');
            }
        }
        this._modules = [];
    }

    _scheduleReload() {
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._reloadId = 0;
            this._stop();
            this._start();
            return GLib.SOURCE_REMOVE;
        });
    }
}
