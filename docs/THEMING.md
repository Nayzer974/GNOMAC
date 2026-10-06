# Personnaliser le thème de GNOMAC

Tu peux changer l'allure de GNOMAC à trois niveaux, du plus simple au plus libre. Tout se fait **sans se déconnecter**.

| Niveau | Où | Pour qui |
|---|---|---|
| 1. Réglages | Préférences de GNOMAC › **Thème** | tout le monde : couleur, angles, ombres, taille du texte, police, densité |
| 2. Ton CSS | `~/.config/gnomac/user.css` | tu veux restyler un élément précis : il s'applique **dès l'enregistrement** |
| 3. Le code | `~/.local/share/gnome-shell/extensions/gnomac@nayzer974.github.io/` | tu veux changer le comportement ; une mise à jour le remplace |

L'écran de connexion a ses propres fichiers : voir [plus bas](#écran-de-connexion).

## 1. Les réglages

`gnome-extensions prefs gnomac@nayzer974.github.io` › **Thème**.

- **Couleur d'accentuation** : onglets, barres, surbrillances, titres du guide, palette de disposition.
- **Style des angles** : carrés, arrondis, très arrondis.
- **Ombre des panneaux** : aucune, douce, marquée.
- **Taille du texte** (0,8 à 1,4), **densité des listes**, **police** de l'interface.
- **Réinitialiser** remet tout comme à l'installation.

Ces réglages produisent le fichier `~/.config/gnomac/generated.css` (ne le modifie pas : il est réécrit à chaque changement).

## 2. Ton CSS : `user.css`

Au premier lancement, GNOMAC crée `~/.config/gnomac/user.css` avec des exemples en commentaires. Ouvre-le :

```bash
xdg-open ~/.config/gnomac/user.css      # ou : le bouton « Ouvrir » des préférences
```

Il est chargé **après** tout le reste et toutes ses déclarations sont traitées comme prioritaires : **tes règles gagnent toujours**, même avec un sélecteur plus court que celui du thème. Chaque enregistrement recharge le thème. Une faute de syntaxe est ignorée (une notification te prévient), elle ne casse jamais le shell. Pour repartir de zéro, supprime le fichier : une copie neuve est recréée.

### Exemples

```css
/* Barre de menus plus marquée */
#panel.gnomac-panel { font-weight: 600; background-color: rgba(0, 0, 0, 0.25); }

/* Points « app ouverte » du dock en vert, compteurs en orange */
.gnomac-dock-dot { background-color: #30d158; }
.gnomac-dock-badge { background-color: #ff9f0a; }

/* Grande horloge de widget */
.gnomac-widget-clock { font-size: 38pt; }

/* Palette de disposition en vert */
.gnomac-layout-region { background-color: #30d158; }
```

### Trouver le nom d'un élément

Les noms ci-dessous couvrent tout GNOMAC, mais le plus simple est de **pointer** l'élément :

1. `Alt + F2`, tape `lg`, Entrée (« Looking Glass »).
2. Clique sur l'icône **viseur** en haut, puis sur l'élément à l'écran.
3. Dans l'onglet *Inspector*, la **classe de style** (`style_class`) apparaît : c'est ce qu'il faut écrire après un point dans ton CSS.

### Ce que GNOME Shell accepte

Le CSS de GNOME Shell est un sous-ensemble : couleurs, `background-color`, `border`, `border-radius`, `box-shadow`, `padding`, `margin`, `font-size`, `font-weight`, `font-family`, `color`, `text-shadow`, `spacing`, `min-width`/`min-height`. **Pas de** variables CSS, de `transition`, d'`animation`, ni de `display`. Les marges négatives ne marchent pas. Les animations se règlent dans les préférences (section *Animations*).

## 3. Modifier le code du thème

Le thème d'origine est `stylesheet.css`, dans le dossier de l'extension :

```bash
cd ~/.local/share/gnome-shell/extensions/gnomac@nayzer974.github.io/
```

Tu peux l'éditer. **Mais** une mise à jour de GNOMAC (`git pull` puis `./install.sh`) **écrase** ce dossier : pour garder tes changements, mets-les dans `user.css`, ou travaille depuis un clone du dépôt :

```bash
git clone https://github.com/Nayzer974/GNOMAC.git && cd GNOMAC
# modifie extension/gnomac@nayzer974.github.io/stylesheet.css, les modules/ ou lib/
./install.sh
# déconnecte-toi puis reconnecte-toi : Wayland ne recharge pas le shell à chaud
```

Dossiers utiles : `modules/` (un fichier par fonction : `dock.js`, `dynamicIsland.js`, `widgets.js`…), `lib/` (verre, ressorts, démarrage…), `schemas/` (les réglages), `icons/`.

Pour tester sans te déconnecter : `dbus-run-session gnome-shell --devkit --wayland` (GNOME 49 et plus) ; les erreurs sont dans `journalctl -f -o cat /usr/bin/gnome-shell | grep -i gnomac`.

