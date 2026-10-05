// Extra views of the Dynamic Island, as in Alcove / Boring Notch:
//  - MonthCalendar: the current month with today highlighted,
//  - PomodoroTimer: focus/break countdown shown as an orange ring when the
//    notch is folded,
//  - Shelf: files kept in the notch, one click opens them.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {t} from './i18n.js';

// ---------------------------------------------------------------- calendar

export class MonthCalendar {
    constructor() {
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-cal'});
        this._title = new St.Label({style_class: 'gnomac-notch-cal-title'});
        this._grid = new St.Widget({layout_manager: new Clutter.GridLayout({
            column_spacing: 2, row_spacing: 1, column_homogeneous: true, row_homogeneous: true})});
        this.actor.add_child(this._title);
        this.actor.add_child(this._grid);
        this._day = -1;
    }

    // Re-render only when the day changes.
    update() {
        const now = GLib.DateTime.new_now_local();
        if (this._day === now.get_day_of_month())
            return;
        this._day = now.get_day_of_month();
        this._grid.destroy_all_children();
        this._title.text = now.format('%B').toUpperCase();

        const layout = this._grid.layout_manager;
        const labels = [t('M', 'L'), t('T', 'M'), t('W', 'M'), t('T', 'J'), t('F', 'V'), t('S', 'S'), t('S', 'D')];
        labels.forEach((text, i) => layout.attach(
            new St.Label({text, style_class: 'gnomac-notch-cal-head', x_align: Clutter.ActorAlign.CENTER}), i, 0, 1, 1));

        const first = GLib.DateTime.new_local(now.get_year(), now.get_month(), 1, 0, 0, 0);
        const offset = first.get_day_of_week() - 1; // Monday first
        const days = GLib.Date.get_days_in_month(now.get_month(), now.get_year());
        for (let d = 1; d <= days; d++) {
            const slot = offset + d - 1;
            const label = new St.Label({
                text: String(d),
                style_class: d === now.get_day_of_month() ? 'gnomac-notch-cal-day today' : 'gnomac-notch-cal-day',
                x_align: Clutter.ActorAlign.CENTER,
            });
            layout.attach(label, slot % 7, 1 + Math.floor(slot / 7), 1, 1);
        }
    }
}

// ---------------------------------------------------------------- pomodoro

const FOCUS = 25 * 60;
const BREAK = 5 * 60;

export class PomodoroTimer {
    constructor(onChange) {
        this._onChange = onChange;
        this.running = false;
        this.phase = 'focus';
        this.remaining = FOCUS;
        this._id = 0;

        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-timer', x_align: Clutter.ActorAlign.CENTER});
        this.phaseLabel = new St.Label({style_class: 'gnomac-notch-subtitle',
            x_align: Clutter.ActorAlign.CENTER});
        this.timeLabel = new St.Label({style_class: 'gnomac-notch-timer-time',
            x_align: Clutter.ActorAlign.CENTER});
        const buttons = new St.BoxLayout({style_class: 'gnomac-notch-controls',
            x_align: Clutter.ActorAlign.CENTER});
        this.startButton = new St.Button({style_class: 'gnomac-notch-pill-button', can_focus: true});
        this.resetButton = new St.Button({style_class: 'gnomac-notch-pill-button',
            label: t('Reset', 'Réinitialiser'), can_focus: true});
        this.startButton.connect('clicked', () => this.toggle());
        this.resetButton.connect('clicked', () => this.reset());
        buttons.add_child(this.startButton);
        buttons.add_child(this.resetButton);
        for (const child of [this.phaseLabel, this.timeLabel, buttons])
            this.actor.add_child(child);
        this._render();
    }

    get fraction() {
        const total = this.phase === 'focus' ? FOCUS : BREAK;
        return this.remaining / total;
    }

    toggle() {
        this.running = !this.running;
        if (this.running && !this._id) {
            this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._tick());
        }
        this._render();
        this._onChange();
    }

    reset() {
        this.running = false;
        this.phase = 'focus';
        this.remaining = FOCUS;
        this._render();
        this._onChange();
    }

    _tick() {
        if (!this.running) {
            this._id = 0;
            return GLib.SOURCE_REMOVE;
        }
        this.remaining -= 1;
        if (this.remaining <= 0) {
            this.phase = this.phase === 'focus' ? 'break' : 'focus';
            this.remaining = this.phase === 'focus' ? FOCUS : BREAK;
            this.running = false;
            this._id = 0;
            this._render();
            this._onChange(true);
            return GLib.SOURCE_REMOVE;
        }
        this._render();
        this._onChange();
        return GLib.SOURCE_CONTINUE;
    }

    _render() {
        const m = Math.floor(this.remaining / 60);
        const s = this.remaining % 60;
        this.timeLabel.text = `${m}:${String(s).padStart(2, '0')}`;
        this.phaseLabel.text = this.phase === 'focus' ? t('Focus', 'Concentration') : t('Break', 'Pause');
        this.startButton.label = this.running ? t('Pause', 'Pause') : t('Start', 'Démarrer');
    }

    destroy() {
        this.running = false;
        if (this._id) {
            GLib.source_remove(this._id);
            this._id = 0;
        }
    }
}

// ---------------------------------------------------------------- shelf

export class Shelf {
    constructor() {
        this.files = [];
        this.actor = new St.BoxLayout({style_class: 'gnomac-notch-shelf'});
        this._empty = new St.Label({
            text: t('Drop files here to keep them handy', 'Dépose des fichiers ici pour les garder à portée'),
            style_class: 'gnomac-notch-subtitle',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._empty);
    }

    add(uri) {
        if (this.files.includes(uri))
            return;
        this.files.push(uri);
        this._render();
    }

    _render() {
        this.actor.destroy_all_children();
        if (!this.files.length) {
            this.actor.add_child(this._empty);
            return;
        }
        for (const uri of this.files.slice(-6)) {
            const file = Gio.File.new_for_uri(uri);
            let gicon = null;
            try {
                gicon = file.query_info('standard::icon', Gio.FileQueryInfoFlags.NONE, null).get_icon();
            } catch {}
            const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
            column.add_child(new St.Icon({gicon, icon_name: 'text-x-generic', icon_size: 32,
                x_align: Clutter.ActorAlign.CENTER}));
            column.add_child(new St.Label({text: file.get_basename().slice(0, 12),
                style_class: 'gnomac-notch-cal-head', x_align: Clutter.ActorAlign.CENTER}));
            const button = new St.Button({style_class: 'gnomac-notch-shelf-item', child: column});
            button.connect('clicked', () => Gio.AppInfo.launch_default_for_uri(uri,
                global.create_app_launch_context(0, -1)));
            this.actor.add_child(button);
        }
    }
}
