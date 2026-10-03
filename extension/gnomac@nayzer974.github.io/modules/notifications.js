// macOS notification banners: top-right corner, rounded Liquid Glass card
// that slides in under the menu bar. GNOME's banner logic (actions, reply,
// expansion, queueing) is untouched; only placement and material change.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';

const RADIUS = 20;

export class Notifications {
    constructor(extension) {
        this._settings = extension.getSettings();
    }

    enable() {
        const tray = Main.messageTray;
        this._oldAlignment = tray.bannerAlignment;
        tray.bannerAlignment = Clutter.ActorAlign.END;
        tray.add_style_class_name('gnomac-notifications');

        const bin = tray._bannerBin;
        this._glass = new GlassSurface({
            backdrop: 'windows',
            blur: Math.max(this._settings.get_int('glass-blur'), 40),
            glass: glassParamsFromSettings(this._settings, RADIUS),
        });
        this._glass.opacity = 0;
        tray.insert_child_below(this._glass, bin);
        this._trayGone = false;
        this._goneId = bin.connect('destroy', () => (this._trayGone = true));

        // y and opacity are animated by GNOME (slide-in): those notifications
        // arrive from the frame clock, so syncing right away is safe.
        // Allocation changes arrive mid-layout and are deferred.
        this._ids = [
            bin.connect('notify::y', () => this._sync()),
            bin.connect('notify::opacity', () => this._sync()),
            bin.connect('notify::visible', () => this._sync()),
            bin.connect('notify::allocation', () => this._syncLater()),
            bin.connect('child-added', () => this._syncLater()),
            bin.connect('child-removed', () => this._syncLater()),
        ];
        this._sync();
    }

    disable() {
        const tray = Main.messageTray;
        const bin = tray._bannerBin;
        if (!this._trayGone) {
            for (const id of [...this._ids ?? [], this._goneId])
                bin.disconnect(id);
        }
        this._ids = [];
        if (this._later) {
            global.compositor.get_laters().remove(this._later);
            this._later = 0;
        }
        this._glass?.destroy();
        this._glass = null;
        tray.remove_style_class_name('gnomac-notifications');
        tray.bannerAlignment = this._oldAlignment ?? Clutter.ActorAlign.CENTER;
    }

    _syncLater() {
        if (this._later)
            return;
        this._later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._later = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const glass = this._glass;
        // During shell shutdown the tray dies before disable() runs.
        if (!glass || this._trayGone)
            return;
        const banner = Main.messageTray._bannerBin.get_first_child();
        if (!banner || !banner.mapped || !Main.messageTray._bannerBin.visible) {
            glass.opacity = 0;
            return;
        }
        const [x, y] = banner.get_transformed_position();
        const [width, height] = banner.get_transformed_size();
        if (![x, y, width, height].every(Number.isFinite) || width < 1)
            return;
        const [tx, ty] = Main.messageTray.get_transformed_position();
        glass.set_position(Math.round(x - tx), Math.round(y - ty));
        glass.set_size(Math.round(width), Math.round(height));
        glass.setStageOrigin(x, y);
        glass.opacity = Main.messageTray._bannerBin.opacity;
    }
}
