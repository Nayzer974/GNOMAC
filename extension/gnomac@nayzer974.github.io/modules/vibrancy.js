// macOS "vibrancy" behind app sidebars: a frosted copy of the wallpaper is
// placed inside the window actor, under the app's own surface. Apps whose
// GTK theme leaves the sidebar translucent (GNOMAC's gtk.css does it for
// Files) then show glass there, while opaque areas hide it completely.
//
// Living inside the MetaWindowActor means it follows every move, scale,
// fade and workspace switch for free, including our Genie and open
// animations. The backdrop is the wallpaper on purpose: a clone of the
// window group would contain the window itself.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';

const APPS = new Set(['org.gnome.Nautilus.desktop']);
const RADIUS = 15; // libadwaita window corners

export class Vibrancy {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._windows = new Map();
    }

    enable() {
        this._createdId = global.display.connect('window-created', (_d, window) => {
            // The app is only known once the window is mapped.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._track(window);
                return GLib.SOURCE_REMOVE;
            });
        });
        for (const actor of global.get_window_actors())
            this._track(actor.meta_window);
    }

    disable() {
        global.display.disconnect(this._createdId);
        for (const window of [...this._windows.keys()])
            this._untrack(window);
    }

    _track(window) {
        if (!window || this._windows.has(window) || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        if (!app || !APPS.has(app.get_id()))
            return;
        const actor = window.get_compositor_private();
        if (!actor)
            return;

        const glass = new GlassSurface({
            backdrop: 'wallpaper',
            blur: Math.max(this._settings.get_int('glass-blur'), 50),
            glass: {
                ...glassParamsFromSettings(this._settings, RADIUS),
                refraction: 0,
                chroma: 0,
                rim: 0.18,
                sheen: 0,
            },
        });
        actor.insert_child_at_index(glass, 0);

        const entry = {glass, actor, ids: []};
        this._windows.set(window, entry);
        const sync = () => this._sync(window);
        entry.ids.push([window, window.connect('position-changed', sync)]);
        entry.ids.push([window, window.connect('size-changed', sync)]);
        entry.ids.push([window, window.connect('notify::fullscreen', sync)]);
        entry.ids.push([window, window.connect('notify::maximized-horizontally', sync)]);
        entry.ids.push([window, window.connect('unmanaged', () => this._untrack(window))]);
        // The glass is a child of the window actor and dies with it.
        entry.ids.push([actor, actor.connect('destroy', () => this._untrack(window, true))]);
        this._sync(window);
    }

    _untrack(window, actorGone = false) {
        const entry = this._windows.get(window);
        if (!entry)
            return;
        this._windows.delete(window);
        for (const [object, id] of entry.ids) {
            if (!(actorGone && object === entry.actor))
                object.disconnect(id);
        }
        if (!actorGone)
            entry.glass.destroy();
    }

    _sync(window) {
        const entry = this._windows.get(window);
        if (!entry)
            return;
        const frame = window.get_frame_rect();
        const buffer = window.get_buffer_rect();
        const glass = entry.glass;
        glass.visible = !window.fullscreen;
        // The actor's origin is the buffer (shadows included); the glass
        // must cover the visible frame only.
        glass.set_position(frame.x - buffer.x, frame.y - buffer.y);
        glass.set_size(frame.width, frame.height);
        glass.setStageOrigin(frame.x, frame.y);
        const square = window.maximized_horizontally && window.maximized_vertically;
        glass.setGlass({radius: square ? 0 : RADIUS});
    }
}
