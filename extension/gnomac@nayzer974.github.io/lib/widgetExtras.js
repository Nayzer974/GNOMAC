// More desktop widgets: analog clock, world clocks, day/week/month/year
// progress, countdown, photo, live CPU/memory graph and a weather forecast.
// Same contract as lib/widgetTypes.js: build(ctx) -> {actor, destroy?, update?,
// tick?, flush?}. ctx.accent is an [r, g, b] colour (0..1) or null.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {WeatherSource} from './weather.js';
import {COLORS, css} from './motion.js';
import {t} from './i18n.js';

const label = (text, styleClass) => new St.Label({text, style_class: styleClass});
const column = () => new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});

// A title in the widget's accent colour, as the system widgets of macOS do.
export function titleLabel(text, accent) {
    const title = label(text, 'gnomac-widget-title');
    if (accent)
        title.set_style(`color: ${css(accent, 0.95)};`);
    return title;
}

// A drawing area that never paints a disposed widget.
function canvas(draw, params = {}) {
    const area = new St.DrawingArea({x_expand: true, y_expand: true, ...params});
    let alive = true;
    area.connect('destroy', () => (alive = false));
    area.connect('repaint', a => {
        if (!alive)
            return;
        const cr = a.get_context();
        const [w, h] = a.get_surface_size();
        try {
            draw(cr, w, h);
        } finally {
            cr.$dispose();
        }
    });
    return area;
}

function ring(cr, cx, cy, radius, width, fraction, color) {
    cr.setLineWidth(width);
    cr.setLineCap(1);
    cr.setSourceRGBA(1, 1, 1, 0.16);
    cr.arc(cx, cy, radius, 0, 2 * Math.PI);
    cr.stroke();
    if (fraction <= 0)
        return;
    cr.setSourceRGBA(color[0], color[1], color[2], 1);
    cr.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, fraction));
    cr.stroke();
}

// ----------------------------------------------------------------- analog

function buildAnalog({accent}) {
    const second = accent ?? COLORS.orange;
    const area = canvas((cr, w, h) => {
        const now = GLib.DateTime.new_now_local();
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) / 2 - 8;
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.fill();
        for (let i = 0; i < 12; i++) {
            const a = i * Math.PI / 6;
            const long = i % 3 === 0;
            cr.setLineWidth(long ? 2.4 : 1.2);
            cr.setSourceRGBA(1, 1, 1, long ? 0.9 : 0.45);
            cr.moveTo(cx + Math.sin(a) * (r - (long ? 11 : 7)), cy - Math.cos(a) * (r - (long ? 11 : 7)));
            cr.lineTo(cx + Math.sin(a) * (r - 3), cy - Math.cos(a) * (r - 3));
            cr.stroke();
        }
        const hand = (angle, length, width, color) => {
            cr.setLineWidth(width);
            cr.setLineCap(1);
            cr.setSourceRGBA(color[0], color[1], color[2], color[3] ?? 1);
            cr.moveTo(cx - Math.sin(angle) * length * 0.12, cy + Math.cos(angle) * length * 0.12);
            cr.lineTo(cx + Math.sin(angle) * length, cy - Math.cos(angle) * length);
            cr.stroke();
        };
        const sec = now.get_second() + now.get_microsecond() / 1e6;
        const min = now.get_minute() + sec / 60;
        const hour = (now.get_hour() % 12) + min / 60;
        hand(hour * Math.PI / 6, r * 0.5, 4.2, [1, 1, 1]);
        hand(min * Math.PI / 30, r * 0.76, 3, [1, 1, 1]);
        hand(sec * Math.PI / 30, r * 0.84, 1.5, [...second, 1]);
        cr.setSourceRGBA(second[0], second[1], second[2], 1);
        cr.arc(cx, cy, 3.4, 0, 2 * Math.PI);
        cr.fill();
    });
    const box = column();
    area.margin_left = area.margin_right = 0;
    box.add_child(area);
    return {actor: box, update: () => area.queue_repaint(), tick: 1, flush: true};
}

// ------------------------------------------------------------- world clocks

