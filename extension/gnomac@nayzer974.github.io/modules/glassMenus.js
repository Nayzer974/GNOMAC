// Liquid Glass for every shell menu: quick settings (restyled as a macOS
// Control Center), the calendar, app menus, dock menus, the system menu.
//
// PopupMenu.open() is wrapped so any menu gets a live GlassSurface stacked
// right below its BoxPointer. The menu's own background is made translucent
// through the `gnomac-glass-menu` class, and the glass follows the
// BoxPointer's open/close animation (opacity + slide) frame by frame.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';
import {getTicker} from '../lib/spring.js';

const FOLLOW_MS = 450; // a bit longer than BoxPointer's 150 ms animation

class MenuGlass {
    constructor(owner, menu) {
        this._owner = owner;
        this._menu = menu;
        this._followUntil = 0;
        this._tick = () => this._onTick();

        menu.box.add_style_class_name('gnomac-glass-menu');
        const radius = menu.box.get_theme_node?.()
            ? menu.box.get_theme_node().get_border_radius(St.Corner.TOPLEFT)
            : 20;
        this._surface = new GlassSurface({
            backdrop: 'windows',
            blur: Math.max(owner.settings.get_int('glass-blur'), 40),
            glass: {
                ...glassParamsFromSettings(owner.settings, radius || 20),
                refraction: owner.settings.get_double('glass-refraction') * 0.8,
            },
        });
        // Never toggled hidden: a hidden actor is skipped by layout, and
        // showing it again made Clutter warn about a missing allocation.
        // Opacity 0 hides it instead (Clutter skips painting it).
        this._surface.opacity = 0;

        this._ids = [
            [menu, menu.connect('open-state-changed', () => this._follow())],
            [menu, menu.connect('destroy', () => this.destroy(true))],
            [menu.box, menu.box.connect('notify::allocation', () => this._syncLater())],
            [menu.actor, menu.actor.connect('notify::visible', () => this._sync())],
        ];
    }

    opened() {
        const parent = this._menu.actor.get_parent();
        if (!parent)
            return;
        if (this._surface.get_parent() !== parent) {
            this._surface.get_parent()?.remove_child(this._surface);
            parent.add_child(this._surface);
        }
        parent.set_child_below_sibling(this._surface, this._menu.actor);
        this._follow();
    }

    // Follow the BoxPointer for the length of its animation only: a ticker
    // running the whole time a menu is open would redraw the stage forever.
    _follow() {
        this._followUntil = GLib.get_monotonic_time() + FOLLOW_MS * 1000;
        getTicker().add(this._tick);
        this._sync();
    }

    _onTick() {
        this._sync();
        return GLib.get_monotonic_time() < this._followUntil;
    }

    // notify::allocation fires in the middle of a layout pass, after our
    // surface (stacked below the menu) was already allocated; resizing it
    // right there leaves it unallocated for this frame. Defer to the next one.
    _syncLater() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const actor = this._menu.actor;
        const box = this._menu.box;
        if (!actor.visible || !box.mapped || !this._surface.get_parent()) {
            this._surface.opacity = 0;
            return;
        }
        const [x, y] = box.get_transformed_position();
        const [width, height] = box.get_transformed_size();
        // Before its first allocation the box reports NaN geometry.
        if (![x, y, width, height].every(Number.isFinite))
            return;
        const [px, py] = this._surface.get_parent().get_transformed_position();
        this._surface.set_position(Math.round(x - px), Math.round(y - py));
        this._surface.set_size(Math.round(width), Math.round(height));
        this._surface.setStageOrigin(x, y);
        this._surface.opacity = actor.opacity;
    }

    destroy(menuGone = false) {
        getTicker().remove(this._tick);
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
        // When the menu is being destroyed its box and actor are already
        // gone, and disconnecting from them would only log criticals.
        for (const [object, id] of this._ids) {
            if (!menuGone || object === this._menu)
                object.disconnect(id);
        }
        this._ids = [];
        if (!menuGone)
            this._menu.box.remove_style_class_name('gnomac-glass-menu');
        this._surface.destroy();
        this._owner.forget(this._menu);
    }
}

export class GlassMenus {
    constructor(extension) {
        this.settings = extension.getSettings();
        this._glasses = new Map();
    }

    enable() {
        const self = this;
        this._originalOpen = PopupMenu.PopupMenu.prototype.open;
        const originalOpen = this._originalOpen;
        PopupMenu.PopupMenu.prototype.open = function (...args) {
            const result = originalOpen.apply(this, args);
            try {
                self._glassFor(this)?.opened();
            } catch (e) {
                logError(e, 'GNOMAC glass menus');
            }
            return result;
        };
    }

    disable() {
        if (this._originalOpen) {
            PopupMenu.PopupMenu.prototype.open = this._originalOpen;
            this._originalOpen = null;
        }
        for (const glass of [...this._glasses.values()])
            glass.destroy();
        this._glasses.clear();
    }

    _glassFor(menu) {
        if (!menu.box || !menu.actor)
            return null;
        let glass = this._glasses.get(menu);
        if (!glass) {
            glass = new MenuGlass(this, menu);
            this._glasses.set(menu, glass);
        }
        return glass;
    }

    forget(menu) {
        this._glasses.delete(menu);
    }
}
