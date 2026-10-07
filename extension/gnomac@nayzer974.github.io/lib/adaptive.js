// Adaptive glass: the wallpaper's brightness steers the material. Over a dark
// wallpaper the glass stays light and faint; over a bright one it darkens a
// touch, its edge becomes more visible and the highlight calmer, so panels
// and text stay readable. The change is continuous (no switch between two
// looks): everything follows `amount`, a smooth 0..1 "how bright is it".

import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

class Adaptive {
    constructor() {
        this.luminance = 0.3;
        this.saturation = 0.4;
        this._settings = null;
        this._ids = [];
        this._timeout = 0;
    }

    start() {
        if (this._settings)
            return;
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        for (const key of ['picture-uri', 'picture-uri-dark', 'color-shading-type', 'primary-color']) {
            try {
                this._ids.push(this._settings.connect(`changed::${key}`, () => this._queue()));
            } catch {}
        }
        this._measure();
    }

    stop() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
        for (const id of this._ids)
            this._settings?.disconnect(id);
        this._ids = [];
        this._settings = null;
    }

    _queue() {
        if (this._timeout)
            GLib.source_remove(this._timeout);
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._timeout = 0;
            this._measure();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Mean luminance and saturation of the wallpaper, from a 32x32 thumbnail.
    _measure() {
        try {
            const dark = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('color-scheme') === 'prefer-dark';
            let uri = this._settings.get_string(dark ? 'picture-uri-dark' : 'picture-uri') || this._settings.get_string('picture-uri');
            if (!uri)
                return;
            const file = Gio.File.new_for_uri(uri);
            const path = file.get_path();
            if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS) || path.endsWith('.xml'))
                return;
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 32, 32, false);
            const bytes = pixbuf.get_pixels();
            const channels = pixbuf.get_n_channels();
            let luma = 0;
            let sat = 0;
            let n = 0;
            for (let i = 0; i + 2 < bytes.length; i += channels) {
                const r = bytes[i] / 255;
                const g = bytes[i + 1] / 255;
                const b = bytes[i + 2] / 255;
                luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
                sat += Math.max(r, g, b) - Math.min(r, g, b);
                n++;
            }
            if (n) {
                this.luminance = luma / n;
                this.saturation = sat / n;
            }
        } catch (e) {
            logError(e, 'GNOMAC adaptive glass: wallpaper not measured');
        }
    }

    // 0 over a dark wallpaper, 1 over a very bright one.
    get amount() {
        return smooth(0.42, 0.82, this.luminance);
    }

    // Adjusts glass parameters to what is behind them.
    adapt(params) {
        const k = this.amount;
        const [r, g, b, a] = params.tint;
        const toward = [0.16, 0.17, 0.22];
        const mix = (x, y, t) => x + (y - x) * t;
        return {
            ...params,
            // Darker and a bit more opaque over bright backgrounds.
            tint: [mix(r, toward[0], k * 0.4), mix(g, toward[1], k * 0.4), mix(b, toward[2], k * 0.4),
                Math.min(0.9, a * (1 + 0.45 * k))],
            // The edge is easier to see on bright backgrounds, the sheen calmer.
            rim: (params.rim ?? 0.55) * (1 + 0.5 * k),
            sheen: (params.sheen ?? 1) * (1 - 0.35 * k),
        };
    }
}

export const adaptive = new Adaptive();
