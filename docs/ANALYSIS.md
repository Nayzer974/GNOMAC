# Analyse : RevoShell, Gnomintosh, macOS 27 Golden Gate

Analyse réalisée le 3 octobre 2026 à partir du code de [vzbc/revo-shell](https://github.com/vzbc/revo-shell), de l'AppImage `RevoShell-Installer-x86_64.AppImage` (ouvert sans être exécuté), de [jothi-prasath/gnomintosh](https://github.com/jothi-prasath/gnomintosh) et de la page Wikipédia de macOS Golden Gate.

## 1. RevoShell

### L'AppImage (909 Mo)

Ce n'est pas un environnement de bureau. L'AppImage contient :

- un installeur Python (PySide6/QML) : `usr/lib/revo-shell-installer/main.py`, environ 1 900 lignes ;
- `payload.tar.gz` (909 Mo), une copie du dépôt GitHub : 19 shells Quickshell, la config Hyprland et des fonds d'écran.

Ce que fait l'installeur :

- il installe des paquets avec pacman, yay ou paru, donc il vise surtout Arch ;
- il déploie la config dans `~/.config/hypr`, `~/.config/quickshell`, `~/.config/rofi`, `~/.config/kitty` ;
- il remplace le chemin `/home/revo` codé en dur et répare les liens symboliques absolus.

**Problème de sécurité** : pour l'AUR, il écrit le mot de passe sudo **en clair** dans `~/.cache/revo_sudo_askpass.sh` (permissions 0700) et ne supprime jamais ce fichier.

### Architecture

Hyprland est le compositeur, Quickshell dessine l'interface en QML, Rofi sert de lanceur d'apps et Kitty de terminal. Il faut aussi des plugins Hyprland : `hyprliquid.so`, HyprGlass, Hypr3D, et un plugin `plugin-minimize` (C++) pour l'effet Génie.

### Le shell `quickshell/macos` (environ 9 000 lignes de QML)

Une bonne partie est un fork d'**eqsh**, relié par 34 liens symboliques absolus qui pointent vers `/home/revo/.config/quickshell/eqsh/...`.

| Module | Implémentation | Ce qu'on en retient |
|---|---|---|
| `LiquidGlassShader` + `glass.frag` | Profil de lentille calculé par SDF, `refract()` avec un indice de 1,5, aberration chromatique, anticrénelage RGSS, occlusion ambiante, lumière de bord, reflet, ombre portée directionnelle | Le **fond réfracté est un rectangle de couleur 4×4** : aucune vraie réfraction côté Quickshell. Le vrai verre vient de HyprGlass (preset `liquid_true` : réfraction 1,10, aberration 0,50, Fresnel 0,50, reflet 0,55, opacité 0,25). |
| `Dock.qml` (1 433 lignes) | Agrandissement linéaire par morceaux (1−d jusqu'à 0,5, puis 0,5·(1,5−d) jusqu'à 1,5), rebond ×1,22 en 90 ms puis effet rebond sur 340 ms, élévation de 12 px | Décroissance trop sèche : on prend une gaussienne dans GNOMAC. |
| `Genie.qml` + `plugin-minimize/genie.cpp` | Capture de la fenêtre découpée en 140 bandes, courbe *smootherstep*, géométrie de chaque bande interpolée vers la pointe | Bon algorithme, entièrement lié à Hyprland. |
| `TopBar.qml` (1 734 lignes) | Menus d'apps **écrits en dur** (`appMenuConfig`), détection d'enregistrement d'écran via `hyprctl clients` | Ce n'est pas un vrai menu global. |
| `DynamicIsland.qml` | Pastille MPRIS et notifications qui s'agrandit au changement de morceau | Bonne idée à reprendre. |
| `Appearance.qml` | Tokens Tahoe : fond `#1b1b1e`, accent `#315bdc`, rouge `#ff453a`, vert `#30d158`, rayons 18 et 28, barre de 24 px | Utile comme référence. |
| `animations.lua` | Ressorts `macSpring` (masse 1,1, raideur 110, amortissement 24) et `macWorkspace` (1,0 / 120 / 25) | Valeurs reprises en point de départ. |

### `ui-patches`

- **nautilus** : barre latérale façon Finder injectée via `LD_PRELOAD` (`libnautui.so`). Le README indique que **le code source est perdu** (« lived in /tmp/opencode/ »). Il ne reste qu'un binaire impossible à vérifier, à ne pas utiliser.
- **console-kgx** : même principe pour l'application Console.

### Points faibles

- Ne fonctionne qu'avec Hyprland.
- Dépôt de 2,3 Go, rempli de fichiers `.backup`, `.mod`, `.mod2`.
- Chemins absolus vers le dossier personnel de l'auteur.
- Mot de passe sudo laissé en clair sur le disque.
- Un binaire dont le code source est perdu.

## 2. Gnomintosh

C'est un script de 80 lignes : il clone WhiteSur (thème GTK, icônes, curseurs), copie un fond d'écran Monterey, charge un fichier dconf (Dash to Dock, Just Perfection) et copie SF Pro Display.

- Dernier commit en novembre 2024.
- Esthétique de Monterey.
- Règle la police à chasse fixe sur SF Pro Display, ce qui est une erreur.
- Redistribue une police Apple.
- Seul le fichier dconf de Dash to Dock peut servir de point de départ.

## 3. macOS 27 Golden Gate

Annoncé à la WWDC le 8 juin 2026, sorti le 14 septembre 2026 (27.0.1 le 28 septembre). C'est une version d'affinage de Tahoe.

Les points visuels à reproduire :

- **Boutons de fenêtre en Liquid Glass « façon d'avant Yosemite »**, donc brillants comme l'Aqua d'origine. → `theme/gtk-*/gnomac.css`
- **Curseur « gant »** sur les liens, avec un nouveau dessin.
- **Plus d'icônes dans les menus** par défaut, ce qui annule le choix de Tahoe.
- **Barres d'outils des apps façon iPadOS** et boutons animés comme sur iOS.
- Animations harmonisées du Centre de contrôle et du widget Météo.
- Le **menu contextuel du dock** affiche les processus en arrière-plan.
- Spotlight disparaît de la barre de menus au profit de Siri, seulement pour les inscrits à la liste d'attente.

Pour une fidélité au pixel près, il faut des captures d'écran de référence de macOS 27.

## 4. Correspondance avec GNOME

| macOS 27 | RevoShell | GNOMAC |
|---|---|---|
| Liquid Glass | Plugin HyprGlass | `lib/glass.js` : `Shell.GLSLEffect` + `Shell.BlurEffect` sur un clone du fond d'écran |
| Dock | `Dock.qml` | `modules/dock.js` |
| Ressorts | Courbes à ressort de Hyprland | `lib/spring.js` |
| Barre de menus | `TopBar.qml` (menus écrits en dur) | `modules/topbar.js` + Global Menu (extras) |
| Effet Génie | Plugin C++ | Magic Lamp (extras), version intégrée prévue |
| Boutons de fenêtre | Aucun | `theme/gtk-4.0/gnomac.css` |
| Spotlight, Centre de contrôle, Dynamic Island | QML | Feuille de route |