const DEFAULT_ZONES = ['Europe/Paris', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney', 'America/Los_Angeles', 'Europe/London'];

export const zonesToText = zones => (zones ?? []).join(', ');
export const parseZones = text => text.split(/[,;\n]/).map(z => z.trim().replace(/ /g, '_'))
    .filter(z => z && GLib.TimeZone.new_identifier(z) !== null).slice(0, 8);

function buildWorld({size, options, accent}) {
    const box = column();
    box.add_child(titleLabel(t('World Clock', 'Horloge mondiale'), accent));
    const zones = options.zones?.length ? options.zones : DEFAULT_ZONES;
    const shown = zones.slice(0, size === 'large' ? 6 : 3);
    const rows = shown.map(zone => {
        const row = new St.BoxLayout({style_class: 'gnomac-world-row', x_expand: true});
        const city = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        const name = label(zone.split('/').pop().replace(/_/g, ' '), 'gnomac-world-city');
        const day = label('', 'gnomac-widget-caption');
        city.add_child(name);
        city.add_child(day);
        const time = label('', 'gnomac-world-time');
        time.y_align = Clutter.ActorAlign.CENTER;
        row.add_child(city);
        row.add_child(time);
        box.add_child(row);
        return {zone, day, time};
    });
    const update = () => {
        const local = GLib.DateTime.new_now_local();
        for (const {zone, day, time} of rows) {
            const tz = GLib.TimeZone.new_identifier(zone);
            if (!tz) {
                time.text = '—';
                continue;
            }
            const there = GLib.DateTime.new_now(tz);
            time.text = there.format('%H:%M');
            const diff = there.get_day_of_year() - local.get_day_of_year();
            const offset = (there.get_utc_offset() - local.get_utc_offset()) / 3.6e9;
            const hours = `${offset >= 0 ? '+' : '−'}${Math.abs(offset)} h`;
            day.text = diff === 0 || Math.abs(diff) > 300
                ? `${t('Today', 'Aujourd’hui')}, ${hours}`
                : (diff > 0 ? `${t('Tomorrow', 'Demain')}, ${hours}` : `${t('Yesterday', 'Hier')}, ${hours}`);
        }
    };
    update();
    return {actor: box, update, tick: 10};
}

// ----------------------------------------------------------------- progress

function buildProgress({size, accent}) {
    const box = column();
    box.add_child(titleLabel(t('Progress', 'Progression'), accent));
    const row = new St.BoxLayout({style_class: 'gnomac-progress-row', x_expand: true, y_expand: true});
    const colors = accent ? [accent, accent, accent, accent] : [COLORS.orange, COLORS.green, COLORS.blue, COLORS.purple];
    const names = [t('Day', 'Jour'), t('Week', 'Semaine'), t('Month', 'Mois'), t('Year', 'Année')];
    const fractions = [0, 0, 0, 0];
    const percents = [];
    names.forEach((name, i) => {
        const cell = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER});
        const dial = canvas((cr, w, h) => ring(cr, w / 2, h / 2, Math.min(w, h) / 2 - 5, 5, fractions[i], colors[i]),
            {width: size === 'large' ? 64 : 52, height: size === 'large' ? 64 : 52,
                x_expand: false, y_expand: false, x_align: Clutter.ActorAlign.CENTER});
        const pct = label('', 'gnomac-progress-percent');
        pct.x_align = Clutter.ActorAlign.CENTER;
        const caption = label(name, 'gnomac-widget-caption');
        caption.x_align = Clutter.ActorAlign.CENTER;
        cell.add_child(dial);
        cell.add_child(pct);
        cell.add_child(caption);
        row.add_child(cell);
        percents.push([dial, pct]);
    });
    box.add_child(row);
    const update = () => {
        const now = GLib.DateTime.new_now_local();
        const secondsToday = now.get_hour() * 3600 + now.get_minute() * 60 + now.get_second();
        fractions[0] = secondsToday / 86400;
        const weekday = (now.get_day_of_week() - 1) + fractions[0];
        fractions[1] = weekday / 7;
        const monthDays = GLib.Date.get_days_in_month(now.get_month(), now.get_year());
        fractions[2] = (now.get_day_of_month() - 1 + fractions[0]) / monthDays;
        const yearDays = (now.get_year() % 4 === 0 && (now.get_year() % 100 !== 0 || now.get_year() % 400 === 0)) ? 366 : 365;
        fractions[3] = (now.get_day_of_year() - 1 + fractions[0]) / yearDays;
        percents.forEach(([dial, pct], i) => {
            pct.text = `${Math.floor(fractions[i] * 100)} %`;
            dial.queue_repaint();
        });
    };
    update();
    return {actor: box, update, tick: 30};
}

// ---------------------------------------------------------------- countdown

