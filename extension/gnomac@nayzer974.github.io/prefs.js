import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


// ---------------------------------------------------------------- profile photo

// The photo lives in AccountsService, like the one of Settings › Users: GDM
// and the lock screen read it from there.
const ACCOUNTS = 'org.freedesktop.Accounts';

function accountsCall(path, iface, method, parameters, replyType) {
    return new Promise((resolve, reject) => {
        Gio.DBus.system.call(ACCOUNTS, path, iface, method, parameters,
            replyType ? new GLib.VariantType(replyType) : null, Gio.DBusCallFlags.NONE, -1, null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

async function userPath() {
    const reply = await accountsCall('/org/freedesktop/Accounts', ACCOUNTS, 'FindUserByName',
        new GLib.Variant('(s)', [GLib.get_user_name()]), '(o)');
    return reply.deepUnpack()[0];
}

async function currentIcon() {
    const path = await userPath();
    const reply = await accountsCall(path, 'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', [`${ACCOUNTS}.User`, 'IconFile']), '(v)');
    return reply.deepUnpack()[0].deepUnpack();
}

async function setIcon(file) {
    const path = await userPath();
    await accountsCall(path, `${ACCOUNTS}.User`, 'SetIconFile', new GLib.Variant('(s)', [file]), null);
}

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
        toggle(dock, 'dock-click-minimize', 'Recliquer sur l’icône cache l’app', 'Un clic sur l’icône de l’app active réduit ses fenêtres, comme sur la barre des tâches de Windows')
        toggle(dock, 'dock-badges', 'Compteurs de notifications', 'Pastille rouge avec le nombre de notifications non lues sur l’icône de l’app')

        const openModes = ['dock', 'pop'];
        const openRow = new Adw.ComboRow({title: 'Ouverture d’une fenêtre',
            subtitle: 'Elle sort de son icône du dock, ou apparaît en fondu depuis 90 %',
            model: Gtk.StringList.new(['Depuis le dock', 'Fondu rapide'])});
        openRow.selected = Math.max(0, openModes.indexOf(settings.get_string('open-animation')));
        openRow.connect('notify::selected', () => settings.set_string('open-animation', openModes[openRow.selected]));
        dock.add(openRow);
        const closeModes = ['genie', 'default'];
        const closeRow = new Adw.ComboRow({title: 'Fermeture d’une fenêtre',
            subtitle: 'Génie : la fenêtre est aspirée dans le dock, comme à la réduction',
            model: Gtk.StringList.new(['Effet Génie', 'Animation GNOME'])});
        closeRow.selected = Math.max(0, closeModes.indexOf(settings.get_string('close-animation')));
        closeRow.connect('notify::selected', () => settings.set_string('close-animation', closeModes[closeRow.selected]));
        dock.add(closeRow);

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

        const island = group('Dynamic Island',
            'Tout se règle ici : quand elle s’ouvre, ce qu’elle affiche, sa taille et ses onglets');
        const combo = (g, key, title, subtitle, choices) => {
            const row = new Adw.ComboRow({title, subtitle,
                model: Gtk.StringList.new(choices.map(([, label]) => label))});
            row.selected = Math.max(0, choices.findIndex(([value]) => value === settings.get_string(key)));
            row.connect('notify::selected', () => settings.set_string(key, choices[row.selected][0]));
            g.add(row);
        };
        combo(island, 'island-open-trigger', 'Ouverture du tableau de bord',
            'Comment l’encoche déplie son contenu', [
                ['both', 'Survol et clic'],
                ['hover', 'Survol seulement'],
                ['click', 'Clic seulement'],
                ['never', 'Jamais (notifications, volume et minuteur uniquement)'],
            ]);
        combo(island, 'island-rest-style', 'Encoche repliée',
            'Visible en permanence, seulement quand elle a quelque chose à montrer, ou invisible jusqu’au survol ou au clic', [
                ['notch', 'Toujours visible'],
                ['events', 'Visible seulement s’il se passe quelque chose'],
                ['hidden', 'Invisible (apparaît au survol ou au clic)'],
            ]);
        spin(island, 'island-scale', 'Taille', 0.9, 1.5, 0.05, 2);
        spin(island, 'island-hover-delay', 'Délai avant ouverture au survol (ms)', 0, 1500, 50);
        spin(island, 'island-close-delay', 'Délai avant fermeture (ms)', 0, 3000, 50);
        spin(island, 'island-autoclose-seconds', 'Fermeture automatique après un clic (secondes, 0 = jamais)', 0, 120, 1);
        toggle(island, 'island-hide-fullscreen', 'Masquer en plein écran');
        toggle(island, 'island-notifications', 'Notifications dans l’île', 'En plus des bannières');
        spin(island, 'island-notice-seconds', 'Durée des notifications (secondes)', 1, 20, 1);

        const content = group('Contenu de l’encoche repliée');
        toggle(content, 'island-show-clock', 'Heure');
        toggle(content, 'island-clock-24h', 'Format 24 heures');
        toggle(content, 'island-show-media', 'Pochette et égaliseur pendant la lecture');
        toggle(content, 'island-show-timer-ring', 'Anneau du minuteur Pomodoro');
        toggle(content, 'island-show-badge', 'Pastille de notifications non lues');
        toggle(content, 'island-hud', 'Volume et luminosité dans l’encoche',
            'Remplace l’affichage à l’écran de GNOME');
        spin(content, 'island-hud-seconds', 'Durée de la barre de volume (secondes)', 0.5, 6, 0.5, 1);

        const tabsGroup = group('Onglets du tableau de bord');
        const tabNames = [
            ['home', 'Accueil'], ['stats', 'Système'], ['actions', 'Actions rapides'],
            ['clipboard', 'Presse-papiers'], ['timer', 'Minuteur'], ['shelf', 'Étagère'],
        ];
        const tabRows = [];
        const writeTabs = () => {
            const active = tabNames.filter((_t, i) => tabRows[i].active).map(([id]) => id);
            // At least one tab must stay.
            settings.set_strv('island-tabs', active.length ? active : ['home']);
        };
        const enabledTabs = settings.get_strv('island-tabs');
        tabNames.forEach(([id, label]) => {
            const row = new Adw.SwitchRow({title: label, active: enabledTabs.includes(id)});
            row.connect('notify::active', writeTabs);
            tabRows.push(row);
            tabsGroup.add(row);
        });
        combo(tabsGroup, 'island-default-tab', 'Onglet affiché à l’ouverture', null, tabNames);
        toggle(tabsGroup, 'island-remember-tab', 'Revenir au dernier onglet utilisé');

        const effects = group('Animations de l’encoche');
        toggle(effects, 'island-bounce', 'Rebond à l’arrivée d’une notification');
        toggle(effects, 'island-cascade', 'Le contenu apparaît élément par élément');

        const pomodoro = group('Minuteur Pomodoro', 'Réglable aussi directement dans l’encoche (roue crantée)');
        spin(pomodoro, 'pomodoro-focus', 'Concentration (minutes)', 1, 180, 1);
        spin(pomodoro, 'pomodoro-short', 'Pause courte (minutes)', 1, 60, 1);
        spin(pomodoro, 'pomodoro-long', 'Pause longue (minutes)', 1, 120, 1);
        spin(pomodoro, 'pomodoro-rounds', 'Cycles avant la pause longue', 1, 12, 1);
        toggle(pomodoro, 'pomodoro-auto', 'Enchaîner automatiquement', 'Démarre la phase suivante sans clic');

        const boot = group('Démarrage et extinction');
        toggle(boot, 'enable-shutdown-animation', 'Animation d’arrêt', 'Avant l’arrêt, le redémarrage ou la fermeture de session');
        const bootStyles = ['mist', 'hello', 'logo', 'classic'];
        const styleRow2 = new Adw.ComboRow({title: 'Style du démarrage',
            subtitle: 'Brume : le bureau apparaît à travers un voile léger (environ 1 s) ; Hello : le logo se dessine puis des mots s’écrivent ; Logo : le logo seul ; Classique : logo et barre',
            model: Gtk.StringList.new(['Brume (légère)', 'Hello (dessiné)', 'Logo dessiné', 'Classique'])});
        styleRow2.selected = Math.max(0, bootStyles.indexOf(settings.get_string('boot-style')));
        styleRow2.connect('notify::selected', () => settings.set_string('boot-style', bootStyles[styleRow2.selected]));
        boot.add(styleRow2);
        spin(boot, 'boot-hello-words', 'Nombre de mots d’accueil', 1, 8, 1);
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

        const placement = group('Widgets du bureau', 'Placement et taille de l’ensemble ; le détail se règle sur le bureau (clic droit › Modifier les widgets)');
        const sides = ['left', 'right'];
        const sideRow = new Adw.ComboRow({title: 'Côté de départ',
            subtitle: 'Les widgets se rangent depuis ce bord de l’écran',
            model: Gtk.StringList.new(['Gauche', 'Droite'])});
        sideRow.selected = Math.max(0, sides.indexOf(settings.get_string('widgets-anchor')));
        sideRow.connect('notify::selected', () => settings.set_string('widgets-anchor', sides[sideRow.selected]));
        placement.add(sideRow);
        spin(placement, 'widgets-scale', 'Taille des widgets', 0.7, 1.6, 0.05, 2);
        spin(placement, 'widgets-margin', 'Marge avec le bord de l’écran (px)', 0, 120, 2);
        toggle(placement, 'enable-widgets', 'Afficher les widgets');

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

        const profile = group('Profil', 'La photo affichée à l’écran de connexion et de verrouillage (la même que dans Paramètres › Utilisateurs)');
        const avatar = new Adw.Avatar({size: 56, text: GLib.get_real_name() || GLib.get_user_name(), show_initials: true});
        const photoRow = new Adw.ActionRow({title: 'Photo de profil', subtitle: 'Choisis une image, de préférence carrée'});
        photoRow.add_prefix(avatar);
        const toast = text => window.add_toast(new Adw.Toast({title: text, timeout: 4}));
        const showIcon = file => {
            try {
                if (file && GLib.file_test(file, GLib.FileTest.EXISTS)) {
                    avatar.set_custom_image(Gdk.Texture.new_from_filename(file));
                    return;
                }
            } catch {}
            avatar.set_custom_image(null);
        };
        currentIcon().then(showIcon).catch(() => {});

        const removeButton = new Gtk.Button({label: 'Retirer', valign: Gtk.Align.CENTER});
        removeButton.connect('clicked', () => {
            setIcon('').then(() => {
                showIcon(null);
                toast('Photo retirée');
            }).catch(e => toast(`Impossible : ${e.message}`));
        });
        const chooseButton = new Gtk.Button({label: 'Choisir…', valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']});
        chooseButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: 'Photo de profil'});
            const filter = new Gtk.FileFilter({name: 'Images'});
            filter.add_mime_type('image/*');
            const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
            filters.append(filter);
            dialog.set_filters(filters);
            dialog.open(window, null, (self, result) => {
                try {
                    const picked = self.open_finish(result);
                    const path = picked.get_path();
                    setIcon(path).then(() => {
                        showIcon(path);
                        toast('Photo mise à jour : elle apparaît à la prochaine connexion');
                    }).catch(e => toast(`Impossible : ${e.message}`));
                } catch {
                    // The dialog was closed without a choice.
                }
            });
        });
        photoRow.add_suffix(removeButton);
        photoRow.add_suffix(chooseButton);
        profile.add(photoRow);

        const motion = group('Animations', 'Ressorts : plus de raideur = plus vif, plus d\'amortissement = moins de rebond');
        spin(motion, 'spring-stiffness', 'Raideur', 40, 1000, 10);
        spin(motion, 'spring-damping', 'Amortissement', 5, 80, 1);
        toggle(motion, 'force-animations', 'Forcer les animations',
            'GNOME les coupe en rendu logiciel (machines virtuelles sans 3D)');
    }
}
