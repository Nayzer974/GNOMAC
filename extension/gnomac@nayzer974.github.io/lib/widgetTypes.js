// Desktop widget types. Every type is {id, title, icon, sizes, build(ctx)}:
// build() receives a context and returns {actor, destroy, update?}. The
// layout manager (modules/widgets.js) owns glass, placement, editing and
// persistence; a type only fills its tile's content.
//
// Sizes are grid spans in cells of CELL px (like macOS: small 1x1, medium
// 2x1, large 2x2, extra large 4x2).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';

import {MonthCalendar, PomodoroTimer} from './notchViews.js';
import {StatsPage} from './notchPages.js';
import {WeatherSource} from './weather.js';
import {COLORS, css, press} from './motion.js';
import {t} from './i18n.js';
import {WIDGET_EXTRAS, titleLabel} from './widgetExtras.js';

// One grid unit is CELL px; tiles span whole units and the gap is added
// between units, like macOS widgets (small is a square, medium is twice as
// wide, large is a 2x2, extra large is 3x2 mediums).
export const CELL = 88;
export const CELL_GAP = 14;

// Grid span (columns x rows) in units for each size name.
export const SIZE_SPANS = {
    small: [2, 2],
    medium: [4, 2],
    tall: [2, 4],
    large: [4, 4],
    wide: [6, 2],
    xxl: [6, 4],
};

export const SIZE_TITLES = {
    small: t('Small', 'Petit'),
    medium: t('Medium', 'Moyen'),
    tall: t('Tall', 'Haut'),
    large: t('Large', 'Grand'),
    wide: t('Wide', 'Large bandeau'),
    xxl: t('Extra Large', 'Très grand'),
};

// The accent colours of macOS (plus "auto": the widget keeps its own look).
export const ACCENTS = {
    auto: {title: t('Automatic', 'Automatique'), rgb: null},
    blue: {title: t('Blue', 'Bleu'), rgb: [0.039, 0.518, 1.0]},
    purple: {title: t('Purple', 'Violet'), rgb: [0.749, 0.353, 0.949]},
    pink: {title: t('Pink', 'Rose'), rgb: [1.0, 0.216, 0.373]},
    red: {title: t('Red', 'Rouge'), rgb: [1.0, 0.271, 0.227]},
    orange: {title: t('Orange', 'Orange'), rgb: [1.0, 0.624, 0.039]},
    yellow: {title: t('Yellow', 'Jaune'), rgb: [1.0, 0.84, 0.039]},
    green: {title: t('Green', 'Vert'), rgb: [0.188, 0.82, 0.345]},
    teal: {title: t('Teal', 'Turquoise'), rgb: [0.25, 0.78, 0.88]},
    graphite: {title: t('Graphite', 'Graphite'), rgb: [0.6, 0.6, 0.64]},
};

const UPOWER = `<node><interface name="org.freedesktop.UPower.Device">
  <property name="Type" type="u" access="read"/>
  <property name="State" type="u" access="read"/>
  <property name="Percentage" type="d" access="read"/>
  <property name="IsPresent" type="b" access="read"/>
</interface></node>`;
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPOWER);

const label = (text, styleClass) => new St.Label({text, style_class: styleClass});
const column = () => new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});

// ------------------------------------------------------------------ clock

function buildClock({accent}) {
    const box = column();
    const time = label('', 'gnomac-widget-clock');
    const date = label('', 'gnomac-widget-caption');
    if (accent)
        date.set_style(`color: ${css(accent, 0.95)};`);
    box.add_child(time);
    box.add_child(date);
    const update = () => {
        const now = GLib.DateTime.new_now_local();
        time.text = now.format('%H:%M');
        date.text = now.format('%A %-d %B');
    };
    update();
    return {actor: box, update, tick: 1};
}

// ------------------------------------------------------------------ battery

