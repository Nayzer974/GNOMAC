// Builds the prayer part of the preferences in a small window of its own and
// drives it, so a typing mistake or a broken search shows up in a test.
// Started by tools/smoke-driver.js inside the throw-away session (the file is
// copied next to the extension's lib/ folder):
//   gjs -m prefs-smoke.js <extension dir>
// It prints lines starting with "GNOMAC-PREFS:".
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {addPrayerPreferences, searchPlace} from './lib/prayerPrefs.js';

const dir = ARGV[0];
const log = message => print(`GNOMAC-PREFS: ${message}`);

const app = new Adw.Application({application_id: 'io.github.nayzer974.GnomacPrefsSmoke', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    const source = Gio.SettingsSchemaSource.new_from_directory(`${dir}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.gnomac', false)});

    const window = new Adw.ApplicationWindow({application: app, title: 'GNOMAC prefs smoke', default_width: 760, default_height: 780});
    // A plain box in a scroller (a PreferencesPage scrolls by itself, which
    // the test could not drive).
    const page = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 24, margin_top: 24, margin_bottom: 24,
        margin_start: 40, margin_end: 40});
    const scroller = new Gtk.ScrolledWindow({child: page});
    window.content = scroller;

    const group = (title, description = null) => {
        const g = new Adw.PreferencesGroup({title, description});
        page.append(g);
        return g;
    };
    const toggle = (g, key, title, subtitle = null) => {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        g.add(row);
    };
    const spin = (g, key, title, min, max, step, digits = 0) => {
        const row = Adw.SpinRow.new_with_range(min, max, step);
        row.title = title;
        row.digits = digits;
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        g.add(row);
    };

    let ui;
    try {
        ui = addPrayerPreferences(settings, {group, toggle, spin});
        log('prayer preferences built ok');
    } catch (e) {
        log(`FAIL building the prayer preferences: ${e}\n${e.stack}`);
        app.quit();
        return;
    }
    window.present();

    // The place search: a real lookup, then the choice is written to the settings.
    searchPlace(ui.getSession(), 'Lyon').then(found => {
        log(found.length && Math.abs(found[0].latitude - 45.75) < 0.5 && Math.abs(found[0].longitude - 4.85) < 0.5
            ? `place search ok: ${found.length} results, first "${found[0].label}" ${found[0].latitude}, ${found[0].longitude}`
            : `FAIL place search returned ${JSON.stringify(found.slice(0, 1))}`);
    }).catch(e => log(`note: place search not tested (no network? ${e.message})`));
    ui.search.text = 'Marseille';
    ui.search.emit('apply');

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4500, () => {
        const lat = settings.get_double('prayer-latitude');
        const city = settings.get_string('prayer-city');
        log(city === 'Marseille' && Math.abs(lat - 43.3) < 0.5
            ? `choosing a result fills the place ok (${city}, ${lat}, ${settings.get_double('prayer-longitude')})`
            : `FAIL place not filled by the search (city "${city}", latitude ${lat}); entry title "${ui.search.title}", results visible ${ui.results.visible}`);
        return GLib.SOURCE_REMOVE;
    });
    // Scroll to the end for the second screenshot.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 6500, () => {
        const adjustment = scroller.get_vadjustment();
        adjustment.set_value(adjustment.get_upper());
        return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 11000, () => {
        app.quit();
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
