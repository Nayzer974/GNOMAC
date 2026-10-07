// Adaptive glass: the wallpaper's brightness steers the material. Over a dark
// wallpaper the glass stays light and faint; over a bright one it darkens a
// touch, its edge becomes more visible and the highlight calmer, so panels
// and text stay readable. The change is continuous (no switch between two
// looks): everything follows `amount`, a smooth 0..1 "how bright is it".

import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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
        this._thumb = null;
        this._cache = new Map();
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
            this._thumb = {bytes: pixbuf.get_pixels(), channels: pixbuf.get_n_channels(), stride: pixbuf.get_rowstride()};
            this._cache.clear();
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

    // The part of the wallpaper under `bounds` (stage pixels, primary monitor):
    // luminance, saturation, dominant colour and contrast (spread of luminance).
    // Read from the 32x32 thumbnail, cached per 16 px cell; the whole-wallpaper
    // average stays as the fallback when the thumbnail is missing.
    sample(bounds) {
        const monitor = Main.layoutManager.primaryMonitor;
        const fallback = {luminance: this.luminance, saturation: this.saturation,
            dominant: [this.luminance, this.luminance, this.luminance], contrast: 0};
        if (!this._thumb || !monitor)
            return fallback;
        const q = v => Math.round(v / 16);
        const key = `${q(bounds.x)},${q(bounds.y)},${q(bounds.width)},${q(bounds.height)}`;
        const hit = this._cache.get(key);
        if (hit)
            return hit;
        const {bytes, channels, stride} = this._thumb;
        const clamp = v => Math.min(31, Math.max(0, v));
        const x0 = clamp(Math.floor((bounds.x - monitor.x) / monitor.width * 32));
        const y0 = clamp(Math.floor((bounds.y - monitor.y) / monitor.height * 32));
        const x1 = clamp(Math.ceil((bounds.x + bounds.width - monitor.x) / monitor.width * 32) - 1);
        const y1 = clamp(Math.ceil((bounds.y + bounds.height - monitor.y) / monitor.height * 32) - 1);
        let luma = 0;
        let sat = 0;
        let n = 0;
        let lo = 1;
        let hi = 0;
        const sum = [0, 0, 0];
        for (let y = y0; y <= Math.max(y0, y1); y++) {
            for (let x = x0; x <= Math.max(x0, x1); x++) {
                const i = y * stride + x * channels;
                const r = bytes[i] / 255;
                const g = bytes[i + 1] / 255;
                const b = bytes[i + 2] / 255;
                const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                luma += l;
                sat += Math.max(r, g, b) - Math.min(r, g, b);
                sum[0] += r; sum[1] += g; sum[2] += b;
                lo = Math.min(lo, l);
                hi = Math.max(hi, l);
                n++;
            }
        }
        if (!n)
            return fallback;
        const result = {luminance: luma / n, saturation: sat / n,
            dominant: sum.map(v => v / n), contrast: hi - lo};
        if (this._cache.size > 200)
            this._cache.clear();
        this._cache.set(key, result);
        return result;
    }

    // How much brighter (+) or darker (-) the spot is than the wallpaper as a
    // whole, as a -1..1 correction. Subtle by design.
    localDelta(sample) {
        return Math.max(-1, Math.min(1, (smooth(0.42, 0.82, sample.luminance) - this.amount)));
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