function buildBattery({size, accent}) {
    const box = new St.BoxLayout({style_class: 'gnomac-widget-row', x_expand: true, y_expand: true});
    const ring = new St.DrawingArea({width: size === 'small' ? 50 : 64, height: size === 'small' ? 50 : 64,
        y_align: Clutter.ActorAlign.CENTER});
    const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
    const percent = label('', 'gnomac-widget-big');
    const state = label('', 'gnomac-widget-caption');
    text.add_child(percent);
    text.add_child(state);
    box.add_child(ring);
    box.add_child(text);
    let proxy = null;
    let proxyId = 0;
    // At shell shutdown the tile dies while UPower can still notify, and a
    // disposed GObject cannot even be asked whether it is alive: track it.
    let alive = true;
    box.connect('destroy', () => (alive = false));
    const paint = area => {
        if (!alive)
            return;
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const value = (proxy?.Percentage ?? 0) / 100;
        const charging = proxy?.State === 1;
        cr.setLineWidth(6);
        cr.setSourceRGBA(1, 1, 1, 0.18);
        cr.arc(w / 2, h / 2, w / 2 - 5, 0, 2 * Math.PI);
        cr.stroke();
        if (charging)
            cr.setSourceRGBA(...COLORS.green, 1);
        else if (value <= 0.2)
            cr.setSourceRGBA(...COLORS.red, 1);
        else if (accent)
            cr.setSourceRGBA(...accent, 1);
        else
            cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.setLineCap(1);
        cr.arc(w / 2, h / 2, w / 2 - 5, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * value);
        cr.stroke();
        cr.$dispose();
    };
    ring.connect('repaint', paint);
    const sync = () => {
        if (!proxy || !alive)
            return;
        const present = proxy.IsPresent && proxy.Type === 2;
        percent.text = present ? `${Math.round(proxy.Percentage)} %` : '—';
        state.text = !present ? t('Plugged in', 'Sur secteur')
            : (proxy.State === 1 ? t('Charging', 'En charge') : t('On battery', 'Sur batterie'));
        ring.queue_repaint();
    };
    new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower',
        '/org/freedesktop/UPower/devices/DisplayDevice', (p, error) => {
            if (error || !alive)
                return;
            proxy = p;
            proxyId = p.connect('g-properties-changed', sync);
            sync();
        });
    return {actor: box, destroy: () => {
        if (proxy && proxyId)
            proxy.disconnect(proxyId);
        proxy = null;
    }};
}

// ------------------------------------------------------------------ calendar

function buildCalendar() {
    const calendar = new MonthCalendar();
    calendar.update();
    return {actor: calendar.actor, update: () => calendar.update(), tick: 30};
}

// ------------------------------------------------------------------ reminders

function buildReminders({settings, accent}) {
    const box = column();
    box.add_child(titleLabel(t('Reminders', 'Rappels'), accent));
    const list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gnomac-widget-list'});
    const entry = new St.Entry({style_class: 'gnomac-widget-entry', hint_text: t('New reminder', 'Nouveau rappel'),
        can_focus: true});
    box.add_child(list);
    box.add_child(entry);
    const render = () => {
        list.destroy_all_children();
        for (const text of settings.get_strv('widget-reminders').slice(-5)) {
            const row = new St.BoxLayout({style_class: 'gnomac-widget-reminder'});
            const done = press(new St.Button({style_class: 'gnomac-widget-check', can_focus: false}));
            if (accent)
                done.set_style(`border-color: ${css(accent)};`);
            done.connect('clicked', () => {
                const all = settings.get_strv('widget-reminders');
                const index = all.lastIndexOf(text);
                if (index >= 0)
                    all.splice(index, 1);
                settings.set_strv('widget-reminders', all);
                render();
            });
            row.add_child(done);
            row.add_child(new St.Label({text, style_class: 'gnomac-widget-text', y_align: Clutter.ActorAlign.CENTER}));
            list.add_child(row);
        }
    };
    entry.clutter_text.connect('activate', () => {
        const text = entry.text.trim();
        if (!text)
            return;
        settings.set_strv('widget-reminders', [...settings.get_strv('widget-reminders'), text]);
        entry.text = '';
        render();
    });
    render();
    return {actor: box};
}

// ------------------------------------------------------------------ notes

function buildNotes({instance, accent}) {
    const box = column();
    box.add_child(titleLabel(t('Notes', 'Notes'), accent));
    const entry = new St.Entry({style_class: 'gnomac-widget-notes', can_focus: true, x_expand: true, y_expand: true});
    entry.clutter_text.set_single_line_mode(false);
    entry.clutter_text.set_line_wrap(true);
    entry.clutter_text.set_activatable(false);
    entry.text = instance.options.text ?? '';
    // Saved when the focus leaves (every keystroke would rewrite the layout).
    entry.clutter_text.connect('key-focus-out', () => {
        instance.options.text = entry.text;
        instance.save();
    });
    box.add_child(entry);
    return {actor: box};
}

