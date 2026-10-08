// "What's new": a glass card listing the new features and the fixes of the
// releases you have not seen yet. Shown once after an update (the first
// session that runs the new version), and from Spotlight > "What's new in
// GNOMAC". The notes are whatsnew.json, shipped with the extension.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassSurface, clearGlassParams} from './glass.js';
import {Easing, MotionTokens} from './motionTokens.js';
import {timelines} from './animationTimeline.js';
import {t} from './i18n.js';

const WIDTH = 560;
let current = null;

export function loadReleases(extension) {
    try {
        const file = Gio.File.new_for_path(GLib.build_filenamev([extension.path, 'whatsnew.json']));
        const [, bytes] = file.load_contents(null);
        const list = JSON.parse(new TextDecoder().decode(bytes));
        return Array.isArray(list) ? list.sort((a, b) => b.id - a.id) : [];
    } catch (e) {
        logError(e, 'GNOMAC whats new: notes not readable');
        return [];
    }
}

// Releases to announce: everything after `seen`, or only the latest one on a
// first install (a new user does not need the whole history).
export function releasesToShow(releases, seen) {
    if (!releases.length)
        return [];
    return seen > 0 ? releases.filter(r => r.id > seen) : [releases[0]];
}

export function closeWhatsNew() {
    current?.close(false);
}

// `markSeen` false: the notes of an update that is not installed yet are shown
// without counting as seen (the card comes again once it is installed).
export function showWhatsNew(extension, releases, {markSeen = true} = {}) {
    if (!releases.length)
        return;
    current?.close(false);
    const settings = extension.getSettings();
    const monitor = Main.layoutManager.primaryMonitor;
    const height = Math.min(monitor.height - 140, 620);

    const root = new St.Widget({reactive: true, x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
    Main.layoutManager.uiGroup.add_child(root);
    const card = new St.Widget({style_class: 'gnomac-wn-card', width: WIDTH, height,
        x: monitor.x + Math.round((monitor.width - WIDTH) / 2), y: monitor.y + Math.round((monitor.height - height) / 2)});
    const glass = new GlassSurface({backdrop: 'windows', blur: Math.max(settings.get_int('glass-blur'), 12),
        glass: clearGlassParams(settings, 30)});
    glass.set_size(WIDTH, height);
    card.add_child(glass);

    const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gnomac-wn-content',
        width: WIDTH, height});
    card.add_child(column);
    root.add_child(card);

    column.add_child(new St.Label({text: t('What’s new in GNOMAC', 'Nouveautés de GNOMAC'), style_class: 'gnomac-wn-title'}));
    const scroll = new St.ScrollView({x_expand: true, y_expand: true, overlay_scrollbars: true,
        style_class: 'gnomac-wn-scroll'});
    const list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'gnomac-wn-list'});
    scroll.set_child(list);
    column.add_child(scroll);

    const section = (heading, items) => {
        if (!items?.length)
            return;
        list.add_child(new St.Label({text: heading, style_class: 'gnomac-wn-heading'}));
        for (const [en, fr] of items) {
            const label = new St.Label({text: `•  ${t(en, fr)}`, style_class: 'gnomac-wn-item'});
            label.clutter_text.set({line_wrap: true, ellipsize: 0});
            list.add_child(label);
        }
    };
    for (const release of releases) {
        if (releases.length > 1)
            list.add_child(new St.Label({text: t(release.title?.[0] ?? '', release.title?.[1] ?? ''), style_class: 'gnomac-wn-release'}));
        section(t('New', 'Nouveautés'), release.features);
        section(t('Fixed', 'Corrections'), release.fixes);
    }

    const ok = new St.Button({label: t('Continue', 'Continuer'), style_class: 'gnomac-wn-button', can_focus: false,
        x_align: Clutter.ActorAlign.END});
    column.add_child(ok);

    const grab = Main.pushModal(root, {actionMode: Shell.ActionMode.POPUP});
    let closed = false;
    let run = null;
    const state = {
        close(animate = true) {
            if (closed)
                return;
            closed = true;
            if (grab)
                Main.popModal(grab);
            run?.cancel();
            if (current === state)
                current = null;
            if (!animate) {
                root.destroy();
                return;
            }
            run = timelines.run({
                duration: MotionTokens.short, easing: Easing.easeOut,
                onFrame: e => (card.opacity = Math.round(255 * (1 - e))),
                onDone: () => root.destroy(),
            });
        },
    };
    current = state;
    ok.connect('clicked', () => state.close());
    root.connect('key-press-event', (_a, event) => {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Escape || key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
            state.close();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    root.connect('button-press-event', (_a, event) => {
        const [x, y] = event.get_coords();
        const [cx, cy] = card.get_transformed_position();
        // Inside the card the press belongs to what is under it (the button).
        if (x >= cx && x <= cx + card.width && y >= cy && y <= cy + card.height)
            return Clutter.EVENT_PROPAGATE;
        state.close();
        return Clutter.EVENT_STOP;
    });
    root.grab_key_focus();
    glass.setStageOrigin(card.x, card.y);

    card.opacity = 0;
    card.translation_y = 18;
    run = timelines.run({
        duration: MotionTokens.medium, easing: Easing.easeOutQuart,
        onFrame: e => {
            card.opacity = Math.round(255 * Math.min(1, e * 1.5));
            card.translation_y = 18 * (1 - e);
        },
    });
    glass.materialize({duration: MotionTokens.medium, fade: false});

    // Seen: the next session starts quietly.
    if (markSeen)
        settings.set_int('whatsnew-seen', Math.max(settings.get_int('whatsnew-seen'), ...releases.map(r => r.id)));
}
