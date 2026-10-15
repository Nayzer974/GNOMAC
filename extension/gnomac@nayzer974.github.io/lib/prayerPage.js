// The "Prayers" tab of the Dynamic Island: the next prayer and how long until
// it, the six times of the day with the current one lit, and the date in the
// Hijri calendar. Everything is computed on the machine (lib/prayerTimes.js).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {PRAYER_NAMES, countdown, stateAt} from './prayerSchedule.js';
import {formatHours} from './prayerTimes.js';
import {press} from './motion.js';
import {t} from './i18n.js';

const ORDER = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

function hijriDate(date) {
    try {
        const lang = (GLib.get_language_names()[0] ?? 'en').startsWith('fr') ? 'fr' : 'en';
        return new Intl.DateTimeFormat(`${lang}-u-ca-islamic-umalqura`,
            {day: 'numeric', month: 'long', year: 'numeric'}).format(date);
    } catch {
        return '';
    }
}

const clockText = (dt, h24) => formatHours(dt.get_hour() + dt.get_minute() / 60, h24);

export class PrayerPage {
    constructor(onOpenPreferences) {
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            style_class: 'gnomac-notch-prayer'});

        // Nothing chosen yet: say so, with a way to the settings.
        this.empty = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_expand: true, style_class: 'gnomac-notch-prayer-empty'});
        this.emptyText = new St.Label({style_class: 'gnomac-notch-subtitle', x_align: Clutter.ActorAlign.CENTER,
            text: t('Choose your city in the preferences to see the prayer times.',
                'Choisis ta ville dans les préférences pour voir les heures de prière.')});
        const open = press(new St.Button({style_class: 'gnomac-notch-pill-button', can_focus: false,
            label: t('Open preferences', 'Ouvrir les préférences'), x_align: Clutter.ActorAlign.CENTER}));
        open.connect('clicked', () => onOpenPreferences?.());
        this.empty.add_child(this.emptyText);
        this.empty.add_child(open);
        this.actor.add_child(this.empty);

        // The headline: what is next, at what time, and in how long.
        this.body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            style_class: 'gnomac-notch-prayer-body'});
        const head = new St.BoxLayout({style_class: 'gnomac-notch-prayer-head'});
        const next = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this.kicker = new St.Label({style_class: 'gnomac-notch-prayer-kicker'});
        const line = new St.BoxLayout({style_class: 'gnomac-notch-prayer-line'});
        this.nextName = new St.Label({style_class: 'gnomac-notch-prayer-name', y_align: Clutter.ActorAlign.END});
        this.nextTime = new St.Label({style_class: 'gnomac-notch-prayer-time', y_align: Clutter.ActorAlign.END});
        this.until = new St.Label({style_class: 'gnomac-notch-subtitle', y_align: Clutter.ActorAlign.END});
        for (const child of [this.nextName, this.nextTime, this.until])
            line.add_child(child);
        next.add_child(this.kicker);
        next.add_child(line);
        const side = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END});
        this.hijri = new St.Label({style_class: 'gnomac-notch-prayer-meta', x_align: Clutter.ActorAlign.END});
        this.place = new St.Label({style_class: 'gnomac-notch-prayer-meta', x_align: Clutter.ActorAlign.END});
        side.add_child(this.hijri);
        side.add_child(this.place);
        head.add_child(next);
        head.add_child(side);
        this.body.add_child(head);

        // How far through the span between the current and the next prayer.
        this.track = new St.Widget({style_class: 'gnomac-notch-track gnomac-notch-prayer-track', x_expand: true});
        this.fill = new St.Widget({style_class: 'gnomac-notch-fill', reactive: false});
        this.track.add_child(this.fill);
        this.track.connect('notify::width', () => this._paintFill());
        this.body.add_child(this.track);

        // The six times.
        this.row = new St.BoxLayout({style_class: 'gnomac-notch-prayer-row', x_expand: true});
        this.cells = {};
        for (const key of ORDER) {
            const cell = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
                style_class: key === 'sunrise' ? 'gnomac-notch-prayer-cell sunrise' : 'gnomac-notch-prayer-cell'});
            const name = new St.Label({text: PRAYER_NAMES[key](), style_class: 'gnomac-notch-prayer-cell-name',
                x_align: Clutter.ActorAlign.CENTER});
            const time = new St.Label({style_class: 'gnomac-notch-prayer-cell-time', x_align: Clutter.ActorAlign.CENTER});
            cell.add_child(name);
            cell.add_child(time);
            this.row.add_child(cell);
            this.cells[key] = {cell, time};
        }
        this.body.add_child(this.row);
        this.actor.add_child(this.body);
        this._fraction = 0;
    }

    _paintFill() {
        this.fill.set_position(0, 0);
        this.fill.set_size(Math.round(this.track.width * this._fraction), this.track.height);
    }

    // `config` comes from prayerSchedule.readConfig(); `now` is a GLib.DateTime.
    update(config, now = GLib.DateTime.new_now_local()) {
        const chosen = !!config.place;
        this.empty.visible = !chosen;
        this.body.visible = chosen;
        if (!chosen)
            return;

        const state = stateAt(config, now);
        const ts = now.to_unix();
        const h24 = config.h24;
        for (const key of ORDER) {
            const entry = state.today.find(e => e.key === key);
            const {cell, time} = this.cells[key];
            time.text = entry ? clockText(entry.at, h24) : '--:--';
            // The lit cell is the current prayer; sunrise lights up instead of
            // Fajr once the sun is up (Fajr's time is over).
            const current = state.afterSunrise ? 'sunrise' : state.current?.key;
            cell.set_style_class_name(`gnomac-notch-prayer-cell${key === 'sunrise' ? ' sunrise' : ''}` +
                `${key === current ? ' current' : ''}${key === state.next?.key ? ' next' : ''}`);
        }

        const next = state.next;
        if (next) {
            this.kicker.text = t('Next prayer', 'Prochaine prière');
            this.nextName.text = PRAYER_NAMES[next.key]();
            this.nextTime.text = clockText(next.at, h24);
            this.until.text = countdown(next.ts - ts);
        }
        const current = state.current;
        this._fraction = current && next ? Math.min(1, Math.max(0, (ts - current.ts) / (next.ts - current.ts))) : 0;
        this._paintFill();

        // The Hijri day changes at Maghrib, not at midnight.
        const maghrib = state.entries.find(e => e.key === 'maghrib' &&
            e.at.get_day_of_month() === now.get_day_of_month() && e.at.get_month() === now.get_month());
        const date = new Date(now.get_year(), now.get_month() - 1, now.get_day_of_month(), 12);
        if (maghrib && ts >= maghrib.ts)
            date.setDate(date.getDate() + 1);
        this.hijri.text = hijriDate(date);
        this.place.text = config.city || `${config.place.latitude.toFixed(2)}, ${config.place.longitude.toFixed(2)}`;
    }
}
