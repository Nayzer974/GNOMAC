// Dynamic Island, modelled on RevoShell's: not a floating pill but a notch
// hanging from the top edge of the screen, flat against it, with concave
// "ears" blending into the edge and rounded bottom corners.
//  - resting: artwork + equalizer on the left, the time in the middle,
//    an unread-notification badge on the right (always visible),
//  - hover / click with a player: grows into a media card (title, artist,
//    app icon, progress bar, transport controls),
//  - hover without a player: widens to show the full date,
//  - workspace switch: the time briefly becomes workspace dots,
//  - notification (optional setting): grows into a notification card.
// Width and height ride springs; the shape is redrawn with Cairo.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';

import {ActionsPage, ClipboardPage, IdleHome, StatsPage} from '../lib/notchPages.js';
import {startClipboard, stopClipboard} from '../lib/clipboardHistory.js';
import {cascade, press, slideIn} from '../lib/motion.js';
import {MonthCalendar, PomodoroTimer, Shelf} from '../lib/notchViews.js';
import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';

const EAR = 7;
const SIZES = {
    rest: {width: 156, height: 24},
    // The folded notch widens when it has something to show on its sides.
    restBusy: {width: 232, height: 24},
    // Grows down, never sideways far: the wide card sits under the menu bar,
    // not over it, and menus that would overlap are hidden by AppMenus.
    date: {width: 230, height: 78},
    media: {width: 400, height: 132},
    dashboard: {width: 560, height: 206},
    notice: {width: 400, height: 78},
    hud: {width: 300, height: 34},
};
const WORKSPACE_MS = 1400;
const BARS = 4;

function coverStyle(url, size) {
    const base = `width: ${size}px; height: ${size}px; border-radius: ${size / 2}px;`;
    if (!url || !url.startsWith('file://'))
        return `${base} background-color: rgba(255,255,255,0.16);`;
    return `${base} background-image: url("${url}"); background-size: cover;`;
}

function formatTime(us) {
    const s = Math.max(0, Math.floor(us / 1e6));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Flat top on the screen edge, concave ears, round bottom corners.
function drawNotch(area, material = 0) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const e = Math.min(EAR, h / 2);
    const r = Math.max(1, Math.min(h - e, (w - 2 * e) / 2, 22));
    cr.moveTo(0, 0);
    cr.lineTo(w, 0);
    cr.arcNegative(w, e, e, -Math.PI / 2, -Math.PI);
    cr.lineTo(w - e, h - r);
    cr.arc(w - e - r, h - r, r, 0, Math.PI / 2);
    cr.lineTo(e + r, h);
    cr.arc(e + r, h - r, r, Math.PI / 2, Math.PI);
    cr.lineTo(e, e);
    cr.arcNegative(0, e, e, 0, -Math.PI / 2);
    cr.closePath();
    cr.setSourceRGBA(0, 0, 0, 1);
    cr.fillPreserve();
    if (material > 0.01) {
        // The glass material expands after the geometry: a faint light from
        // the top and a hairline edge, growing with the card (nothing when folded).
        const sheen = new Cairo.LinearGradient(0, 0, 0, h);
        sheen.addColorStopRGBA(0, 1, 1, 1, 0.07 * material);
        sheen.addColorStopRGBA(0.55, 1, 1, 1, 0);
        cr.setSource(sheen);
        cr.fillPreserve();
        cr.setLineWidth(1);
        cr.setSourceRGBA(1, 1, 1, 0.16 * material);
        cr.stroke();
    } else {
        cr.newPath();
    }
    cr.$dispose();
}

