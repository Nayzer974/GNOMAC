import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GnomacPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: 'GNOMAC',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });
        window.add(page);

        const group = (title, description = null) => {
            const g = new Adw.PreferencesGroup({title, description});
            page.add(g);
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

        const modules = group('Modules');
        toggle(modules, 'enable-dock', 'Dock');
        toggle(modules, 'enable-topbar', 'Barre de menus', 'Menu système, nom de l\'app active, horloge à droite');

        const dock = group('Dock');
        spin(dock, 'dock-icon-size', 'Taille des icônes', 24, 128, 2);
        toggle(dock, 'dock-magnification', 'Agrandissement');
        spin(dock, 'dock-max-scale', 'Agrandissement maximal', 1.0, 3.0, 0.05, 2);
        toggle(dock, 'dock-reserve-space', 'Réserver l\'espace', 'Les fenêtres maximisées s\'arrêtent au-dessus du dock');
        toggle(dock, 'dock-show-running', 'Points sous les apps ouvertes');

        const bar = group('Barre de menus');
        const styles = ['transparent', 'glass'];
        const styleRow = new Adw.ComboRow({
            title: 'Fond',
            model: Gtk.StringList.new(['Transparent (Golden Gate)', 'Liquid Glass']),
        });
        styleRow.selected = Math.max(0, styles.indexOf(settings.get_string('panel-style')));
        styleRow.connect('notify::selected', () =>
            settings.set_string('panel-style', styles[styleRow.selected]));
        bar.add(styleRow);

        const glass = group('Liquid Glass', 'Appliqué au dock et à la barre de menus');
        spin(glass, 'glass-blur', 'Flou', 0, 100, 1);
        spin(glass, 'glass-refraction', 'Réfraction des bords (px)', 0, 60, 1, 1);
        spin(glass, 'glass-chroma', 'Dispersion chromatique (px)', 0, 8, 0.1, 1);
        spin(glass, 'glass-rim', 'Lumière de bord', 0, 1, 0.05, 2);
        spin(glass, 'glass-tint-opacity', 'Opacité de la teinte', 0, 0.9, 0.01, 2);
        toggle(glass, 'glass-dark', 'Teinte sombre');

        const motion = group('Animations', 'Ressorts : plus de raideur = plus vif, plus d\'amortissement = moins de rebond');
        spin(motion, 'spring-stiffness', 'Raideur', 40, 1000, 10);
        spin(motion, 'spring-damping', 'Amortissement', 5, 80, 1);
    }
}