## Écran de connexion

Deux fichiers, à modifier **en administrateur** puis à redémarrer (ou `sudo systemctl restart gdm`, qui ferme ta session) :

```bash
sudo nano /etc/gnomac/login.conf     # réglages simples
sudo nano /etc/gnomac/login.css      # ton CSS pour l'écran de connexion
```

`login.conf` :

| Clé | Valeurs | Effet |
|---|---|---|
| `clock` | `big`, `small`, `none` | horloge du haut |
| `date` | `true`, `false` | date au-dessus de l'horloge |
| `power-buttons` | `true`, `false` | boutons Veille / Redémarrer / Éteindre |
| `dim` | 0.3 à 1.0 | luminosité du fond d'écran |
| `fade` | secondes | durée du fondu du fond (0 = immédiat) |
| `avatar-size` | 64 à 160 | taille de l'avatar |
| `accent` | `#rrggbb` | couleur du champ de mot de passe et de l'avatar |
| `wallpaper` | chemin | image de fond (lisible par tous) |

La **photo de profil** se change dans les préférences de GNOMAC › Profil (ou Paramètres › Utilisateurs). Pour changer le **fond** : `sudo ./gdm/install-gdm.sh --wallpaper image.jpg`. Ces fichiers ne sont jamais écrasés par une réinstallation.

## Référence : les classes de GNOMAC

### Barre de menus

`.gnomac-apple-button` `.gnomac-appname` `.gnomac-clock` `.gnomac-kbd` `.gnomac-logo` `.gnomac-menu-shortcut` `.gnomac-menu-title` `.gnomac-mic-pill` `.gnomac-panel` `.gnomac-sf-battery` `.gnomac-sf-battery-body` `.gnomac-sf-battery-fill` `.gnomac-sf-battery-label` `.gnomac-sf-battery-nub` `.gnomac-sf-box` `.gnomac-sf-chevron` `.gnomac-sf-focus` `.gnomac-sf-icon` `.gnomac-sf-pill` `.gnomac-sf-search`

### Dock

`.gnomac-dock-apps-icon` `.gnomac-dock-badge` `.gnomac-dock-dot` `.gnomac-dock-poof` `.gnomac-dock-separator` `.gnomac-dock-tooltip`

### Encoche (Dynamic Island)

`.gnomac-chip` `.gnomac-chip-fill` `.gnomac-chip-label` `.gnomac-island` `.gnomac-island-artist` `.gnomac-island-bar` `.gnomac-island-bars` `.gnomac-island-compact` `.gnomac-island-compact-art` `.gnomac-island-compact-label` `.gnomac-island-control` `.gnomac-island-controls` `.gnomac-island-dash` `.gnomac-island-dash-hint` `.gnomac-island-dash-time` `.gnomac-island-media` `.gnomac-island-media-art` `.gnomac-island-media-text` `.gnomac-island-notice` `.gnomac-island-notice-icon` `.gnomac-island-title` `.gnomac-notch-actions` `.gnomac-notch-badge` `.gnomac-notch-badge-dot` `.gnomac-notch-cal` `.gnomac-notch-cal-day` `.gnomac-notch-cal-head` `.gnomac-notch-cal-title` `.gnomac-notch-chip` `.gnomac-notch-chip-label` `.gnomac-notch-clip-row` `.gnomac-notch-clipboard` `.gnomac-notch-clock` `.gnomac-notch-controls` `.gnomac-notch-dashboard` `.gnomac-notch-dot` `.gnomac-notch-dots` `.gnomac-notch-fill` `.gnomac-notch-home` `.gnomac-notch-home-player` `.gnomac-notch-hud` `.gnomac-notch-idle` `.gnomac-notch-idle-chips` `.gnomac-notch-idle-time` `.gnomac-notch-media` `.gnomac-notch-media-top` `.gnomac-notch-notice` `.gnomac-notch-pill-button` `.gnomac-notch-progress` `.gnomac-notch-shelf` `.gnomac-notch-shelf-item` `.gnomac-notch-side` `.gnomac-notch-stat-name` `.gnomac-notch-stat-row` `.gnomac-notch-stat-value` `.gnomac-notch-stats` `.gnomac-notch-step` `.gnomac-notch-step-value` `.gnomac-notch-stepper` `.gnomac-notch-subtitle` `.gnomac-notch-tab` `.gnomac-notch-tabs` `.gnomac-notch-time` `.gnomac-notch-timer` `.gnomac-notch-timer-head` `.gnomac-notch-timer-main` `.gnomac-notch-timer-settings` `.gnomac-notch-timer-time` `.gnomac-notch-title` `.gnomac-notch-track`

### Widgets du bureau

