// GlassPerformanceManager: watches the frame rate while the desktop is
// animating and lowers (then, carefully, raises) the quality of the glass.
//
//   frame times  ->  fps over a 1 s window  ->  level  ->  every glass surface
//
// Levels, best to worst: ultra, high, medium, low. The user's setting
// (glass-quality) is the ceiling; the manager never goes above it. Hysteresis:
// going down needs two bad windows in a row, going up needs five good ones,
// 20 s apart, so the quality never flips every second. The power profile
// "power-saver" (Low Power) caps the level at "low". Reduced motion
// (animations off) is reported, and the animations themselves already jump to
// their end state. A battery-level cap is NOT implemented.
//
// Only frames drawn while something animates are counted (a gap of more than
// 100 ms between two frames is idle time, not slowness).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {QUALITY} from './glassTokens.js';

export const LEVELS = ['low', 'medium', 'high', 'ultra'];
// Thresholds are for 60 Hz; they scale with the real refresh rate of the
// screen (90 Hz: x1.5, 144 Hz: x2.4). Unknown refresh rate: 60 is used.
const FPS_FOR = {ultra: 56, high: 46, medium: 36};   // below medium's: low
const DOWN_WINDOWS = 2;
const UP_WINDOWS = 5;
const UP_COOLDOWN_US = 20e6;
const MARGIN = 4;                                    // fps above the threshold needed to go up

// What a level changes for a surface, relative to the user's ceiling.
export function levelScale(level, ceiling) {
    const l = QUALITY[level] ?? QUALITY.high;
    const c = QUALITY[ceiling] ?? QUALITY.high;
    const ratio = key => (c[key] ? Math.min(1, l[key] / c[key]) : 1);
    return {
        blur: ratio('blur'), chroma: ratio('chroma'), fresnel: ratio('fresnel'),
        refraction: ratio('refraction'), sheen: ratio('sheen'),
        // How often the backdrop under a surface is re-read, in ms (0 = never:
        // the wallpaper's average is used).
        backdropMs: {ultra: 250, high: 500, medium: 1000, low: 0}[level],
    };
}

// The quality ceiling a battery imposes: under 20 % while discharging, HIGH
// at most; under 10 %, MEDIUM. `battery` is {percent, state} (UPower states:
// 1 charging, 2 discharging, 3 empty, 4 fully charged, 5 pending charge, 6
// pending discharge) or null when there is no reliable reading.
export function batteryCap(battery) {
    if (!battery || !(battery.percent > 0 && battery.percent <= 100))
        return 'ultra';
    const discharging = battery.state === 2 || battery.state === 3 || battery.state === 6;
    if (!discharging)
        return 'ultra';
    if (battery.percent < 10)
        return 'medium';
    if (battery.percent < 20)
        return 'high';
    return 'ultra';
}

class GlassPerformanceManager {
    constructor() {
        this.autoLevel = 'ultra';
        this.ceiling = 'high';
        this.powerCap = 'ultra';
        this.batteryCap = 'ultra';
        // Set by the extension: () => the screen's real refresh rate in Hz, or null.
        this.refreshHz = null;
        this.battery = null;           // {percent, state} when a battery is present and readable
        this.fps = 0;
        this.frameMs = 0;
        this.benchmarking = false;
        this._listeners = new Set();
        this._last = 0;
        this._intervals = [];
        this._good = 0;
        this._bad = 0;
        this._changedAt = 0;
        this._stageId = 0;
        this._timeout = 0;
    }

    get level() {
        const list = [this.autoLevel, this.ceiling, this.powerCap, this.batteryCap];
        return list.reduce((a, b) => (LEVELS.indexOf(a) <= LEVELS.indexOf(b) ? a : b));
    }

    get reducedMotion() {
        return !St.Settings.get().enable_animations;
    }

    get scale() {
        return levelScale(this.level, this.ceiling);
    }

