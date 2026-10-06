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
        toggle(modules, 'enable-spotlight', 'Spotlight', 'Super + Espace : apps, calculs, actions système, recherche web');
        toggle(modules, 'enable-glass-menus', 'Menus en verre', 'Tous les menus et le Centre de contrôle en Liquid Glass');
        toggle(modules, 'enable-window-animations', 'Animations des fenêtres', 'Ouverture, fermeture et effet Génie vers le dock');
        toggle(modules, 'enable-dynamic-island', 'Dynamic Island', 'Encoche : musique, minuteur, système, actions rapides, presse-papiers');
        toggle(modules, 'enable-widgets', 'Widgets du bureau', 'Batterie, calendrier, rappels, météo, lecteur');
        toggle(modules, 'enable-launchpad', 'Launchpad', 'Grille d’applications plein écran depuis le dock');
        toggle(modules, 'enable-notifications', 'Notifications macOS', 'Bannières en verre en haut à droite');
        toggle(modules, 'enable-lock-screen', 'Écran de verrouillage', 'Grande horloge en haut, mot de passe en bas, fond net au repos');
        toggle(modules, 'enable-vibrancy', 'Barre latérale Finder', 'Verre dépoli derrière la barre latérale de Fichiers');
        toggle(modules, 'enable-menubar-icons', 'Symboles de la barre de menus', 'Wi-Fi, batterie et Centre de contrôle façon macOS');
        toggle(modules, 'enable-app-menus', 'Menus d’app', 'Fichier, Édition, Présentation, Fenêtre, Aide pour l’app active');
        toggle(modules, 'enable-wallpaper-picker', 'Fonds d’écran', 'Super + W : carrousel et transition en cercle');
        toggle(modules, 'enable-boot-shutdown', 'Démarrage et extinction', 'Logo et barre de progression à l’ouverture de session, animation avant l’arrêt');
        toggle(modules, 'enable-appearance', 'Section Apparence', 'Couleur d’accentuation, clair/sombre, verre et style des icônes dans le Centre de contrôle');
        toggle(modules, 'enable-window-layout', 'Disposition des fenêtres', 'Super + Ctrl + flèches : moitiés ; Super + Ctrl + T : palette (quarts, tiers, centrer)');
        toggle(modules, 'enable-stage-manager', 'Stage Manager au démarrage', 'Ctrl + Super + M l’active ou le coupe à tout moment ; la fenêtre active reste au centre, les autres vont dans une bande à gauche');
        toggle(modules, 'enable-topbar', 'Barre de menus', 'Menu système, nom de l\'app active, horloge à droite');

        const dock = group('Dock');
        toggle(dock, 'dock-auto-size', 'Taille automatique', 'Suit la hauteur de l’écran : le dock garde ses proportions si la résolution change');
        spin(dock, 'dock-size-scale', 'Taille (multiplicateur)', 0.5, 2.0, 0.05, 2);
        spin(dock, 'dock-icon-size', 'Taille des icônes (mode manuel, px)', 24, 128, 2);
        toggle(dock, 'dock-magnification', 'Agrandissement');
        spin(dock, 'dock-max-scale', 'Agrandissement maximal', 1.0, 3.0, 0.05, 2);
        toggle(dock, 'dock-reserve-space', 'Réserver l\'espace', 'Les fenêtres maximisées s\'arrêtent au-dessus du dock');
        spin(dock, 'window-gap', 'Marge autour des fenêtres (px)', 0, 40, 1);
        const iconStyles = ['default', 'dark', 'tinted', 'clear'];
        const iconRow = new Adw.ComboRow({
            title: 'Style des icônes',
            model: Gtk.StringList.new(['Par défaut', 'Sombre', 'Teinté', 'Transparent']),
        });
        iconRow.selected = Math.max(0, iconStyles.indexOf(settings.get_string('dock-icon-style')));
        iconRow.connect('notify::selected', () =>
            settings.set_string('dock-icon-style', iconStyles[iconRow.selected]));
        dock.add(iconRow);
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
        spin(glass, 'glass-intensity', 'Intensité (curseur Liquid Glass de macOS)', 0, 1, 0.05, 2);
        toggle(glass, 'glass-tinted', 'Verre teinté', 'Teinté avec la couleur d’accentuation au lieu de clair');
        toggle(glass, 'glass-dark', 'Teinte sombre');

        const island = group('Dynamic Island');
        toggle(island, 'island-always-visible', 'Toujours visible', 'Encoche noire au repos, mini tableau de bord au survol');
        toggle(island, 'island-notifications', 'Notifications dans l’île', 'En plus des bannières, façon RevoShell');

        const pomodoro = group('Minuteur Pomodoro', 'Réglable aussi directement dans l’encoche (roue crantée)');
        spin(pomodoro, 'pomodoro-focus', 'Concentration (minutes)', 1, 180, 1);
        spin(pomodoro, 'pomodoro-short', 'Pause courte (minutes)', 1, 60, 1);
        spin(pomodoro, 'pomodoro-long', 'Pause longue (minutes)', 1, 120, 1);
        spin(pomodoro, 'pomodoro-rounds', 'Cycles avant la pause longue', 1, 12, 1);
        toggle(pomodoro, 'pomodoro-auto', 'Enchaîner automatiquement', 'Démarre la phase suivante sans clic');

        const boot = group('Démarrage et extinction');
        toggle(boot, 'enable-shutdown-animation', 'Animation d’arrêt', 'Avant l’arrêt, le redémarrage ou la fermeture de session');
        const bootModes = ['auto', 'always', 'never'];
        const bootRow = new Adw.ComboRow({
            title: 'Logo au démarrage de la session',
            subtitle: 'Automatique : désactivé si le thème Plymouth GNOMAC est installé (sinon le logo passerait deux fois)',
            model: Gtk.StringList.new(['Automatique', 'Toujours', 'Jamais']),
        });
        bootRow.selected = Math.max(0, bootModes.indexOf(settings.get_string('boot-animation')));
        bootRow.connect('notify::selected', () => settings.set_string('boot-animation', bootModes[bootRow.selected]));
        boot.add(bootRow);
        spin(boot, 'boot-duration', 'Durée du démarrage (ms)', 600, 8000, 100);
        spin(boot, 'shutdown-duration', 'Durée de l’arrêt (ms)', 600, 6000, 100);

        const misc = group('Bureau et barre de menus');
        const editRow = new Adw.ActionRow({title: 'Modifier les widgets',
            subtitle: 'Clic droit sur le bureau › « Modifier les widgets… », ou Spotlight. Ajout, suppression, déplacement, taille et matière se font sur le bureau.'});
        misc.add(editRow);
        const resetRow = new Adw.ActionRow({title: 'Rétablir les widgets par défaut'});
        const resetButton = new Gtk.Button({label: 'Rétablir', valign: Gtk.Align.CENTER});
        resetButton.connect('clicked', () => settings.set_string('widgets-layout', ''));
        resetRow.add_suffix(resetButton);
        misc.add(resetRow);
        toggle(misc, 'widget-weather', 'Widget météo', 'Interroge wttr.in ; sans ville, localise par adresse IP');
        const cityRow = new Adw.EntryRow({title: 'Ville pour la météo (vide = automatique)'});
        settings.bind('widget-weather-city', cityRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        misc.add(cityRow);
        const logos = ['apple', 'bridge'];
        const logoRow = new Adw.ComboRow({title: 'Logo de la barre de menus',
            model: Gtk.StringList.new(['Pomme', 'Golden Gate (pont)'])});
        logoRow.selected = Math.max(0, logos.indexOf(settings.get_string('logo-style')));
        logoRow.connect('notify::selected', () => settings.set_string('logo-style', logos[logoRow.selected]));
        misc.add(logoRow);
        toggle(misc, 'menubar-hide-extras', 'Masquer les icônes d’apps', 'Regroupées derrière une flèche « dans la barre de menus');

        const motion = group('Animations', 'Ressorts : plus de raideur = plus vif, plus d\'amortissement = moins de rebond');
        spin(motion, 'spring-stiffness', 'Raideur', 40, 1000, 10);
        spin(motion, 'spring-damping', 'Amortissement', 5, 80, 1);
        toggle(motion, 'force-animations', 'Forcer les animations',
            'GNOME les coupe en rendu logiciel (machines virtuelles sans 3D)');
    }
}
