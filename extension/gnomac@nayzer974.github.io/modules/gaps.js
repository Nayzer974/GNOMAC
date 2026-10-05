// Breathing room around maximized windows, like RevoShell's Hyprland gaps:
// thin invisible struts on the left, right and top edges keep maximized
// windows off the screen sides and away from the menu bar (the dock already
// reserves the bottom, plus the same gap above it).

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class Gaps {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._struts = [];
    }

    enable() {
        this._gap = this._settings.get_int('window-gap');
        if (this._gap <= 0)
            return;
        for (let i = 0; i < 3; i++) {
            const strut = new St.Widget({reactive: false});
            Main.layoutManager.addChrome(strut, {affectsStruts: true});
            this._struts.push(strut);
        }
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._layout());
        this._layout();
    }

    disable() {
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        for (const strut of this._struts) {
            Main.layoutManager.removeChrome(strut);
            strut.destroy();
        }
        this._struts = [];
    }

    _layout() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || this._struts.length < 3)
            return;
        const [left, right, top] = this._struts;
        left.set_position(monitor.x, monitor.y);
        left.set_size(this._gap, monitor.height);
        right.set_position(monitor.x + monitor.width - this._gap, monitor.y);
        right.set_size(this._gap, monitor.height);
        top.set_position(monitor.x, monitor.y);
        top.set_size(monitor.width, Main.panel.height + this._gap);
    }
}
