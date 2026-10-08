// Notification Center: every notification GNOME is holding, in one glass panel
// that slides in from the right edge (macOS style).
//
//   - a bell in the menu bar (with a dot when something is unread) opens it;
//     Escape or a click outside closes it,
//   - each card: app icon and name, title, text, time; click it to open what it
//     is about, x to dismiss it,
//   - "Clear All" empties the list, "Do Not Disturb" silences banners,
//   - the list follows the notifications live (new ones appear, dismissed ones
//     leave) and shares them with GNOME's own date menu: nothing is copied.
//
// Honest limit: it shows what GNOME's message tray holds. A notification the
// app or the user already dismissed, or that expired without being kept, is
// not in any history to show.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {GlassSurface, clearGlassParams} from '../lib/glass.js';
import {Easing, MotionTokens} from '../lib/motionTokens.js';
import {timelines} from '../lib/animationTimeline.js';
import {t} from '../lib/i18n.js';

const WIDTH = 392;
const RADIUS = 28;

export class NotificationCenter {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._signals = [];
        this._open = false;
    }

    enable() {
        this._extension.notificationCenter = this;
        this._dnd = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});

        // A button holds one child: the icon and the unread dot share a container.
        const content = new St.Widget({layout_manager: new Clutter.BinLayout()});
        content.add_child(new St.Icon({icon_name: 'preferences-system-notifications-symbolic', icon_size: 15,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        this._dot = new St.Widget({style_class: 'gnomac-bell-dot', visible: false, reactive: false,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START});
        content.add_child(this._dot);
        this._bell = new St.Button({style_class: 'panel-button gnomac-bell', can_focus: false, reactive: true,
            y_align: Clutter.ActorAlign.CENTER, child: content});
        this._bell.connect('clicked', () => this.toggle());
        const right = Main.panel._rightBox;
        const anchor = Main.panel.statusArea.quickSettings?.container ?? null;
        if (anchor && anchor.get_parent() === right)
            right.insert_child_below(this._bell, anchor);
        else
            right.add_child(this._bell);
        this._bell.connect('destroy', () => (this._bell = null));

        this._connect(Main.messageTray, 'source-added', (_t, source) => this._watchSource(source));
        this._connect(Main.messageTray, 'source-removed', () => this._changed());
        for (const source of Main.messageTray.getSources())
            this._watchSource(source);
        this._overviewId = Main.overview.connect('showing', () => this.close(false));
        this._changed();
    }

    disable() {
        if (this._extension.notificationCenter === this)
            this._extension.notificationCenter = null;
        this.close(false);
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch {}
        }
        this._signals = [];
        if (this._overviewId) {
            Main.overview.disconnect(this._overviewId);
            this._overviewId = 0;
        }
        this._bell?.destroy();
        this._bell = null;
        this._dnd = null;
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _watchSource(source) {
        for (const signal of ['notification-added', 'notification-removed', 'notification-updated', 'destroy'])
            this._tryConnect(source, signal, () => this._changed());
        this._changed();
    }

    _tryConnect(object, signal, callback) {
        try {
            this._connect(object, signal, callback);
        } catch {
            // This GNOME version has no such signal: the others still tell us.
        }
    }

    _notifications() {
        const list = [];
        for (const source of Main.messageTray.getSources()) {
            for (const notification of source.notifications ?? [])
                list.push({source, notification});
        }
        return list.reverse();
    }

    _changed() {
        const count = this._notifications().length;
        if (this._dot)
            this._dot.visible = count > 0;
        if (this._open)
            this._fill();
    }

    // ---------------------------------------------------------------- panel

    toggle() {
        if (this._open)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._open)
            return;
        this._open = true;
        const monitor = Main.layoutManager.primaryMonitor;
        const top = monitor.y + Main.panel.height + 10;
        const height = Math.min(monitor.height - Main.panel.height - 110, 640);

        this._root = new St.Widget({reactive: true, x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
        Main.layoutManager.uiGroup.add_child(this._root);
        // A click outside closes it.
        this._root.connect('button-press-event', (_a, event) => {
            const [x, y] = event.get_coords();
            const [px, py] = this._card.get_transformed_position();
            // Inside the card the press belongs to what is under it (buttons, cards).
            if (x >= px && x <= px + this._card.width && y >= py && y <= py + this._card.height)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        this._root.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._card = new St.Widget({style_class: 'gnomac-nc-card', x: monitor.x + monitor.width - WIDTH - 12, y: top,
            width: WIDTH, height});
        this._glass = new GlassSurface({
            backdrop: 'windows',
            blur: Math.max(this._settings.get_int('glass-blur'), 9),
            glass: clearGlassParams(this._settings, RADIUS),
        });
        this._glass.set_size(WIDTH, height);
        this._card.add_child(this._glass);

        this._column = new St.BoxLayout({style_class: 'gnomac-nc-content', orientation: Clutter.Orientation.VERTICAL,
            width: WIDTH, height});
        this._card.add_child(this._column);
        this._root.add_child(this._card);

        const header = new St.BoxLayout({style_class: 'gnomac-nc-header'});
        header.add_child(new St.Label({text: t('Notifications', 'Notifications'), style_class: 'gnomac-nc-title',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        this._dndButton = new St.Button({style_class: 'gnomac-nc-pill', toggle_mode: true, can_focus: false,
            label: t('Do Not Disturb', 'Ne pas déranger'), checked: !this._dnd.get_boolean('show-banners')});
        this._dndButton.connect('clicked', () => this._dnd.set_boolean('show-banners', !this._dndButton.checked));
        const clear = new St.Button({style_class: 'gnomac-nc-pill', label: t('Clear All', 'Tout effacer'), can_focus: false});
        clear.connect('clicked', () => this.clearAll());
        header.add_child(this._dndButton);
        header.add_child(clear);
        this._column.add_child(header);

        this._scroll = new St.ScrollView({style_class: 'gnomac-nc-scroll', x_expand: true, y_expand: true,
            overlay_scrollbars: true});
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gnomac-nc-list', x_expand: true});
        this._scroll.set_child(this._list);
        this._column.add_child(this._scroll);

        this._grab = Main.pushModal(this._root, {actionMode: Shell.ActionMode.POPUP});
        this._fill();
        this._glass.setStageOrigin(this._card.x, this._card.y);

        // It slides in from the right edge while its glass forms.
        this._card.translation_x = 60;
        this._card.opacity = 0;
        this._run?.cancel();
        this._run = timelines.run({
            duration: MotionTokens.medium, easing: Easing.easeOutQuart,
            onFrame: e => {
                this._card.translation_x = 60 * (1 - e);
                this._card.opacity = Math.round(255 * Math.min(1, e * 1.6));
            },
        });
        this._glass.materialize({duration: MotionTokens.medium, fade: false});
    }

    close(animate = true) {
        if (!this._open)
            return;
        this._open = false;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        const root = this._root;
        this._root = null;
        this._run?.cancel();
        if (!animate || !root) {
            root?.destroy();
            return;
        }
        const card = this._card;
        this._run = timelines.run({
            duration: MotionTokens.short, easing: Easing.easeOut,
            onFrame: e => {
                card.translation_x = 40 * e;
                card.opacity = Math.round(255 * (1 - e));
            },
            onDone: () => root.destroy(),
        });
    }

    clearAll() {
        for (const {notification} of this._notifications()) {
            try {
                notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
            } catch (e) {
                logError(e, 'GNOMAC notification center: dismiss');
            }
        }
        this._changed();
    }

    _fill() {
        if (!this._list)
            return;
        this._list.destroy_all_children();
        const items = this._notifications();
        if (!items.length) {
            this._list.add_child(new St.Label({text: t('No notifications', 'Aucune notification'),
                style_class: 'gnomac-nc-empty', x_align: Clutter.ActorAlign.CENTER, x_expand: true}));
            return;
        }
        for (const {source, notification} of items)
            this._list.add_child(this._cardFor(source, notification));
    }

    _timeText(notification) {
        const date = notification.datetime;
        if (!date?.format)
            return '';
        const seconds = (GLib.DateTime.new_now_local().to_unix() - date.to_unix());
        if (seconds < 60)
            return t('now', 'à l’instant');
        if (seconds < 3600)
            return t(`${Math.floor(seconds / 60)} min ago`, `il y a ${Math.floor(seconds / 60)} min`);
        return date.format('%H:%M');
    }

    _cardFor(source, notification) {
        const card = new St.BoxLayout({style_class: 'gnomac-nc-item', reactive: true, track_hover: true,
            x_expand: true});
        const gicon = notification.gicon ?? source.icon ?? null;
        const icon = new St.Icon({icon_size: 32, y_align: Clutter.ActorAlign.START, style_class: 'gnomac-nc-icon'});
        if (gicon)
            icon.gicon = gicon;
        else
            icon.icon_name = 'preferences-system-notifications-symbolic';
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const top = new St.BoxLayout();
        top.add_child(new St.Label({text: source.title ?? '', style_class: 'gnomac-nc-app', x_expand: true}));
        top.add_child(new St.Label({text: this._timeText(notification), style_class: 'gnomac-nc-time'}));
        const title = new St.Label({text: notification.title ?? '', style_class: 'gnomac-nc-item-title'});
        title.clutter_text.set({line_wrap: true, ellipsize: 0});
        const body = new St.Label({text: (notification.body ?? '').replace(/<[^>]+>/g, ''), style_class: 'gnomac-nc-body'});
        body.clutter_text.set({line_wrap: true, ellipsize: 3, single_line_mode: false});
        text.add_child(top);
        text.add_child(title);
        if (notification.body)
            text.add_child(body);
        const close = new St.Button({style_class: 'gnomac-nc-close', can_focus: false, y_align: Clutter.ActorAlign.START,
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12})});
        close.connect('clicked', () => {
            try {
                notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
            } catch (e) {
                logError(e, 'GNOMAC notification center: dismiss');
            }
            this._changed();
        });
        card.add_child(icon);
        card.add_child(text);
        card.add_child(close);
        // A click on the card does what clicking the banner would.
        card.connect('button-release-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            try {
                notification.activate();
            } catch (e) {
                logError(e, 'GNOMAC notification center: activate');
            }
            return Clutter.EVENT_STOP;
        });
        return card;
    }
}