// ------------------------------------------------------------------ weather

function buildWeather({settings, instance, accent}) {
    const box = column();
    box.add_child(titleLabel(t('Weather', 'Météo'), accent));
    const row = new St.BoxLayout({style_class: 'gnomac-widget-row'});
    const icon = new St.Icon({icon_size: 34, y_align: Clutter.ActorAlign.CENTER});
    const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
    const temp = label('…', 'gnomac-widget-big');
    const caption = label('', 'gnomac-widget-caption');
    text.add_child(temp);
    text.add_child(caption);
    row.add_child(icon);
    row.add_child(text);
    const range = label('', 'gnomac-widget-caption');
    box.add_child(row);
    box.add_child(range);
    // The city can be set per widget; the global setting is the default.
    const source = new WeatherSource({
        get_string: key => (key === 'widget-weather-city'
            ? (instance.options.city || settings.get_string('widget-weather-city')) : ''),
    }, () => {
        const d = source.data;
        if (!d)
            return;
        temp.text = `${d.temp}°`;
        icon.icon_name = d.icon;
        caption.text = d.city || d.description;
        range.text = `${d.description} · ${d.high}° / ${d.low}°`;
    });
    source.start();
    return {actor: box, destroy: () => source.stop()};
}

// ------------------------------------------------------------------ music

function buildMusic({accent}) {
    const box = column();
    box.add_child(titleLabel(t('Now Playing', 'Lecture en cours'), accent));
    const title = label('', 'gnomac-widget-music-title');
    const artist = label('', 'gnomac-widget-caption');
    const controls = new St.BoxLayout({style_class: 'gnomac-widget-music-controls'});
    let player = null;
    const button = (icon, action) => {
        const b = press(new St.Button({style_class: 'gnomac-widget-music-button', can_focus: false,
            child: new St.Icon({icon_name: icon, icon_size: 16})}));
        b.connect('clicked', () => action());
        controls.add_child(b);
        return b;
    };
    button('media-skip-backward-symbolic', () => player?.previous());
    const play = button('media-playback-start-symbolic', () => player?.playPause());
    button('media-skip-forward-symbolic', () => player?.next());
    for (const child of [title, artist, controls])
        box.add_child(child);
    const source = new Mpris.MprisSource();
    const sync = () => {
        if (title.is_finalized?.())
            return;
        const active = !!player && player.canPlay;
        title.text = active ? (player.trackTitle || t('Unknown title', 'Titre inconnu')) : t('Nothing playing', 'Aucune lecture');
        artist.text = active ? (player.trackArtists ?? []).join(', ') : '';
        play.child.icon_name = active && player.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
    };
    const watch = p => {
        p.connectObject('changed', () => {
            if (p.status === 'Playing' || !player)
                player = p;
            sync();
        }, box);
        if (p.status === 'Playing' || !player)
            player = p;
        sync();
    };
    const ids = [
        source.connect('player-added', (_s, p) => watch(p)),
        source.connect('player-removed', () => {
            player = source.players.find(p => p.status === 'Playing') ?? source.players[0] ?? null;
            sync();
        }),
    ];
    source.players.forEach(watch);
    sync();
    return {actor: box, destroy: () => ids.forEach(id => source.disconnect(id))};
}

// ------------------------------------------------------------------ stats

function buildStats() {
    const page = new StatsPage();
    // update() sizes bars from actors that are not on stage yet: the
    // manager's ticker (every 2 s) takes the first reading once they are.
    return {actor: page.actor, update: () => page.update(), tick: 2};
}

// ------------------------------------------------------------------ timer

function buildTimer({settings}) {
    const timer = new PomodoroTimer(settings, () => {});
    return {actor: timer.actor, destroy: () => timer.destroy()};
}

// ------------------------------------------------------------------ shortcuts

