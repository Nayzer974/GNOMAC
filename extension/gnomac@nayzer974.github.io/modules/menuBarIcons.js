// macOS 27 status items on the right of the menu bar: Wi-Fi fan (or the
// Ethernet "<···>" glyph), a horizontal battery with its percentage, and
// the Control Center symbol. They live inside GNOME's quick settings
// button, so a click still opens the (glass) Control Center.
//
// GNOME's own status icons are hidden; privacy indicators (camera,
// microphone, location, remote access, screen sharing) always stay.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const HIDDEN = [
    '_network', '_bluetooth', '_system', '_volumeOutput', '_brightness',
    '_thunderbolt', '_nightLight', '_darkMode', '_doNotDisturb', '_backlight',
    '_rfkill', '_autoRotate', '_powerProfiles',
];

const UPOWER_IFACE = `<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type" type="u" access="read"/>
    <property name="State" type="u" access="read"/>
    <property name="Percentage" type="d" access="read"/>
    <property name="IsPresent" type="b" access="read"/>
  </interface>
</node>`;
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPOWER_IFACE);
const UPOWER_BATTERY = 2;
const UPOWER_CHARGING = 1;

function networkSymbol(iconName) {
    if (!iconName)
        return null;
    if (iconName.includes('wired') && !iconName.includes('disconnected'))
        return 'ethernet';
    if (iconName.includes('excellent') || iconName.includes('good'))
        return 'wifi-3';
    if (iconName.includes('-ok'))
        return 'wifi-2';
    if (iconName.includes('weak'))
        return 'wifi-1';
    if (iconName.includes('none') || iconName.includes('acquiring'))
        return 'wifi-0';
    if (iconName.includes('offline') || iconName.includes('disabled') ||
        iconName.includes('disconnected') || iconName.includes('no-route'))
        return 'wifi-off';
    return null;
}

export class MenuBarIcons {
    constructor(extension) {
        this._extension = extension;
        this._path = extension.path;
        this._hidden = [];
        this._networkIds = [];
    }

    _icon(name) {
        return Gio.icon_new_for_string(`${this._path}/icons/sf/${name}.svg`);
    }