export function parseEvent(text) {
    const [title, date] = text.includes(';') ? text.split(';') : ['', text];
    const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(date ?? '');
    if (!m)
        return null;
    return {title: title.trim(), date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`};
}

export const eventToText = event => (event ? `${event.title ?? ''} ; ${event.date}` : '');

function buildCountdown({options, accent}) {
    const box = column();
    box.add_child(titleLabel(t('Countdown', 'Compte à rebours'), accent));
    const big = label('', 'gnomac-countdown-days');
    const unit = label('', 'gnomac-widget-caption');
    const name = label('', 'gnomac-widget-text');
    for (const child of [big, unit, name])
        box.add_child(child);
    const target = () => {
        const now = GLib.DateTime.new_now_local();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(options.event?.date ?? '');
        if (m)
            return GLib.DateTime.new_local(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0);
        // Default: the next New Year.
        return GLib.DateTime.new_local(now.get_year() + 1, 1, 1, 0, 0, 0);
    };
    const update = () => {
        const now = GLib.DateTime.new_now_local();
        const today = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0);
        const days = Math.round((target().difference(today)) / 8.64e10);
        big.text = String(Math.abs(days));
        if (accent)
            big.set_style(`color: ${css(accent)};`);
        unit.text = days >= 0 ? t(days === 1 ? 'day left' : 'days left', days === 1 ? 'jour restant' : 'jours restants')
            : t('days ago', 'jours écoulés');
        name.text = options.event?.title || t('New Year', 'Nouvel An');
    };
    update();
    return {actor: box, update, tick: 60};
}

// -------------------------------------------------------------------- photo

function currentWallpaper() {
    try {
        const bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        for (const key of ['picture-uri-dark', 'picture-uri']) {
            const uri = bg.get_string(key);
            if (uri)
                return uri;
        }
    } catch {}
    return '';
}

export const photoToUri = text => {
    const value = text.trim();
    if (!value)
        return '';
    return value.startsWith('file://') ? value : `file://${value}`;
};

function buildPhoto({options}) {
    const uri = options.photo || currentWallpaper();
    const frame = new St.Widget({x_expand: true, y_expand: true, style_class: 'gnomac-photo'});
    if (uri) {
        // The tile clips its content to the rounded glass: the photo is a
        // cover-sized background of the content actor.
        frame.set_style(`background-image: url("${uri.replace(/"/g, '')}"); background-size: cover; border-radius: 22px;`);
    }
    return {actor: frame, flush: true};
}

// -------------------------------------------------------------------- graph

function buildGraph({size, accent}) {
    const N = 60;
    const cpu = new Array(N).fill(0);
    const mem = new Array(N).fill(0);
    let last = null;
    const read = path => {
        try {
            return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
        } catch {
            return '';
        }
    };
    const sample = () => {
        const line = read('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
        const idle = (line[3] ?? 0) + (line[4] ?? 0);
        const total = line.reduce((a, b) => a + b, 0);
        if (last && total > last.total)
            cpu.push(1 - (idle - last.idle) / (total - last.total));
        else
            cpu.push(cpu[cpu.length - 1] ?? 0);
        last = {idle, total};
        const info = Object.fromEntries(read('/proc/meminfo').split('\n').filter(Boolean)
            .map(l => [l.split(':')[0], parseInt(l.split(':')[1])]));
        mem.push(info.MemTotal ? 1 - info.MemAvailable / info.MemTotal : 0);
        cpu.shift();
        mem.shift();
    };
    const colors = [accent ?? COLORS.green, accent ? [accent[0] * 0.7, accent[1] * 0.7, accent[2] * 0.7] : COLORS.blue];
    const area = canvas((cr, w, h) => {
        const draw = (series, color) => {
            const step = w / (N - 1);
            cr.moveTo(0, h);
            series.forEach((v, i) => cr.lineTo(i * step, h - Math.max(0.02, v) * (h - 4)));
            cr.lineTo(w, h);
            cr.closePath();
            cr.setSourceRGBA(color[0], color[1], color[2], 0.28);
            cr.fillPreserve();
            cr.setLineWidth(1.8);
            cr.setSourceRGBA(color[0], color[1], color[2], 1);
            cr.newPath();
            series.forEach((v, i) => {
                const y = h - Math.max(0.02, v) * (h - 4);
                if (i === 0)
                    cr.moveTo(0, y);
                else
                    cr.lineTo(i * step, y);
            });
            cr.stroke();
        };
        draw(mem, colors[1]);
        draw(cpu, colors[0]);
    });
    const box = column();
    const head = new St.BoxLayout({x_expand: true});
    const cpuLabel = label('', 'gnomac-graph-label');
    const memLabel = label('', 'gnomac-graph-label');
    cpuLabel.set_style(`color: ${css(colors[0])};`);
    memLabel.set_style(`color: ${css(colors[1])};`);
    memLabel.x_expand = true;
    memLabel.x_align = Clutter.ActorAlign.END;
    head.add_child(cpuLabel);
    head.add_child(memLabel);
    box.add_child(titleLabel(t('Activity', 'Activité'), accent));
    box.add_child(head);
    box.add_child(area);
    const update = () => {
        sample();
        cpuLabel.text = `${t('CPU', 'Processeur')} ${Math.round(cpu[N - 1] * 100)} %`;
        memLabel.text = `${t('Memory', 'Mémoire')} ${Math.round(mem[N - 1] * 100)} %`;
        area.queue_repaint();
    };
    return {actor: box, update, tick: 1, size};
}

// ----------------------------------------------------------------- forecast

function buildForecast({instance, settings, options, accent}) {
    const box = column();
    box.add_child(titleLabel(t('Forecast', 'Prévisions'), accent));
    const row = new St.BoxLayout({style_class: 'gnomac-forecast-row', x_expand: true, y_expand: true});
    box.add_child(row);
    const source = new WeatherSource({
        get_string: key => (key === 'widget-weather-city'
            ? (options.city || settings.get_string('widget-weather-city')) : ''),
    }, () => {
        const days = source.data?.forecast;
        if (!days || !row.get_parent())
            return;
        row.destroy_all_children();
        for (const [i, day] of days.entries()) {
            const cell = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style_class: 'gnomac-forecast-day'});
            const name = label(i === 0 ? t('Today', 'Auj.') : day.weekday, 'gnomac-widget-caption');
            name.x_align = Clutter.ActorAlign.CENTER;
            const icon = new St.Icon({icon_name: day.icon, icon_size: 30, x_align: Clutter.ActorAlign.CENTER});
            const high = label(`${day.high}°`, 'gnomac-widget-big');
            high.x_align = Clutter.ActorAlign.CENTER;
            const low = label(`${day.low}°`, 'gnomac-widget-caption');
            low.x_align = Clutter.ActorAlign.CENTER;
            for (const child of [name, icon, high, low])
                cell.add_child(child);
            row.add_child(cell);
        }
    });
    source.start();
    return {actor: box, destroy: () => source.stop()};
}

