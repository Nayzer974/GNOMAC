// The prayer times of a day as real moments (GLib.DateTime), which prayer is
// current and which is next, and the alerts that fire at each prayer. The
// astronomy lives in prayerTimes.js; this file only deals with clocks.

import GLib from 'gi://GLib';

import {PRAYERS, computeHours} from './prayerTimes.js';
import {t} from './i18n.js';

export const PRAYER_NAMES = {
    fajr: () => t('Fajr', 'Fajr'),
    sunrise: () => t('Sunrise', 'Chourouk'),
    dhuhr: () => t('Dhuhr', 'Dhor'),
    asr: () => t('Asr', 'Asr'),
    maghrib: () => t('Maghrib', 'Maghrib'),
    isha: () => t('Isha', 'Icha'),
};

// Sunrise is a landmark, not a prayer: it is listed, but never "next".
export const REAL_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export function readConfig(settings) {
    const latitude = settings.get_double('prayer-latitude');
    const longitude = settings.get_double('prayer-longitude');
    return {
        enabled: settings.get_boolean('prayer-enabled'),
        // 0, 0 is "not chosen yet" (the Gulf of Guinea has no prayer to time).
        place: latitude === 0 && longitude === 0 ? null : {latitude, longitude},
        city: settings.get_string('prayer-city'),
        method: settings.get_string('prayer-method'),
        asr: settings.get_string('prayer-asr'),
        highLatitude: settings.get_string('prayer-high-latitude'),
        offsets: settings.get_value('prayer-offsets').deepUnpack(),
        notify: new Set(settings.get_strv('prayer-notify')),
        before: settings.get_int('prayer-before-minutes'),
        sound: settings.get_boolean('prayer-sound'),
        h24: settings.get_boolean('island-clock-24h'),
    };
}

// A wall-clock time of the civil day of `day`, in hours that may run past 24
// (Isha after midnight) or below 0.
function atHours(day, hours) {
    const shift = Math.floor(hours / 24);
    const clock = hours - shift * 24;
    const base = shift ? day.add_days(shift) : day;
    const totalMinutes = Math.round(clock * 60);
    const hour = Math.floor(totalMinutes / 60) % 24;
    const minute = totalMinutes % 60;
    const carry = Math.floor(totalMinutes / 60) >= 24 ? 1 : 0;
    const date = carry ? base.add_days(1) : base;
    return GLib.DateTime.new_local(date.get_year(), date.get_month(), date.get_day_of_month(), hour, minute, 0);
}

// The six times of the civil day that contains `day`.
export function timesOfDay(config, day) {
    if (!config.place)
        return [];
    const noon = GLib.DateTime.new_local(day.get_year(), day.get_month(), day.get_day_of_month(), 12, 0, 0);
    const timezone = noon.get_utc_offset() / 3.6e9;
    const hours = computeHours(
        {year: noon.get_year(), month: noon.get_month(), day: noon.get_day_of_month()},
        config.place, timezone, config.method,
        {asr: config.asr, highLatitude: config.highLatitude, offsets: config.offsets});
    const out = [];
    for (const key of PRAYERS) {
        if (!Number.isFinite(hours[key]))
            continue;
        const at = atHours(noon, hours[key]);
        out.push({key, at, ts: at.to_unix()});
    }
    return out;
}

// Yesterday, today and tomorrow, in order: Isha of last night can still be
// "current" after midnight, and tomorrow's Fajr is "next" after Isha.
export function entriesAround(config, now) {
    const all = [];
    for (const shift of [-1, 0, 1])
        all.push(...timesOfDay(config, now.add_days(shift)));
    return all.sort((a, b) => a.ts - b.ts);
}

// What the island shows: the prayer that has begun last, the next one, and
// today's six times.
export function stateAt(config, now) {
    const entries = entriesAround(config, now);
    const ts = now.to_unix();
    const prayers = entries.filter(e => e.key !== 'sunrise');
    const past = prayers.filter(e => e.ts <= ts);
    const current = past.length ? past[past.length - 1] : null;
    const next = prayers.find(e => e.ts > ts) ?? null;
    const sunrise = entries.filter(e => e.key === 'sunrise' && e.ts <= ts).pop();
    // Between sunrise and Dhuhr the Fajr prayer's time is over.
    const afterSunrise = !!(sunrise && current && current.key === 'fajr' && sunrise.ts > current.ts);
    const today = entries.filter(e => e.at.get_day_of_month() === now.get_day_of_month() &&
        e.at.get_month() === now.get_month());
    return {current, next, afterSunrise, today, entries};
}

// "in 1 h 12" / "dans 23 min" / "dans 40 s".
export function countdown(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0)
        return t(`in ${h} h ${String(m).padStart(2, '0')}`, `dans ${h} h ${String(m).padStart(2, '0')}`);
    if (m > 0)
        return t(`in ${m} min`, `dans ${m} min`);
    return t(`in ${s} s`, `dans ${s} s`);
}

// Fires `onAlert({key, at, kind})` once for each prayer time (and each
// reminder, `before` minutes ahead) as the clock passes it. Call tick() about
// once a second. Moments missed while the machine slept are dropped, except
// the last two minutes: an old alert is worse than none.
export class PrayerAlerts {
    constructor(onAlert) {
        this._onAlert = onAlert;
        this._last = null;
        this._fired = new Set();
    }

    reset() {
        this._last = null;
    }

    tick(config, now) {
        const ts = now.to_unix();
        if (this._last === null || !config.enabled || !config.place) {
            this._last = ts;
            return;
        }
        const from = Math.max(this._last, ts - 120);
        this._last = ts;
        for (const entry of entriesAround(config, now)) {
            if (!config.notify.has(entry.key))
                continue;
            const moments = [{kind: 'now', ts: entry.ts}];
            if (config.before > 0)
                moments.push({kind: 'before', ts: entry.ts - config.before * 60});
            for (const moment of moments) {
                if (moment.ts <= from || moment.ts > ts)
                    continue;
                const id = `${entry.ts}:${entry.key}:${moment.kind}`;
                if (this._fired.has(id))
                    continue;
                this._fired.add(id);
                this._onAlert({key: entry.key, at: entry.at, kind: moment.kind});
            }
        }
        // Remember a few days at most.
        if (this._fired.size > 60)
            this._fired = new Set([...this._fired].slice(-30));
    }
}