    enable() {
        const qs = Main.panel.statusArea.quickSettings;
        if (!qs?._indicators)
            return;
        this._qs = qs;

        this._adoptIndicators();
        // GNOME builds these indicators asynchronously at startup, after
        // extensions are enabled: catch the late ones as they arrive.
        this._childAddedId = qs._indicators.connect('child-added', () => {
            this._adoptIndicators();
            if (!this._networkIds.length)
                this._watchNetwork();
            if (this._box && qs._indicators.get_last_child() !== this._box)
                qs._indicators.set_child_above_sibling(this._box, null);
        });

        this._box = new St.BoxLayout({style_class: 'gnomac-sf-box', y_align: Clutter.ActorAlign.CENTER});

        this._network = new St.Icon({style_class: 'gnomac-sf-icon', icon_size: 16, visible: false});
        this._box.add_child(this._network);

        this._battery = new St.BoxLayout({style_class: 'gnomac-sf-battery', visible: false,
            y_align: Clutter.ActorAlign.CENTER});
        this._batteryLabel = new St.Label({style_class: 'gnomac-sf-battery-label',
            y_align: Clutter.ActorAlign.CENTER});
        this._batteryBody = new St.Widget({style_class: 'gnomac-sf-battery-body',
            layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER});
        this._batteryFill = new St.Widget({style_class: 'gnomac-sf-battery-fill',
            x_align: Clutter.ActorAlign.START, y_expand: true, y_align: Clutter.ActorAlign.FILL});
        this._batteryBolt = new St.Icon({gicon: this._icon('bolt'), icon_size: 10,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, visible: false});
        this._batteryBody.add_child(this._batteryFill);
        this._batteryBody.add_child(this._batteryBolt);
        const nub = new St.Widget({style_class: 'gnomac-sf-battery-nub', y_align: Clutter.ActorAlign.CENTER});
        this._battery.add_child(this._batteryLabel);
        this._battery.add_child(this._batteryBody);
        this._battery.add_child(nub);
        this._box.add_child(this._battery);

        // Focus / Do Not Disturb: the purple moon pill of the video.
        this._focus = new St.Bin({style_class: 'gnomac-sf-pill gnomac-sf-focus', visible: false,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({gicon: this._icon('moon'), icon_size: 13})});
        this._box.add_child(this._focus);
        this._notifSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._focusId = this._notifSettings.connect('changed::show-banners', () => this._syncFocus());
        this._syncFocus();

        this._box.add_child(new St.Icon({gicon: this._icon('control-center'),
            style_class: 'gnomac-sf-icon', icon_size: 16}));

        qs._indicators.add_child(this._box);

        // Spotlight's magnifier sits right before the Control Center.
        this._search = new St.Button({
            style_class: 'panel-button gnomac-sf-search',
            child: new St.Icon({gicon: this._icon('search'), icon_size: 15}),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._search.connect('clicked', () => {
            const spotlight = this._extension._modules?.find(m => m.constructor.name === 'Spotlight');
            spotlight?.toggle(this._search);
        });
        // During shell shutdown the panel may destroy it before disable().
        this._search.connect('destroy', () => (this._search = null));
        const right = Main.panel._rightBox;
        right.insert_child_below(this._search, qs.container);

        // Keyboard layout as a white badge ("EN"), microphone in use as an
        // orange pill, like the macOS 27 menu bar.
        this._keyboard = Main.panel.statusArea.keyboard;
        this._keyboard?.add_style_class_name('gnomac-kbd');
        qs._volumeInput?.add_style_class_name('gnomac-mic-pill');

        this._watchNetwork();
        this._watchBattery();
        this._setupExtras();
    }

    // "Automatically hide menu bar items": app tray icons (AppIndicator)
    // fold behind a chevron; a click unfolds them.
    _setupExtras() {
        this._extrasCollapsed = this._extension.getSettings().get_boolean('menubar-hide-extras');
        this._chevron = new St.Button({
            style_class: 'panel-button gnomac-sf-chevron',
            child: new St.Label({text: '«', y_align: Clutter.ActorAlign.CENTER}),
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._chevron.connect('clicked', () => {
            this._extrasCollapsed = !this._extrasCollapsed;
            this._syncExtras();
        });
        this._chevron.connect('destroy', () => (this._chevron = null));
        Main.panel._rightBox.insert_child_at_index(this._chevron, 0);
        this._rightId = Main.panel._rightBox.connect('child-added', () => this._syncExtras());
        this._syncExtras();
    }

    _extraButtons() {
        return Object.entries(Main.panel.statusArea)
            .filter(([key]) => key.startsWith('appindicator'))
            .map(([, button]) => button.container);
    }

    _syncExtras() {
        if (!this._chevron)
            return;
        const extras = this._extraButtons();
        for (const container of extras)
            container.visible = !this._extrasCollapsed;
        this._chevron.visible = extras.length > 0;
        this._chevron.child.text = this._extrasCollapsed ? '«' : '»';
    }

    // Keep GNOME's status icons hidden even when they toggle themselves,
    // remembering what GNOME wants each to be so disable() restores it.
    _adoptIndicators() {
        const qs = this._qs;
        for (const name of HIDDEN) {
            const indicator = qs[name];
            if (!indicator || this._hidden.some(e => e.indicator === indicator))
                continue;
            const entry = {indicator, wanted: indicator.visible};
            entry.id = indicator.connect('notify::visible', () => {
                if (indicator.visible) {
                    entry.wanted = true;
                    entry.hiding = true;
                    indicator.hide();
                    entry.hiding = false;
                } else if (!entry.hiding) {
                    entry.wanted = false;
                }
            });
            this._hidden.push(entry);
            entry.hiding = true;
            indicator.hide();
            entry.hiding = false;
        }
    }

    disable() {
        // During shell shutdown the panel boxes die before disable() runs.
        const panelAlive = Main.panel._rightBox && !Main.panel._rightBox.is_destroyed?.() &&
            Main.panel._rightBox.get_stage?.();
        if (this._rightId && panelAlive)
            Main.panel._rightBox.disconnect(this._rightId);
        this._rightId = 0;
        if (panelAlive) {
            for (const container of this._extraButtons?.() ?? [])
                container.visible = true;
        }
        this._chevron?.destroy();
        this._chevron = null;
        if (this._focusId) {
            this._notifSettings.disconnect(this._focusId);
            this._focusId = 0;
        }
        this._search?.destroy();
        this._search = null;
        this._keyboard?.remove_style_class_name('gnomac-kbd');
        this._keyboard = null;
        this._qs?._volumeInput?.remove_style_class_name('gnomac-mic-pill');
        if (this._childAddedId) {
            this._qs._indicators.disconnect(this._childAddedId);
            this._childAddedId = 0;
        }
        // Let GNOME recompute each indicator from its icons; fall back to
        // the last state it asked for.
        for (const {indicator, id, wanted} of this._hidden) {
            indicator.disconnect(id);
            if (indicator._syncIndicatorsVisible)
                indicator._syncIndicatorsVisible();
            else
                indicator.visible = wanted;
        }
        this._hidden = [];
        for (const [object, id] of this._networkIds)
            object.disconnect(id);
        this._networkIds = [];
        this._upower = null;
        this._box?.destroy();
        this._box = null;
        this._qs = null;
    }

    _syncFocus() {
        if (this._focus)
            this._focus.visible = !this._notifSettings.get_boolean('show-banners');
    }

    // GNOME's network indicator already tracks NetworkManager; read the
    // icon it would show and translate it to the macOS symbol.
    _watchNetwork() {
        const network = this._qs._network;
        if (!network)
            return;
        const update = () => this._syncNetwork();
        for (const child of network.get_children()) {
            if (!(child instanceof St.Icon))
                continue;
            this._networkIds.push([child, child.connect('notify::gicon', update)]);
            this._networkIds.push([child, child.connect('notify::icon-name', update)]);
            this._networkIds.push([child, child.connect('notify::visible', update)]);
        }
        this._syncNetwork();
    }

    _syncNetwork() {
        const network = this._qs?._network;
        if (!network || !this._network)
            return;
        let symbol = null;
        for (const child of network.get_children()) {
            if (!(child instanceof St.Icon) || !child.visible)
                continue;
            const name = child.icon_name || child.gicon?.to_string?.() || '';
            symbol = networkSymbol(name);
            if (symbol)
                break;
        }
        this._network.visible = !!symbol;
        if (symbol)
            this._network.gicon = this._icon(symbol);
    }

    _watchBattery() {
        new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice', (proxy, error) => {
                if (error || !this._box)
                    return;
                this._upower = proxy;
                proxy.connect('g-properties-changed', () => this._syncBattery());
                this._syncBattery();
            });
    }

    _syncBattery() {
        const p = this._upower;
        if (!p || !this._battery)
            return;
        const present = p.IsPresent && p.Type === UPOWER_BATTERY;
        this._battery.visible = !!present;
        if (!present)
            return;
        const percent = Math.round(p.Percentage);
        this._batteryLabel.text = `${percent} %`;
        // Green only while actually charging; full on power stays white.
        const charging = p.State === UPOWER_CHARGING;
        this._batteryBolt.visible = p.State === UPOWER_CHARGING;
        const innerWidth = 19; // body 23 px minus border and padding
        this._batteryFill.set_width(Math.max(2, Math.round(innerWidth * percent / 100)));
        this._batteryFill.remove_style_class_name('low');
        this._batteryFill.remove_style_class_name('charging');
        if (charging)
            this._batteryFill.add_style_class_name('charging');
        else if (percent <= 20)
            this._batteryFill.add_style_class_name('low');
    }
}