export const WIDGET_EXTRAS = {
    analog: {title: t('Analog Clock', 'Horloge analogique'), icon: 'preferences-system-time-symbolic',
        sizes: ['small', 'large'], build: buildAnalog},
    world: {title: t('World Clock', 'Horloge mondiale'), icon: 'preferences-desktop-locale-symbolic',
        sizes: ['medium', 'large'], build: buildWorld,
        prompts: [{key: 'zones', label: t('Time zones (comma separated)', 'Fuseaux horaires (séparés par des virgules)'),
            hint: 'Europe/Paris, Asia/Tokyo', parse: parseZones, format: zonesToText}]},
    progress: {title: t('Progress', 'Progression'), icon: 'view-refresh-symbolic',
        sizes: ['medium', 'large'], build: buildProgress},
    countdown: {title: t('Countdown', 'Compte à rebours'), icon: 'alarm-symbolic',
        sizes: ['small', 'medium'], build: buildCountdown,
        prompts: [{key: 'event', label: t('Event: Title ; YYYY-MM-DD', 'Évènement : Titre ; AAAA-MM-JJ'),
            hint: 'Vacances ; 2027-07-14', parse: parseEvent, format: eventToText}]},
    photo: {title: t('Photo', 'Photo'), icon: 'image-x-generic-symbolic',
        sizes: ['medium', 'large', 'xxl'], build: buildPhoto,
        prompts: [{key: 'photo', label: t('Image path (empty = wallpaper)', 'Chemin de l’image (vide = fond d’écran)'),
            hint: '/home/vous/Images/photo.jpg', parse: photoToUri, format: v => (v ?? '').replace(/^file:\/\//, '')}]},
    graph: {title: t('Activity', 'Activité'), icon: 'utilities-system-monitor-symbolic',
        sizes: ['medium', 'large'], build: buildGraph},
    forecast: {title: t('Forecast', 'Prévisions'), icon: 'weather-few-clouds-symbolic',
        sizes: ['medium', 'large'], build: buildForecast,
        prompts: [{key: 'city', label: t('City', 'Ville'), hint: 'Paris', parse: v => v.trim(), format: v => v ?? ''}]},
};