function buildShortcuts({instance}) {
    const grid = new St.Widget({x_expand: true, y_expand: true,
        layout_manager: new Clutter.GridLayout({column_spacing: 10, row_spacing: 10})});
    const ids = instance.options.apps?.length ? instance.options.apps
        : ['org.gnome.Nautilus.desktop', 'org.gnome.Ptyxis.desktop', 'firefox.desktop', 'org.gnome.Settings.desktop'];
    const system = Gio.AppInfo.get_all();
    ids.forEach((id, i) => {
        const info = system.find(a => a.get_id() === id);
        if (!info)
            return;
        const button = press(new St.Button({style_class: 'gnomac-widget-app', can_focus: false,
            child: new St.Icon({gicon: info.get_icon(), icon_size: 40})}));
        button.connect('clicked', () => info.launch([], global.create_app_launch_context(0, -1)));
        grid.layout_manager.attach(button, i % 4, Math.floor(i / 4), 1, 1);
    });
    return {actor: grid};
}

// ------------------------------------------------------------------ registry

export const WIDGET_TYPES = {
    clock: {title: t('Clock', 'Horloge'), icon: 'preferences-system-time-symbolic',
        sizes: ['medium', 'small', 'wide'], build: buildClock},
    battery: {title: t('Battery', 'Batterie'), icon: 'battery-symbolic',
        sizes: ['small', 'medium'], build: buildBattery},
    calendar: {title: t('Calendar', 'Calendrier'), icon: 'x-office-calendar-symbolic',
        sizes: ['large', 'xxl'], build: buildCalendar},
    reminders: {title: t('Reminders', 'Rappels'), icon: 'checkbox-checked-symbolic',
        sizes: ['small', 'medium', 'tall', 'large'], build: buildReminders},
    notes: {title: t('Notes', 'Notes'), icon: 'document-edit-symbolic',
        sizes: ['medium', 'small', 'tall', 'large'], build: buildNotes},
    weather: {title: t('Weather', 'Météo'), icon: 'weather-clear-symbolic',
        sizes: ['small', 'medium', 'wide'], build: buildWeather,
        prompts: [{key: 'city', label: t('City', 'Ville'), hint: 'Paris', parse: v => v.trim(), format: v => v ?? ''}]},
    music: {title: t('Now Playing', 'Lecture en cours'), icon: 'multimedia-player-symbolic',
        sizes: ['medium', 'wide', 'large'], build: buildMusic},
    stats: {title: t('System', 'Système'), icon: 'utilities-system-monitor-symbolic',
        sizes: ['large', 'xxl'], build: buildStats},
    timer: {title: t('Timer', 'Minuteur'), icon: 'alarm-symbolic',
        sizes: ['large', 'medium'], build: buildTimer},
    shortcuts: {title: t('Shortcuts', 'Raccourcis'), icon: 'view-app-grid-symbolic',
        sizes: ['medium', 'large'], build: buildShortcuts},
    ...WIDGET_EXTRAS,
};

// Materials: how a tile's glass looks.
export const MATERIALS = {
    clear: {title: t('Clear', 'Clair'), tintAlpha: 0.05, blur: 40},
    frosted: {title: t('Frosted', 'Dépoli'), tintAlpha: 0.22, blur: 80},
    tinted: {title: t('Tinted', 'Teinté'), tintAlpha: 0.5, blur: 50, accent: true},
    color: {title: t('Colour', 'Couleur'), tintAlpha: 0.62, blur: 40, accent: true},
    dark: {title: t('Dark', 'Sombre'), tintAlpha: 0.7, blur: 60, base: [0.04, 0.04, 0.06]},
};

// The layout a fresh install starts from: a tidy first screen, each tile in
// its own accent colour.
export function defaultLayout() {
    const w = (type, size, col, row, extra = {}) => ({id: `w-${type}`, type, size, col, row,
        material: 'clear', color: 'auto', options: {}, ...extra});
    return [
        w('analog', 'small', 0, 0, {color: 'orange'}),
        w('battery', 'small', 2, 0, {color: 'green'}),
        w('calendar', 'large', 4, 0),
        w('weather', 'small', 8, 0, {color: 'blue'}),
        w('reminders', 'medium', 0, 2, {color: 'orange'}),
        w('music', 'medium', 0, 4, {color: 'pink'}),
        w('progress', 'medium', 4, 4, {color: 'purple'}),
    ];
}

export const accentCss = css;