function bars(count) {
    const box = new St.BoxLayout({style_class: 'gnomac-island-bars', y_align: Clutter.ActorAlign.CENTER});
    const actors = [];
    for (let i = 0; i < count; i++) {
        const bar = new St.Widget({style_class: 'gnomac-island-bar', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(bar);
        actors.push(bar);
    }
    return [box, actors];
}

const Island = GObject.registerClass({
    Signals: {'tab': {param_types: [GObject.TYPE_STRING]}, 'timer-changed': {param_types: [GObject.TYPE_BOOLEAN]},
        'close-request': {}},
}, class Island extends St.Widget {
    _init(settings) {
        super._init({name: 'gnomacDynamicIsland', reactive: true, track_hover: true});
        this._settings = settings;

        this.shape = new St.DrawingArea({reactive: false});
        this.shape.connect('repaint', area => drawNotch(area, this._material ?? 0));
        this.add_child(this.shape);

        // Resting row.
        this.rest = new St.Widget({layout_manager: new Clutter.BinLayout()});
        const left = new St.BoxLayout({style_class: 'gnomac-notch-side',
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER});
        this.restArt = new St.Widget({y_align: Clutter.ActorAlign.CENTER});
        [this.bars, this.barActors] = bars(BARS);
        left.add_child(this.restArt);
        left.add_child(this.bars);
        this.clock = new St.Label({style_class: 'gnomac-notch-clock',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.dots = new St.BoxLayout({style_class: 'gnomac-notch-dots', visible: false,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.ring = new St.DrawingArea({style_class: 'gnomac-notch-ring', width: 18, height: 18,
            visible: false, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END});
        this.ring.connect('repaint', area => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            const fraction = this.timer?.fraction ?? 1;
            cr.setLineWidth(2.4);
            cr.setSourceRGBA(1, 1, 1, 0.18);
            cr.arc(w / 2, h / 2, w / 2 - 2, 0, 2 * Math.PI);
            cr.stroke();
            const [cr_, cg, cb] = this.timer?.color ?? [1, 0.62, 0.04];
            cr.setSourceRGBA(cr_, cg, cb, 1);
            cr.arc(w / 2, h / 2, w / 2 - 2, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * fraction);
            cr.stroke();
            cr.$dispose();
        });
        this.badge = new St.BoxLayout({style_class: 'gnomac-notch-side',
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        this.badge.add_child(new St.Widget({style_class: 'gnomac-notch-badge-dot',
            y_align: Clutter.ActorAlign.CENTER}));
        this.badgeLabel = new St.Label({style_class: 'gnomac-notch-badge', y_align: Clutter.ActorAlign.CENTER});
        this.badge.add_child(this.badgeLabel);
        // BinLayout only honours x_align/y_align on children that expand into
        // the whole cell; without it everything piles up in the middle.
        for (const child of [left, this.clock, this.dots, this.ring, this.badge]) {
            child.x_expand = true;
            child.y_expand = true;
            this.rest.add_child(child);
        }
        this.add_child(this.rest);

        // Media card.
        this.media = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-media'});
        const top = new St.BoxLayout({style_class: 'gnomac-notch-media-top'});
        this.mediaArt = new St.Widget({reactive: true, y_align: Clutter.ActorAlign.CENTER});
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this.title = new St.Label({style_class: 'gnomac-notch-title'});
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.artist = new St.Label({style_class: 'gnomac-notch-subtitle'});
        this.artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(this.title);
        text.add_child(this.artist);
        [this.mediaBars, this.mediaBarActors] = bars(BARS);
        this.appIcon = new St.Icon({icon_size: 18, y_align: Clutter.ActorAlign.CENTER});
        for (const child of [this.mediaArt, text, this.mediaBars, this.appIcon])
            top.add_child(child);

        const progress = new St.BoxLayout({style_class: 'gnomac-notch-progress'});
        this.elapsed = new St.Label({style_class: 'gnomac-notch-time', y_align: Clutter.ActorAlign.CENTER});
        // The track is a plain container and the fill is placed by hand: it
        // grows from the left edge (a centred or aligned child grew from the middle).
        this.track = new St.Widget({style_class: 'gnomac-notch-track', x_expand: true, reactive: true,
            y_align: Clutter.ActorAlign.CENTER});
        this.fill = new St.Widget({style_class: 'gnomac-notch-fill', reactive: false});
        this.track.add_child(this.fill);
        this.track.connect('notify::height', () => this.setFill(this.fill, this.track, this._progress ?? 0));
        this.remaining = new St.Label({style_class: 'gnomac-notch-time', y_align: Clutter.ActorAlign.CENTER});
        for (const child of [this.elapsed, this.track, this.remaining])
            progress.add_child(child);

        const controls = new St.BoxLayout({style_class: 'gnomac-notch-controls',
            x_align: Clutter.ActorAlign.CENTER});
        this.prevButton = this._control('media-skip-backward-symbolic', 18);
        this.playButton = this._control('media-playback-pause-symbolic', 22);
        this.nextButton = this._control('media-skip-forward-symbolic', 18);
        for (const child of [this.prevButton, this.playButton, this.nextButton])
            controls.add_child(child);

        // The player rows live on the dashboard's Home page; `media` stays
        // as an (unused) empty container so older code paths keep working.
        this._playerRows = [top, progress, controls];
        this.media = new St.Widget({visible: false});
        this.add_child(this.media);

        // Volume / brightness HUD (replaces GNOME's OSD), like Alcove.
        this.hud = new St.BoxLayout({style_class: 'gnomac-notch-hud'});
        this.hudIcon = new St.Icon({icon_size: 16, y_align: Clutter.ActorAlign.CENTER});
        this.hudTrack = new St.Widget({style_class: 'gnomac-notch-track', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this.hudFill = new St.Widget({style_class: 'gnomac-notch-fill', reactive: false});
        this.hudTrack.add_child(this.hudFill);
        this.hud.add_child(this.hudIcon);
        this.hud.add_child(this.hudTrack);
        this.add_child(this.hud);

        // Notification card.
        this.notice = new St.BoxLayout({style_class: 'gnomac-notch-notice'});
        this.noticeIcon = new St.Icon({icon_size: 32, y_align: Clutter.ActorAlign.CENTER});
        const noticeText = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this.noticeTitle = new St.Label({style_class: 'gnomac-notch-title'});
        this.noticeTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.noticeBody = new St.Label({style_class: 'gnomac-notch-subtitle'});
        this.noticeBody.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        noticeText.add_child(this.noticeTitle);
        noticeText.add_child(this.noticeBody);
        this.notice.add_child(this.noticeIcon);
        this.notice.add_child(noticeText);
        this.add_child(this.notice);

        // Wide dashboard: player + calendar on "Home", timer, shelf.
        this.dashboard = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-dashboard'});
        this.pages = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
        this.homePage = new St.BoxLayout({style_class: 'gnomac-notch-home'});
        this.homePlayer = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            style_class: 'gnomac-notch-home-player'});
        this.calendar = new MonthCalendar();
        for (const row of this._playerRows)
            this.homePlayer.add_child(row);
        // Nothing playing: a big clock and one-tap chips take the player's place.
        this.idleHome = new IdleHome(() => this.emit('close-request'));
        this.homePage.add_child(this.homePlayer);
        this.homePage.add_child(this.idleHome.actor);
        this.homePage.add_child(this.calendar.actor);
        this.timer = new PomodoroTimer(this._settings, finished => this.emit('timer-changed', finished));
        this.timerPage = this.timer.actor;
        this.shelf = new Shelf();
        this.shelf.load(settings.get_strv('island-shelf'));
        this.shelf.onChange = files => settings.set_strv('island-shelf', files);
        this.shelfPage = this.shelf.actor;
        this.statsView = new StatsPage();
        this.statsPage = this.statsView.actor;
        this.actionsView = new ActionsPage(() => this.emit('close-request'));
        this.actionsPage = this.actionsView.actor;
        this.clipboardView = new ClipboardPage();
        this.clipboardPage = this.clipboardView.actor;
        this.pageMap = {
            home: this.homePage, stats: this.statsPage, actions: this.actionsPage,
            clipboard: this.clipboardPage, timer: this.timerPage, shelf: this.shelfPage,
        };
        for (const page of Object.values(this.pageMap))
            this.pages.add_child(page);

        const tabs = new St.BoxLayout({style_class: 'gnomac-notch-tabs', x_align: Clutter.ActorAlign.CENTER});
        this.tabBar = tabs;
        this.tabButtons = [];
        [['user-home-symbolic', 'home'], ['utilities-system-monitor-symbolic', 'stats'],
            ['view-grid-symbolic', 'actions'], ['edit-paste-symbolic', 'clipboard'],
            ['alarm-symbolic', 'timer'], ['folder-symbolic', 'shelf']].forEach(([icon, id]) => {
            const button = new St.Button({style_class: 'gnomac-notch-tab', toggle_mode: true, can_focus: false,
                child: new St.Icon({icon_name: icon, icon_size: 13})});
            button.connect('clicked', () => this.emit('tab', id));
            press(button, {down: 0.85});
            tabs.add_child(button);
            this.tabButtons.push([id, button]);
        });
        this.dashboard.add_child(this.pages);
        this.dashboard.add_child(tabs);
        this.add_child(this.dashboard);
    }

    showTab(tab) {
        const order = this.tabButtons.map(([id]) => id);
        const direction = order.indexOf(tab) >= order.indexOf(this._shownTab ?? tab) ? 1 : -1;
        const changed = this._shownTab !== undefined && this._shownTab !== tab;
        for (const [id, page] of Object.entries(this.pageMap))
            page.visible = id === tab;
        for (const [id, button] of this.tabButtons)
            button.checked = id === tab;
        // Pages slide in from the side of the tab you moved towards.
        if (changed)
            slideIn(this.pageMap[tab], direction);
        this._shownTab = tab;
    }

    // Everything on the current page pops in, one piece after another.
    cascadeContent() {
        const page = this.pageMap[this._shownTab ?? 'home'];
        if (page)
            cascade(page.get_children(), {delay: 30});
    }

    // Fills `track` from its left edge up to `fraction` (0..1).
    setFill(fill, track, fraction) {
        const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
        fill.set_position(0, 0);
        fill.set_size(Math.round(track.width * f), track.height);
    }

    _control(iconName, size) {
        return press(new St.Button({
            style_class: 'gnomac-island-control',
            child: new St.Icon({icon_name: iconName, icon_size: size}),
            can_focus: true,
        }), {down: 0.82});
    }
});

export class DynamicIsland {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._players = new Set();
        this._player = null;
        this._mode = 'rest';
        this._noticeUntil = 0;
        this._workspaceUntil = 0;
        this._pinned = false;
        this._phase = 0;
        this._position = 0;
        this._length = 0;
        this._tick = dt => this._onTick(dt);
        this._signals = [];
        // How present each content group is (0..1). Content is never switched
        // on or off in the middle of a morph: it fades with the geometry, which
        // is what gates it (see _layout).
        this._presence = {rest: 1, hud: 0, notice: 0, dashboard: 0};
        this._pendingSize = null;
    }

    _activeContent() {
        switch (this._mode) {
        case 'dashboard': return 'dashboard';
        case 'notice':
        case 'date': return 'notice';
        case 'hud': return 'hud';
        }
        return 'rest';
    }

    _stepPresence(dt) {
        const active = this._activeContent();
        let moving = false;
        for (const key of Object.keys(this._presence)) {
            const target = key === active ? 1 : 0;
            const current = this._presence[key];
            if (current === target)
                continue;
            // Leaving content compresses first (fast); arriving content waits
            // for the geometry (it is gated in _layout) and rises calmly.
            const rate = target === 0 ? 1 / 0.14 : 1 / 0.22;
            const step = dt * rate;
            this._presence[key] = target > current ? Math.min(target, current + step) : Math.max(target, current - step);
            moving = true;
        }
        // The glass material follows the geometry a little later than the shape.
        const grow = this._grow ?? 0;
        const before = this.island._material ?? 0;
        let material = before + (grow - before) * (1 - Math.exp(-dt * 7));
        if (Math.abs(material - grow) < 0.005)
            material = grow;
        this.island._material = material;
        return moving || material !== grow;
    }

    // The island's personal settings, read once per (re)load.
    _readConfig() {
        const get = this._settings;
        const all = ['home', 'stats', 'actions', 'clipboard', 'timer', 'shelf'];
        let tabs = get.get_strv('island-tabs').filter(id => all.includes(id));
        if (!tabs.length)
            tabs = ['home'];
        let first = get.get_string('island-default-tab');
        if (!tabs.includes(first))
            first = tabs[0];
        const scale = get.get_double('island-scale');
        this._cfg = {
            trigger: get.get_string('island-open-trigger'),
            hoverDelay: get.get_int('island-hover-delay'),
            closeDelay: get.get_int('island-close-delay'),
            autoClose: get.get_int('island-autoclose-seconds'),
            restStyle: get.get_string('island-rest-style'),
            showClock: get.get_boolean('island-show-clock'),
            h24: get.get_boolean('island-clock-24h'),
            showBadge: get.get_boolean('island-show-badge'),
            showRing: get.get_boolean('island-show-timer-ring'),
            showMedia: get.get_boolean('island-show-media'),
            hud: get.get_boolean('island-hud'),
            hudMs: Math.round(get.get_double('island-hud-seconds') * 1000),
            noticeMs: get.get_int('island-notice-seconds') * 1000,
            bounce: get.get_boolean('island-bounce'),
            cascade: get.get_boolean('island-cascade'),
            hideFullscreen: get.get_boolean('island-hide-fullscreen'),
            remember: get.get_boolean('island-remember-tab'),
            tabs,
            firstTab: first,
        };
        // Widths follow the scale; heights only for the open states, so the
        // folded notch keeps the height of the menu bar.
        this._sizes = {};
        for (const [mode, size] of Object.entries(SIZES)) {
            const folded = mode === 'rest' || mode === 'restBusy' || mode === 'hud';
            this._sizes[mode] = {
                width: Math.round(size.width * scale),
                height: folded ? size.height : Math.round(size.height * scale),
            };
        }
    }

    enable() {
        this._readConfig();
        startClipboard();
        this.island = new Island(this._settings);
        this.island.connect('destroy', () => (this._islandGone = true));
        Main.layoutManager.addTopChrome(this.island);

        this._width = new Spring({stiffness: 330, damping: 30, value: this._sizes.rest.width});
        this._height = new Spring({stiffness: 300, damping: 29, value: this._sizes.rest.height});

        this.island.connect('notify::hover', () => this._onHover());
        this.island.connect('button-release-event', (_a, event) => {
            const trigger = this._cfg.trigger;
            if (event.get_button() === Clutter.BUTTON_PRIMARY && (trigger === 'click' || trigger === 'both')) {
                this._pinned = !this._pinned;
                this._lastHover = GLib.get_monotonic_time();
                this._update();
            }
            return Clutter.EVENT_STOP;
        });
        this._tab = this._cfg.firstTab;
        this.island.tabButtons.forEach(([id, button]) => (button.visible = this._cfg.tabs.includes(id)));
        this.island.tabBar.visible = this._cfg.tabs.length > 1;
        this.island.connect('tab', (_i, tab) => {
            this._tab = tab;
            this._refreshTab();
            this._update();
        });
        this.island.connect('timer-changed', (_i, finished) => this._onTimer(finished));
        this.island.connect('close-request', () => {
            this._pinned = false;
            this._update();
        });
        this.island.showTab(this._tab);
        // Dropping a file on the notch puts it on the shelf.
        this.island._delegate = this;
        this.island.prevButton.connect('clicked', () => this._skip(-1));
        this.island.playButton.connect('clicked', () => this._togglePlay());
        this.island.nextButton.connect('clicked', () => this._skip(1));
        this._wireSeek(this.island.track);
        this.island.mediaArt.connect('button-release-event', () => {
            this._player?.raise();
            return Clutter.EVENT_STOP;
        });

        this._source = new Mpris.MprisSource();
        this._watchCharging();
        this._connect(this._source, 'player-added', (_s, player) => this._addPlayer(player));
        this._connect(this._source, 'player-removed', (_s, player) => this._removePlayer(player));
        for (const player of this._source.players)
            this._addPlayer(player);

        this._connect(Main.messageTray, 'source-added', (_tray, source) => this._watchSource(source));
        for (const source of Main.messageTray.getSources?.() ?? [])
            this._watchSource(source);

        this._connect(global.workspace_manager, 'active-workspace-changed', () => this._showWorkspaces());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._layout());
        this._connect(Main.overview, 'showing', () => this.island.hide());
        this._connect(Main.overview, 'hidden', () => {
            this._syncFullscreen();
            this._update();
        });
        this._connect(global.display, 'in-fullscreen-changed', () => this._syncFullscreen());

        this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            // At shell shutdown the island dies before disable() runs.
            if (!this.island || this._islandGone)
                return GLib.SOURCE_REMOVE;
            this._syncContent();
            const idle = this._cfg.autoClose;
            if (this._pinned && idle > 0 && !this.island.hover &&
                GLib.get_monotonic_time() - (this._lastHover ?? 0) > idle * 1e6) {
                this._pinned = false;
                this._update();
            }
            if (this._mode === 'dashboard') {
                if (this._hasMedia() && this._tab === 'home')
                    this._pollPosition();
                if (this._tab === 'stats')
                    this.island.statsView.update();
            }
            return GLib.SOURCE_CONTINUE;
        });

        // Route GNOME's volume/brightness OSD into the notch.
        if (this._cfg.hud)
            this._routeOsd(Main.osdWindowManager);

        this._update();
    }

    _routeOsd(osd) {
        this._osdSaved = {show: osd.show, showAll: osd.showAll};
        osd.show = (icon, label, levels) => {
            const level = Object.values(levels ?? {}).find(Boolean);
            if (level && level.level !== undefined && level.level !== null)
                this._showHud(icon, level.level, level.maxLevel ?? 1);
            else
                this._osdSaved.show.call(osd, icon, label, levels);
        };
        osd.showAll = (icon, label, level, maxLevel) => {
            if (level !== undefined && level !== null)
                this._showHud(icon, level, maxLevel ?? 1);
            else
                this._osdSaved.showAll.call(osd, icon, label, level, maxLevel);
        };
    }

    // The island steps aside over a full-screen window (optional).
    _syncFullscreen() {
        if (!this.island || this._islandGone)
            return;
        const fullscreen = this._cfg.hideFullscreen &&
            global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex);
        this.island.visible = !fullscreen && !Main.overview.visible;
    }

    // Hover opens the dashboard after `hoverDelay` ms, and closes it
    // `closeDelay` ms after the pointer leaves; clicking is handled apart.
    _onHover() {
        if (!this.island || this._islandGone)
            return;
        const {trigger, hoverDelay, closeDelay} = this._cfg;
        for (const id of [this._hoverId, this._leaveId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._hoverId = this._leaveId = 0;
        if (this.island.hover)
            this._lastHover = GLib.get_monotonic_time();
        if (trigger !== 'hover' && trigger !== 'both') {
            this._update();
            return;
        }
        const set = open => {
            this._hoverOpen = open;
            this._update();
        };
        const delayed = (ms, open) => {
            if (ms <= 0) {
                set(open);
                return 0;
            }
            return GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                if (open)
                    this._hoverId = 0;
                else
                    this._leaveId = 0;
                if (this.island && !this._islandGone)
                    set(open);
                return GLib.SOURCE_REMOVE;
            });
        };
        if (this.island.hover)
            this._hoverId = delayed(hoverDelay, true);
        else
            this._leaveId = delayed(closeDelay, false);
    }

    // Pages that read live state refresh when they come into view.
    _refreshTab() {
        const island = this.island;
        if (!island || this._islandGone)
            return;
        if (this._tab === 'actions')
            island.actionsView.refresh();
        else if (this._tab === 'stats')
            island.statsView.update();
        else if (this._tab === 'clipboard')
            island.clipboardView.refresh();
    }

    // A short squash-and-stretch: the notch "breathes" when something arrives.
    _bounce() {
        const island = this.island;
        if (!island || this._islandGone || !this._cfg.bounce)
            return;
        island.set_pivot_point(0.5, 0);
        island.remove_all_transitions();
        island.set_scale(1.06, 0.94);
        island.ease({scale_x: 1, scale_y: 1, duration: 520, mode: Clutter.AnimationMode.EASE_OUT_ELASTIC});
    }

    handleDragOver() {
        if (!this._cfg.tabs.includes('shelf'))
            return 0; // DragMotionResult.NO_DROP
        this._pinned = true;
        this._lastHover = GLib.get_monotonic_time();
        this._keepTab = true;
        this._tab = 'shelf';
        this._update();
        return 1; // DragMotionResult.COPY_DROP
    }

    acceptDrop(source) {
        const uri = source?.file?.get_uri?.() ?? source?.uri;
        if (uri)
            this.island.shelf.add(uri);
        return !!uri;
    }

    _onTimer(finished = false) {
        if (!this.island || this._islandGone)
            return;
        const timer = this.island.timer;
        this.island.ring.visible = timer.running && this._mode === 'rest' && this._cfg.showRing;
        this.island.ring.queue_repaint();
        if (finished) {
            const body = {
                focus: t('Back to focus.', 'On reprend la concentration.'),
                short: t('Time for a short break.', 'C’est l’heure d’une pause courte.'),
                long: t('Time for a long break. Well done!', 'Pause longue : bien joué !'),
            }[timer.phase];
            Main.notify(t('Pomodoro', 'Pomodoro'), body);
            try {
                global.display.get_sound_player().play_from_theme('complete', 'Pomodoro', null);
            } catch {}
        }
        this._update();
    }

    _showHud(icon, level, maxLevel) {
        const island = this.island;
        if (!island || this._islandGone)
            return;
        island.hudIcon.gicon = icon;
        this._hudLevel = Math.max(0, Math.min(1, level / Math.max(1, maxLevel > 0 ? maxLevel : 1)));
        this._hudUntil = GLib.get_monotonic_time() + this._cfg.hudMs * 1000;
        this._update();
    }

    disable() {
        for (const id of [this._hoverId, this._leaveId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._hoverId = this._leaveId = 0;
        if (this._powerSub) {
            Gio.DBus.system.signal_unsubscribe(this._powerSub);
            this._powerSub = 0;
        }
        this.island?.timer?.destroy();
        this.island?.clipboardView?.destroy();
        stopClipboard();
        if (this._osdSaved) {
            Object.assign(Main.osdWindowManager, this._osdSaved);
            delete Main.osdWindowManager.show;
            delete Main.osdWindowManager.showAll;
            this._osdSaved = null;
        }
        getTicker().remove(this._tick);
        if (this._clockId) {
            GLib.source_remove(this._clockId);
            this._clockId = 0;
        }
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch {}
        }
        this._signals = [];
        for (const player of this._players)
            player.disconnectObject?.(this);
        this._players.clear();
        this._player = null;
        if (this._pollTimeout) {
            GLib.source_remove(this._pollTimeout);
            this._pollTimeout = 0;
        }
        this._source = null;
        if (this.island) {
            if (!this._islandGone) {
                this.island.remove_all_transitions();
                Main.layoutManager.removeChrome(this.island);
                this.island.destroy();
            }
            this.island = null;
        }
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _addPlayer(player) {
        if (this._players.has(player))
            return;
        this._players.add(player);
        player.connectObject('changed', () => this._onPlayerChanged(player), this);
        this._onPlayerChanged(player);
    }

    _removePlayer(player) {
        player.disconnectObject?.(this);
        this._players.delete(player);
        if (this._player === player)
            this._player = [...this._players][0] ?? null;
        this._update();
    }

    _onPlayerChanged(player) {
        if (player === this._player || !this._player)
            this._pollSoon();
        if (player.status === 'Playing' || !this._player)
            this._player = player;
        this._update();
    }

    _hasMedia() {
        const p = this._player;
        return !!p && p.canPlay && (p.status === 'Playing' || p.status === 'Paused');
    }

    // Plugging the charger in (or unplugging it) shows a short notice in the
    // island: the battery level and whether it is charging. UPower's display
    // device is the source; without a battery nothing happens.
    _watchCharging() {
        const path = '/org/freedesktop/UPower/devices/DisplayDevice';
        let last = null;
        const show = props => {
            const present = props.IsPresent?.deepUnpack?.() ?? props.IsPresent;
            const state = props.State?.deepUnpack?.() ?? props.State;
            const percent = Math.round(props.Percentage?.deepUnpack?.() ?? props.Percentage ?? NaN);
            if (!present || !Number.isFinite(percent))
                return;
            const charging = state === 1 || state === 4 || state === 5;
            const previous = last;
            last = charging;
            // First reading: only remember. Later: announce a change.
            if (previous === null || previous === charging || !this._settings.get_boolean('island-notifications'))
                return;
            const level = Math.min(100, Math.max(0, Math.round(percent / 10) * 10));
            this._showNotice({
                title: charging ? t('Charging', 'En charge') : t('On battery', 'Sur batterie'),
                body: `${percent} %`,
                gicon: new Gio.ThemedIcon({name: charging ? `battery-level-${level}-charging-symbolic` : `battery-level-${level}-symbolic`}),
            });
        };
        const read = () => Gio.DBus.system.call('org.freedesktop.UPower', path, 'org.freedesktop.DBus.Properties', 'GetAll',
            new GLib.Variant('(s)', ['org.freedesktop.UPower.Device']), null, Gio.DBusCallFlags.NONE, 1000, null, (conn, res) => {
                try {
                    if (!this._islandGone)
                        show(conn.call_finish(res).deepUnpack()[0]);
                } catch {}
            });
        try {
            read();
            this._powerSub = Gio.DBus.system.signal_subscribe('org.freedesktop.UPower', 'org.freedesktop.DBus.Properties',
                'PropertiesChanged', path, null, Gio.DBusSignalFlags.NONE, () => read());
        } catch {}
    }

    // A call on the current player's MPRIS interface, straight over D-Bus.
    _playerCall(method, parameters = null, done = null) {
        const busName = this._player?._busName;
        if (!busName) {
            return false;
        }
        Gio.DBus.session.call(busName, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player',
            method, parameters, null, Gio.DBusCallFlags.NONE, 1500, null, (conn, res) => {
                try {
                    conn.call_finish(res);
                    done?.(true);
                } catch (e) {
                    logError(e, `GNOMAC island: player ${method}`);
                    done?.(false);
                }
            });
        return true;
    }

    _togglePlay() {
        const player = this._player;
        if (!player)
            return;
        // The icon answers at once; the player's own signal confirms it.
        const playing = player.status === 'Playing';
        this.island.playButton.child.icon_name = playing ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic';
        if (!this._playerCall('PlayPause'))
            player.playPause();
        this._pollSoon();
    }

    // Previous / next track; when the player has none (a browser tab, a
    // podcast) the buttons skip 10 seconds instead, so they never do nothing.
    _skip(direction) {
        const player = this._player;
        if (!player)
            return;
        const canTrack = direction > 0 ? player.canGoNext : player.canGoPrevious;
        if (canTrack) {
            if (!this._playerCall(direction > 0 ? 'Next' : 'Previous'))
                direction > 0 ? player.next() : player.previous();
        } else {
            this._seekBy(direction * 10 * 1e6);
        }
        this._pollSoon();
    }

    _seekBy(offsetUs) {
        if (!this._playerCall('Seek', new GLib.Variant('(x)', [Math.round(offsetUs)])))
            return;
        this._position = Math.max(0, this._livePosition() + offsetUs);
        this._positionAt = GLib.get_monotonic_time();
        this._syncProgress();
    }

    _seekTo(fraction) {
        const length = this._length;
        const trackId = this._player?._playerProxy?.Metadata?.['mpris:trackid'];
        if (!length)
            return;
        const target = Math.round(Math.min(1, Math.max(0, fraction)) * length);
        const id = trackId?.deepUnpack?.() ?? trackId;
        const sent = id
            ? this._playerCall('SetPosition', new GLib.Variant('(ox)', [String(id), target]))
            : false;
        if (!sent)
            this._seekBy(target - this._livePosition());
        this._position = target;
        this._positionAt = GLib.get_monotonic_time();
        this._syncProgress();
        this._pollSoon();
    }

    // Click or drag on the progress bar.
    _wireSeek(track) {
        let dragging = false;
        const at = event => {
            const [x] = event.get_coords();
            const [ok, lx] = track.transform_stage_point(x, 0);
            return ok && track.width > 0 ? lx / track.width : 0;
        };
        track.connect('button-press-event', (_a, event) => {
            dragging = true;
            this._scrubbing = true;
            this._scrubTo(at(event));
            return Clutter.EVENT_STOP;
        });
        track.connect('motion-event', (_a, event) => {
            if (dragging)
                this._scrubTo(at(event));
            return dragging ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
        track.connect('button-release-event', (_a, event) => {
            if (!dragging)
                return Clutter.EVENT_PROPAGATE;
            dragging = false;
            this._scrubbing = false;
            this._seekTo(at(event));
            return Clutter.EVENT_STOP;
        });
        track.connect('leave-event', () => {
            if (dragging) {
                dragging = false;
                this._scrubbing = false;
            }
        });
    }

    _scrubTo(fraction) {
        if (!this._length)
            return;
        this._position = Math.min(1, Math.max(0, fraction)) * this._length;
        this._positionAt = GLib.get_monotonic_time();
        this._syncProgress();
    }

    // Where the track is now: the last known position plus the time since.
    _livePosition() {
        const playing = this._player?.status === 'Playing';
        const since = playing && this._positionAt ? GLib.get_monotonic_time() - this._positionAt : 0;
        const position = this._position + since;
        return this._length ? Math.min(position, this._length) : position;
    }

    _pollSoon() {
        if (this._pollTimeout)
            GLib.source_remove(this._pollTimeout);
        this._pollTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._pollTimeout = 0;
            this._pollPosition();
            return GLib.SOURCE_REMOVE;
        });
    }

    // GNOME's MprisPlayer does not track the position; ask the player.
    _pollPosition() {
        const player = this._player;
        const busName = player?._busName;
        if (!busName)
            return;
        Gio.DBus.session.call(busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
            'Get', new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null, Gio.DBusCallFlags.NONE, 500, null, (conn, res) => {
                try {
                    const [value] = conn.call_finish(res).deepUnpack();
                    this._position = Number(value.deepUnpack());
                } catch {
                    this._position = 0;
                }
                this._positionAt = GLib.get_monotonic_time();
                const metadata = player._playerProxy?.Metadata ?? {};
                const length = metadata['mpris:length'];
                this._length = length ? Number(length.deepUnpack?.() ?? length) : 0;
                this._syncProgress();
            });
    }

    _watchSource(source) {
        this._signals.push([source, source.connect('notification-added', (_src, notification) => {
            if (this._settings.get_boolean('island-notifications'))
                this._showNotice(notification);
            this._update();
        })]);
    }

    _showNotice(notification) {
        const island = this.island;
        island.noticeTitle.text = notification.title ?? '';
        island.noticeBody.text = (notification.body ?? '').replace(/\s+/g, ' ');
        island.noticeIcon.gicon = notification.gicon ?? notification.source?.icon ?? null;
        if (!island.noticeIcon.gicon)
            island.noticeIcon.icon_name = 'preferences-system-notifications-symbolic';
        this._noticeUntil = GLib.get_monotonic_time() + this._cfg.noticeMs * 1000;
        this._update();
    }

    _showWorkspaces() {
        const manager = global.workspace_manager;
        const dots = this.island.dots;
        dots.destroy_all_children();
        const active = manager.get_active_workspace_index();
        for (let i = 0; i < manager.n_workspaces; i++) {
            dots.add_child(new St.Widget({
                style_class: i === active ? 'gnomac-notch-dot active' : 'gnomac-notch-dot',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        this._workspaceUntil = GLib.get_monotonic_time() + WORKSPACE_MS * 1000;
        this._update();
    }

    // The island's states, by name: collapsed, expanded, media, notification,
    // timer, volume, system. It moves between them on its two springs (width and
    // height): one shape that changes, never hidden and shown again.
    get state() {
        switch (this._mode) {
        case 'dashboard': return 'expanded';
        case 'notice': return 'notification';
        case 'hud': return 'volume';
        case 'date': return 'system';
        default:
            if (this._hasMedia() && this._cfg?.showMedia)
                return 'media';
            if (this.island?.timer.running && this._cfg?.showRing)
                return 'timer';
            return this._unread() > 0 && this._cfg?.showBadge ? 'system' : 'collapsed';
        }
    }

    _wantedMode() {
        if (GLib.get_monotonic_time() < this._noticeUntil)
            return 'notice';
        if (GLib.get_monotonic_time() < (this._hudUntil ?? 0))
            return 'hud';
        if (this._hoverOpen || this._pinned)
            return 'dashboard';
        return 'rest';
    }

    _unread() {
        let count = 0;
        for (const source of Main.messageTray.getSources?.() ?? [])
            count += source.unseenCount ?? 0;
        return count;
    }

    _syncContent() {
        const island = this.island;
        if (!island || this._islandGone)
            return;
        const now = GLib.DateTime.new_now_local();
        const showDots = GLib.get_monotonic_time() < this._workspaceUntil;
        island.dots.visible = showDots;
        island.clock.visible = !showDots && this._cfg.showClock;
        island.clock.text = now.format(this._cfg.h24 ? '%H:%M' : '%-I:%M %p');
        if (this._mode === 'date') {
            island.noticeIcon.gicon = null;
            island.noticeIcon.icon_name = 'x-office-calendar-symbolic';
            island.noticeTitle.text = now.format(this._cfg.h24 ? '%H:%M' : '%-I:%M %p');
            island.noticeBody.text = now.format('%A %-d %B');
        }

        island.calendar.update();
        island.showTab(this._cfg.tabs.includes(this._tab) ? this._tab : this._cfg.firstTab);
        // The player's place on Home: the player when something plays,
        // the clock and chips otherwise.
        island.homePlayer.visible = this._hasMedia();
        island.idleHome.actor.visible = !this._hasMedia();
        if (this._mode === 'dashboard' && this._tab === 'home' && !this._hasMedia())
            island.idleHome.update();
        island.ring.visible = island.timer.running && this._mode === 'rest' && this._cfg.showRing;
        const unread = this._unread();
        island.badge.visible = unread > 0 && this._cfg.showBadge;
        island.badgeLabel.text = String(unread);

        const player = this._player;
        const media = this._hasMedia();
        island.restArt.visible = media && this._cfg.showMedia;
        island.bars.visible = media && this._cfg.showMedia;
        if (player && media) {
            island.restArt.set_style(coverStyle(player.trackCoverUrl, 16));
            island.mediaArt.set_style(coverStyle(player.trackCoverUrl, 40));
            island.title.text = player.trackTitle || t('Unknown title', 'Titre inconnu');
            island.artist.text = (player.trackArtists ?? []).join(', ');
            island.appIcon.gicon = player.app?.get_icon?.() ?? null;
            island.appIcon.visible = !!island.appIcon.gicon;
            island.playButton.child.icon_name = player.status === 'Playing'
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';
            // Without track changes the buttons skip 10 s, so they stay live.
            island.prevButton.opacity = player.canGoPrevious ? 255 : 170;
            island.nextButton.opacity = player.canGoNext ? 255 : 170;
        }
    }

    _syncProgress() {
        const island = this.island;
        if (!island || this._islandGone)
            return;
        const length = this._length;
        const position = this._livePosition();
        island.elapsed.text = formatTime(position);
        island.remaining.text = length ? `-${formatTime(length - position)}` : '';
        island._progress = length ? position / length : 0;
        island.setFill(island.fill, island.track, island._progress);
    }

    _update() {
        if (!this.island || this._islandGone)
            return;
        const mode = this._wantedMode();
        const changed = mode !== this._mode;
        const previous = this._mode;
        this._mode = mode;
        this._syncContent();
        if (changed && mode === 'dashboard') {
            // Back to the first tab on every opening, unless told to remember.
            if (!this._keepTab && !this._cfg.remember)
                this._tab = this._cfg.firstTab;
            this._keepTab = false;
            this._syncContent();
            this._refreshTab();
            // Opening the card: its content pops in one piece after another.
            if (this._cfg.cascade)
                this.island.cascadeContent();
        }
        // A notification makes the whole notch bounce, like Dynamic Island.
        if (changed && (mode === 'notice' || (previous === 'rest' && mode === 'hud')))
            this._bounce();
        if (changed && mode === 'media')
            this._pollPosition();
        const cfg = this._cfg;
        const busy = mode === 'rest' &&
            ((this._hasMedia() && cfg.showMedia) || (this.island.timer.running && cfg.showRing) ||
             (this._unread() > 0 && cfg.showBadge));
        const size = busy ? this._sizes.restBusy : this._sizes[mode];
        // "Hidden" folds the notch away at rest, "events" keeps it only while it
        // has something to show; it still reacts to hover and clicks.
        const hideAtRest = mode === 'rest' &&
            (cfg.restStyle === 'hidden' || (cfg.restStyle === 'events' && !busy));
        const wanted = hideAtRest ? 0 : 255;
        if (this._shownOpacity !== wanted) {
            this._shownOpacity = wanted;
            this.island.ease({opacity: wanted, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        // Folding: the content compresses first, then the shape follows.
        const leaving = changed && ['dashboard', 'notice', 'date', 'hud'].includes(previous) &&
            size.width < this._width.target;
        if (leaving && St.Settings.get().enable_animations) {
            this._pendingSize = {size, at: GLib.get_monotonic_time() + 140000};
        } else {
            this._pendingSize = null;
            this._width.setTarget(size.width);
            this._height.setTarget(size.height);
        }
        getTicker().add(this._tick);
    }

    _onTick(dt) {
        if (!this.island || this._islandGone)
            return false;
        const now = GLib.get_monotonic_time();
        if (this._pendingSize && now >= this._pendingSize.at) {
            this._width.setTarget(this._pendingSize.size.width);
            this._height.setTarget(this._pendingSize.size.height);
            this._pendingSize = null;
        }
        this._width.step(dt);
        this._height.step(dt);
        this._phase += dt;
        const presenceMoving = this._stepPresence(dt);
        if ((this._mode === 'hud' && now >= (this._hudUntil ?? 0)) ||
            (this._mode === 'notice' && now >= this._noticeUntil) ||
            (this.island.dots.visible && now >= this._workspaceUntil))
            this._update();

        this._layout();

        const playing = this._player?.status === 'Playing' && this._hasMedia();
        // The bar moves with the music, and is re-synced with the player every 2 s.
        if (this._mode === 'dashboard' && this._hasMedia() && !this._scrubbing) {
            this._syncProgress();
            if (playing && now - (this._positionAt ?? 0) > 2e6)
                this._pollPosition();
        }
        const timed = now < this._noticeUntil || now < this._workspaceUntil || now < (this._hudUntil ?? 0);
        return playing || timed || presenceMoving || !!this._pendingSize || !this._width.settled || !this._height.settled;
    }

    _layout() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this.island)
            return;
        const island = this.island;
        const width = Math.round(Math.max(this._sizes.rest.height, this._width.value));
        const height = Math.round(Math.max(this._sizes.rest.height, this._height.value));
        island.set_position(Math.round(monitor.x + (monitor.width - width) / 2), monitor.y);
        island.set_size(width, height);
        // The app menus fit themselves around the notch's folded width.
        if (this._mode === 'rest' || this._mode === 'hud')
            this._extension.onNotchResize?.(Math.round(this._width.target));
        island.shape.set_size(width, height);
        island.shape.queue_repaint();

        const inner = width - 2 * EAR;
        const smooth = x => {
            const u = Math.min(1, Math.max(0, x));
            return u * u * (3 - 2 * u);
        };
        // How far the shape is towards its current target (0 folded .. 1 there):
        // arriving content only shows once the shape has mostly arrived.
        const restW = this._sizes.rest.width;
        const spanW = Math.max(1, this._width.target - restW);
        const arrived = Math.min(1, Math.max(0, (this._width.value - restW) / spanW));
        const gate = smooth((arrived - 0.45) / 0.4);
        const presence = this._presence;
        island.hud.set_position(EAR, 0);
        island.hud.set_size(inner, height);
        island.hud.opacity = Math.round(255 * presence.hud * (this._mode === 'hud' ? gate : 1));
        island.hud.visible = island.hud.opacity > 0;
        if (island.hud.visible)
            island.setFill(island.hudFill, island.hudTrack, this._hudLevel ?? 0);
        for (const child of [island.rest, island.media, island.notice]) {
            child.set_position(EAR, 0);
            child.set_size(inner, height);
        }

        const grow = Math.min(1, Math.max(0,
            (height - this._sizes.rest.height) / (this._sizes.notice.height - this._sizes.rest.height)));
        island.dashboard.set_position(EAR, 0);
        island.dashboard.set_size(inner, height);
        this._grow = grow;
        island.dashboard.opacity = Math.round(255 * presence.dashboard * (this._mode === 'dashboard' ? gate : 1));
        island.dashboard.visible = island.dashboard.opacity > 0;
        island.rest.opacity = Math.round(255 * presence.rest * (1 - smooth(grow * 2)));
        island.media.opacity = 0;
        const noticeNow = this._mode === 'notice' || this._mode === 'date';
        island.notice.opacity = Math.round(255 * presence.notice * (noticeNow ? gate : 1));
        for (const child of [island.rest, island.media, island.notice])
            child.visible = child.opacity > 0;

        const playing = this._player?.status === 'Playing';
        const level = i => playing
            ? 0.3 + 0.7 * Math.abs(Math.sin(this._phase * (5.2 + i * 1.3) + i * 1.7))
            : 0.3;
        island.barActors.forEach((bar, i) => bar.set_height(Math.round(3 + 9 * level(i))));
        island.mediaBarActors.forEach((bar, i) => bar.set_height(Math.round(4 + 12 * level(i))));
    }
}