`.gnomac-countdown-days` `.gnomac-forecast-day` `.gnomac-forecast-row` `.gnomac-gallery` `.gnomac-gallery-header` `.gnomac-gallery-item` `.gnomac-gallery-list` `.gnomac-gallery-plus` `.gnomac-gallery-row` `.gnomac-gallery-title` `.gnomac-gallery-tools` `.gnomac-graph-label` `.gnomac-photo` `.gnomac-progress-percent` `.gnomac-progress-row` `.gnomac-widget` `.gnomac-widget-app` `.gnomac-widget-badge` `.gnomac-widget-big` `.gnomac-widget-caption` `.gnomac-widget-check` `.gnomac-widget-clock` `.gnomac-widget-entry` `.gnomac-widget-ghost` `.gnomac-widget-handle` `.gnomac-widget-list` `.gnomac-widget-music-button` `.gnomac-widget-music-controls` `.gnomac-widget-music-title` `.gnomac-widget-notes` `.gnomac-widget-reminder` `.gnomac-widget-row` `.gnomac-widget-text` `.gnomac-widget-title` `.gnomac-world-city` `.gnomac-world-row` `.gnomac-world-time`

### Spotlight

`.gnomac-spotlight-bar` `.gnomac-spotlight-content` `.gnomac-spotlight-entry` `.gnomac-spotlight-mode` `.gnomac-spotlight-results` `.gnomac-spotlight-row` `.gnomac-spotlight-row-icon` `.gnomac-spotlight-row-subtitle` `.gnomac-spotlight-row-title` `.gnomac-spotlight-search-icon` `.gnomac-spotlight-section` `.gnomac-spotlight-symbol`

### Launchpad

`.gnomac-launchpad-dot` `.gnomac-launchpad-dots` `.gnomac-launchpad-label` `.gnomac-launchpad-search` `.gnomac-launchpad-search-icon` `.gnomac-launchpad-tile`

### Notifications

`.gnomac-notifications`

### À propos, Guide, Apparence

`.gnomac-about-box` `.gnomac-about-button` `.gnomac-about-buttons` `.gnomac-about-footer` `.gnomac-about-grid` `.gnomac-about-key` `.gnomac-about-kind` `.gnomac-about-machine` `.gnomac-about-model` `.gnomac-about-row` `.gnomac-about-value` `.gnomac-about2-bar` `.gnomac-about2-bar-used` `.gnomac-about2-box` `.gnomac-about2-buttons` `.gnomac-about2-key` `.gnomac-about2-kind` `.gnomac-about2-model` `.gnomac-about2-page` `.gnomac-about2-row` `.gnomac-about2-tab` `.gnomac-about2-tabs` `.gnomac-about2-value` `.gnomac-appearance` `.gnomac-appearance-sub` `.gnomac-appearance-title` `.gnomac-guide` `.gnomac-guide-backdrop` `.gnomac-guide-column` `.gnomac-guide-columns` `.gnomac-guide-heading` `.gnomac-guide-keys` `.gnomac-guide-row` `.gnomac-guide-section` `.gnomac-guide-sub` `.gnomac-guide-text` `.gnomac-guide-title` `.gnomac-seg` `.gnomac-seg-item` `.gnomac-swatch` `.gnomac-swatches`

### Fenêtres (disposition, Stage Manager)

`.gnomac-layout-backdrop` `.gnomac-layout-button` `.gnomac-layout-caption` `.gnomac-layout-panel` `.gnomac-layout-region` `.gnomac-layout-screen` `.gnomac-layout-title` `.gnomac-stage-card` `.gnomac-stage-strip` `.gnomac-stage-title` `.gnomac-tile-ghost`

### Démarrage et extinction

`.gnomac-boot-base` `.gnomac-boot-caption` `.gnomac-boot-fill` `.gnomac-boot-logo` `.gnomac-boot-track`

### Écran de connexion

`.gnomac-login-date` `.gnomac-login-power` `.gnomac-login-power-cell` `.gnomac-login-power-label` `.gnomac-login-power-row` `.gnomac-login-time`

### Autres

`.gnomac-confirm-body` `.gnomac-confirm-content` `.gnomac-confirm-title` `.gnomac-fan-empty` `.gnomac-fan-item` `.gnomac-fan-label` `.gnomac-fan-more` `.gnomac-fan-thumb` `.gnomac-glass-menu` `.gnomac-lock` `.gnomac-lock-avatar` `.gnomac-lock-name` `.gnomac-lock-pill` `.gnomac-lock-rest` `.gnomac-wallpicker` `.gnomac-wallpicker-card` `.gnomac-wallpicker-hint` `.gnomac-wallpicker-title`

Les éléments propres à GNOME Shell (menus système, calendrier, Centre de contrôle, sélecteur d'applications) gardent leurs classes d'origine (`.popup-menu-item`, `.quick-toggle`, `.switcher-list`…) : GNOMAC les restyle dans `stylesheet.css`, tu peux les surcharger de la même façon.

## Revenir en arrière

- Un réglage : bouton **Réinitialiser** (Thème).
- Ton CSS : vide ou supprime `user.css`.
- Tout GNOMAC : `./uninstall.sh` (remet aussi les réglages GNOME d'avant l'installation).