    start(settings) {
        if (this._stageId)
            return;
        this._settings = settings;
        this._readCeiling();
        this._settingsId = settings.connect('changed::glass-quality', () => {
            this._readCeiling();
            this._notify();
        });
        this._stageId = global.stage.connect('after-paint', () => this._onFrame());
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._evaluate();
            return GLib.SOURCE_CONTINUE;
        });
        this._watchPower();
        this._watchBattery();
        this._notify();
    }

    stop() {
        if (this._stageId) {
            global.stage.disconnect(this._stageId);
            this._stageId = 0;
        }
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
        if (this._settingsId) {
            this._settings?.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        if (this._powerSub) {
            Gio.DBus.system.signal_unsubscribe(this._powerSub);
            this._powerSub = 0;
        }
        if (this._batterySub) {
            Gio.DBus.system.signal_unsubscribe(this._batterySub);
            this._batterySub = 0;
        }
        this._settings = null;
        this._listeners.clear();
        this.autoLevel = 'ultra';
        this.powerCap = 'ultra';
        this.batteryCap = 'ultra';
    }

    // callback(level, scale); returns a function that removes it.
    connect(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _readCeiling() {
        const name = this._settings?.get_string('glass-quality');
        this.ceiling = LEVELS.includes(name) ? name : 'high';
    }

    _notify() {
        const level = this.level;
        const scale = this.scale;
        for (const callback of [...this._listeners]) {
            try {
                callback(level, scale);
            } catch (e) {
                logError(e, 'GNOMAC glass performance');
            }
        }
    }

    _onFrame() {
        const now = GLib.get_monotonic_time();
        if (this._last && now - this._last < 100000)
            this._intervals.push(now - this._last);
        this._last = now;
    }

    _evaluate() {
        const intervals = this._intervals;
        this._intervals = [];
        if (this.benchmarking || intervals.length < 10)
            return;                     // not enough animation to judge
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        this.frameMs = mean / 1000;
        this.fps = 1e6 / mean;
        const target = this._levelFor(this.fps, 0);
        const current = this.autoLevel;
        if (LEVELS.indexOf(target) < LEVELS.indexOf(current)) {
            this._good = 0;
            if (++this._bad >= DOWN_WINDOWS)
                this._setAuto(target);
        } else if (LEVELS.indexOf(this._levelFor(this.fps, MARGIN)) > LEVELS.indexOf(current)) {
            this._bad = 0;
            const cool = GLib.get_monotonic_time() - this._changedAt > UP_COOLDOWN_US;
            if (++this._good >= UP_WINDOWS && cool)
                this._setAuto(LEVELS[LEVELS.indexOf(current) + 1]);
        } else {
            this._good = this._bad = 0;
        }
    }

    _levelFor(fps, margin) {
        const k = (this.refreshHz?.() ?? 60) / 60;
        for (const level of ['ultra', 'high', 'medium'])
            if (fps >= (FPS_FOR[level] + margin) * k)
                return level;
        return 'low';
    }

    _setAuto(level) {
        this._good = this._bad = 0;
        this._changedAt = GLib.get_monotonic_time();
        if (level === this.autoLevel)
            return;
        this.autoLevel = level;
        this._notify();
    }

    // Battery (UPower's display device). The cap only applies when the answer
    // is trustworthy: a battery is present, it is discharging, and the
    // percentage is in 0..100. On AC, without a battery, or when UPower does
    // not answer, there is no cap and `battery` stays null (shown as N/A).
    _watchBattery() {
        const path = '/org/freedesktop/UPower/devices/DisplayDevice';
        const apply = props => {
            const present = props.IsPresent?.deepUnpack?.() ?? props.IsPresent;
            const percent = props.Percentage?.deepUnpack?.() ?? props.Percentage;
            const state = props.State?.deepUnpack?.() ?? props.State;
            this.battery = present && Number.isFinite(percent) ? {percent, state} : null;
            this.batteryCap = batteryCap(this.battery);
            this._notify();
        };
        try {
            Gio.DBus.system.call('org.freedesktop.UPower', path, 'org.freedesktop.DBus.Properties', 'GetAll',
                new GLib.Variant('(s)', ['org.freedesktop.UPower.Device']), null, Gio.DBusCallFlags.NONE, 1000,
                null, (conn, res) => {
                    try {
                        apply(conn.call_finish(res).deepUnpack()[0]);
                    } catch {}
                });
            this._batterySub = Gio.DBus.system.signal_subscribe('org.freedesktop.UPower',
                'org.freedesktop.DBus.Properties', 'PropertiesChanged', path, null, Gio.DBusSignalFlags.NONE,
                () => this._watchBatteryOnce(path, apply));
        } catch {}
    }

    _watchBatteryOnce(path, apply) {
        Gio.DBus.system.call('org.freedesktop.UPower', path, 'org.freedesktop.DBus.Properties', 'GetAll',
            new GLib.Variant('(s)', ['org.freedesktop.UPower.Device']), null, Gio.DBusCallFlags.NONE, 1000,
            null, (conn, res) => {
                try {
                    apply(conn.call_finish(res).deepUnpack()[0]);
                } catch {}
            });
    }

    // Power profile: power-saver caps the glass at "low". Read once, then
    // kept up to date by signals.
    _watchPower() {
        const apply = profile => {
            this.powerCap = profile === 'power-saver' ? 'low' : 'ultra';
            this._notify();
        };
        try {
            Gio.DBus.system.call('net.hadess.PowerProfiles', '/net/hadess/PowerProfiles',
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['net.hadess.PowerProfiles', 'ActiveProfile']),
                null, Gio.DBusCallFlags.NONE, 1000, null, (conn, res) => {
                    try {
                        apply(conn.call_finish(res).deepUnpack()[0].deepUnpack());
                    } catch {}
                });
            this._powerSub = Gio.DBus.system.signal_subscribe('net.hadess.PowerProfiles',
                'org.freedesktop.DBus.Properties', 'PropertiesChanged', '/net/hadess/PowerProfiles',
                null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, params) => {
                    const changed = params.deepUnpack()[1];
                    if ('ActiveProfile' in changed)
                        apply(changed.ActiveProfile.deepUnpack());
                });
        } catch {}
    }
}

export const glassPerformance = new GlassPerformanceManager();
