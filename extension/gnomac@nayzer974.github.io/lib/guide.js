// "Guide GNOMAC": a glass sheet with every shortcut and gesture of the
// project, found by typing "guide" in Spotlight. Same content as the README.

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {t} from './i18n.js';

const SECTIONS = () => [
    [t('Windows', 'Fenêtres'), [
        ['⌃⌘ ←  →  ↑  ↓', t('Tile the window: left, right, top, bottom half', 'Moitié gauche, droite, haute, basse')],
        ['⌃⌘ ↩', t('Fill the screen', 'Remplir l’écran')],
        ['⌃⌘ C', t('Centre the window', 'Centrer la fenêtre')],
        ['⌃⌘ T', t('Layout palette: quarters, thirds, centre', 'Palette : quarts, tiers, centrage')],
        ['⌃⌘ T  ·  1–9', t('Pick a layout by its number', 'Choisir une disposition par son numéro')],
        ['⌃⌘ M', t('Stage Manager: the active window on stage, the others in a strip', 'Stage Manager : la fenêtre active au centre, les autres en bande à gauche')],
        ['⌘ ⇥', t('Switch app', 'Changer d’application')],
        ['Space', t('Quick Look in Files (needs the sushi package)', 'Aperçu rapide dans Fichiers (paquet sushi requis)')],
    ]],
    [t('Search', 'Recherche'), [
        ['⌘ Space', t('Spotlight: apps, files, actions, clipboard, menus', 'Spotlight : apps, fichiers, actions, presse-papiers, menus')],
        ['⌘ 1 … 5', t('Switch Spotlight mode', 'Changer de mode dans Spotlight')],
        ['guide', t('Opens this guide', 'Ouvre ce guide')],
        ['9+9', t('Inline calculator', 'Calculatrice intégrée')],
    ]],
    [t('Desktop', 'Bureau'), [
        [t('Right-click desktop', 'Clic droit bureau'), t('Edit Widgets…', 'Modifier les widgets…')],
        [t('Drag a widget', 'Glisser un widget'), t('Move it (snaps to the grid)', 'Le déplacer (accroche à la grille)')],
        [t('Handle ◢', 'Poignée ◢'), t('Small, medium, large, XXL', 'Petit, moyen, grand, XXL')],
        [t('Right-click widget', 'Clic droit widget'), t('Material, size, city, remove', 'Matière, taille, ville, retirer')],
        ['⌘ W', t('Wallpaper carousel', 'Carrousel de fonds d’écran')],
    ]],
    [t('Menu bar', 'Barre de menus'), [
        [t('Control Center', 'Centre de contrôle'), t('Wi-Fi, Bluetooth, volume, Appearance (accent, glass, icons)',
            'Wi-Fi, Bluetooth, volume, Apparence (accent, verre, icônes)')],
        [t('App name', 'Nom de l’app'), t('Its menus: File, Edit, View, Window, Help', 'Ses menus : Fichier, Édition, Présentation, Fenêtre, Aide')],
        [t('Notch', 'Encoche'), t('Hover it for the dashboard', 'Survol : tableau de bord')],
    ]],
    [t('Dock', 'Dock'), [
        [t('Click', 'Clic'), t('Open or bring to front', 'Ouvrir ou passer devant')],
        [t('Right-click', 'Clic droit'), t('Options, keep in Dock, quit', 'Options, garder dans le Dock, quitter')],
        [t('Drag a file onto an icon', 'Glisser un fichier sur une icône'), t('Open it with that app', 'L’ouvrir avec cette app')],
    ]],
    [t('Screenshots', 'Captures'), [
        ['⇧⌘ 5', t('Screenshot toolbar (Print Screen)', 'Barre de capture (Impr. écran)')],
    ]],
];

let current = null;

export function closeGuide(immediate = false) {
    const sheet = current;
    current = null;
    if (!sheet)
        return;
    if (sheet.grab) {
        Main.popModal(sheet.grab);
        sheet.grab = null;
    }
    if (immediate)
        sheet.root.destroy();
    else
        sheet.root.ease({opacity: 0, duration: 160, onStopped: () => sheet.root.destroy()});
}

export function showGuide() {
    if (current)
        return;
    const monitor = Main.layoutManager.primaryMonitor;
    const root = new St.Widget({style_class: 'gnomac-guide-backdrop', reactive: true,
        x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
        layout_manager: new Clutter.BinLayout(), opacity: 0});

    const width = Math.min(980, Math.round(monitor.width * 0.82));
    const height = Math.min(700, Math.round(monitor.height * 0.86));
    const panel = new St.BoxLayout({style_class: 'gnomac-guide', vertical: true, width, height,
        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
    panel.add_child(new St.Label({style_class: 'gnomac-guide-title', text: t('GNOMAC Guide', 'Guide GNOMAC')}));
    panel.add_child(new St.Label({style_class: 'gnomac-guide-sub',
        text: t('Shortcuts and gestures · Esc to close', 'Raccourcis et gestes · Échap pour fermer')}));

    const scroll = new St.ScrollView({style_class: 'gnomac-guide-scroll', y_expand: true, x_expand: true,
        hscrollbar_policy: St.PolicyType.NEVER});
    const columns = new St.BoxLayout({style_class: 'gnomac-guide-columns', x_expand: true});
    const left = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'gnomac-guide-column'});
    const right = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'gnomac-guide-column'});
    columns.add_child(left);
    columns.add_child(right);
    SECTIONS().forEach(([title, rows], index) => {
        const section = new St.BoxLayout({vertical: true, style_class: 'gnomac-guide-section'});
        section.add_child(new St.Label({style_class: 'gnomac-guide-heading', text: title}));
        for (const [keys, text] of rows) {
            const row = new St.BoxLayout({style_class: 'gnomac-guide-row'});
            row.add_child(new St.Label({style_class: 'gnomac-guide-keys', text: keys, y_align: Clutter.ActorAlign.START}));
            const label = new St.Label({style_class: 'gnomac-guide-text', text, x_expand: true});
            label.clutter_text.line_wrap = true;
            row.add_child(label);
            section.add_child(row);
        }
        (index % 2 === 0 ? left : right).add_child(section);
    });
    scroll.set_child(columns);
    panel.add_child(scroll);
    root.add_child(panel);

    root.connect('button-press-event', (_a, event) => {
        const [x, y] = event.get_coords();
        const [px, py] = panel.get_transformed_position();
        const [pw, ph] = panel.get_transformed_size();
        if (x < px || x > px + pw || y < py || y > py + ph)
            closeGuide();
        return Clutter.EVENT_STOP;
    });
    root.connect('key-press-event', (_a, event) => {
        if (event.get_key_symbol() === Clutter.KEY_Escape)
            closeGuide();
        return Clutter.EVENT_STOP;
    });

    Main.layoutManager.uiGroup.add_child(root);
    Main.layoutManager.uiGroup.set_child_above_sibling(root, null);
    const grab = Main.pushModal(root, {actionMode: Shell.ActionMode.POPUP});
    if (!grab) {
        root.destroy();
        return;
    }
    current = {root, grab};
    panel.set_pivot_point(0.5, 0.5);
    panel.set_scale(0.94, 0.94);
    panel.ease({scale_x: 1, scale_y: 1, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    root.ease({opacity: 255, duration: 180});
}
