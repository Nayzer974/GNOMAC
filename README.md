# GNOMAC

Le ressenti de **macOS 27 Golden Gate** sur **GNOME 50+**, sans Hyprland.

GNOMAC est une extension GNOME Shell unique et cohérente, au lieu d'un empilement d'extensions qui se marchent dessus. Elle s'accompagne d'un thème GTK pour les boutons de fenêtre et d'un installeur propre pour CachyOS et Arch.

> Statut : **v0.1, en développement**. Écrit pour GNOME 50.5 (CachyOS) et pas encore testé au-delà.

## Ce que fait la v0.1

| Élément | Détail |
|---|---|
| **Liquid Glass** | Vraie réfraction : un shader GLSL courbe une copie floutée de ce qui est derrière (fenêtres comprises) près des bords arrondis, avec dispersion chromatique, éclairage du bord et reflet en haut. Dans RevoShell, le shader Quickshell réfracte un simple rectangle de couleur. |
| **Menus en verre et Centre de contrôle** | Tous les menus du shell (menu système, menus d'apps, menus du dock, calendrier, Réglages rapides) reçoivent un fond Liquid Glass qui suit leur animation d'ouverture. Survol en bleu accent comme sur macOS. Les Réglages rapides prennent l'allure du Centre de contrôle : tuiles en rectangles arrondis, curseurs épais. Toutes les fonctions de GNOME restent disponibles (Wi-Fi, Bluetooth, son, luminosité…). |
| **Animations des fenêtres** | Ouverture façon macOS (la fenêtre surgit à 90 % avec un fondu rapide). Réduction et restauration avec l'**effet Génie** vers l'icône du dock : l'instantané de la fenêtre est découpé en bandes, comme dans le Genie de RevoShell, ce qui fonctionne même en rendu logiciel. La fermeture garde l'animation GNOME, déjà proche de macOS. |
| **Dynamic Island** | Toujours présente en haut au centre, comme une encoche noire, avec un mini tableau de bord au survol (heure, date). Pendant la lecture : pochette, titre et égaliseur animé. Au survol ou au clic : titre, artiste, précédent/lecture/suivant. Peut aussi afficher les notifications (option). Toutes les transitions passent par des ressorts. |
| **Encoche (Dynamic Island) à la Alcove** | Collée au bord haut, avec raccords concaves. Repliée : pochette et égaliseur, heure, anneau orange du minuteur, pastille de notifications ; elle s'élargit quand elle a du contenu. Au survol : tableau de bord large avec six onglets : Accueil (lecteur ou, quand rien ne joue, grande horloge et raccourcis, avec le calendrier du mois), Système (processeur, mémoire, disque, réseau), Actions rapides (Wi-Fi, Bluetooth, Ne pas déranger, mode sombre, lumière nocturne, capture, verrouillage), Presse-papiers, Minuteur Pomodoro (concentration, pauses courtes et longue, cycles, durées réglables dans l'encoche) et Étagère (fichiers à portée). Le volume et la luminosité s'y affichent aussi, à la place de la fenêtre GNOME. |
| **Widgets du bureau (éditables)** | Dix types : horloge, batterie, calendrier, rappels, notes, météo, lecture en cours, système, minuteur Pomodoro et raccourcis d'apps. Clic droit sur le bureau › **« Modifier les widgets… »** (ou Spotlight) : les tuiles frémissent, le badge **−** retire un widget, glisser-déposer les déplace sur une grille avec accroche, la poignée change la taille (petit, moyen, grand, XXL) et la galerie de droite en ajoute. Clic droit sur un widget : matière (**clair, dépoli, teinté**), taille, ville de la météo. Le verre suit le pointeur (lueur spéculaire) et a une ombre interne douce. La disposition est enregistrée ; « Rétablir » est dans les préférences. La météo interroge [wttr.in](https://wttr.in) (sans ville : localisation par adresse IP). |
| **Barre de menus : icônes masquées** | Les icônes d'applications (AppIndicator) se replient derrière une flèche « ; un clic les déploie. |
| **Liquid Glass réglable** | Curseur d'intensité et option « teinté » comme dans les Réglages de macOS 27, appliqués à tout le verre. |
| **Démarrage et extinction** | À l'ouverture de session : écran noir, logo qui apparaît en fondu, barre de progression fine, puis zoom et fondu vers le bureau. Avant l'arrêt, le redémarrage ou la fermeture de session : l'écran s'assombrit, le logo apparaît avec « Arrêt en cours… » et une barre, puis le signal part vraiment. Les durées sont réglables. |
| **Launchpad** | Bouton Applications du dock : grille plein écran sur verre flouté, recherche, pages avec points, défilement à ressort, zoom à l'ouverture et à la fermeture. |
| **Notifications** | Bannières macOS en haut à droite sur une vraie surface de verre. Les actions et réponses de GNOME restent disponibles. |
| **Écran de verrouillage** | Date et très grande heure en haut ; avatar, nom et pilule de verre « Saisir le mot de passe » en bas. Le fond d'écran est net au repos et se floute quand le champ apparaît. L'heure reste en place, au lieu de s'envoler comme dans GNOME. L'authentification reste celle de GNOME. Pendant le verrouillage, seul ce module tourne : tous les autres sont arrêtés, puis relancés au déverrouillage. |
| **Barre latérale Finder** | Dans Fichiers, la barre latérale laisse voir un verre dépoli posé sous la fenêtre (la « vibrancy » de macOS), avec des icônes teintées accent, des lignes compactes et une sélection discrète. Le reste de la fenêtre reste opaque. Tout passe par un thème : aucun binaire injecté, contrairement au patch Nautilus de RevoShell. |
| **Symboles de la barre de menus** | À droite, comme dans macOS 27 : Wi-Fi en éventail selon la force du signal (ou `<···>` en filaire), batterie horizontale avec pourcentage (verte en charge, rouge sous 20 %), icône du Centre de contrôle. Un clic ouvre le Centre de contrôle en verre. Les icônes GNOME correspondantes sont masquées ; les indicateurs de confidentialité (caméra, micro, localisation, partage d'écran) restent visibles. |
| **Spotlight** | Super + Espace : barre de recherche en verre au-dessus des fenêtres. Apps (classées comme dans GNOME), calculatrice (« 12,5 × 4 »), actions système (verrouiller, suspendre, éteindre…), recherche web. Flèches, Entrée, Échap. Ouverture avec un ressort. |
| **Dock** | Flotte au-dessus du bas de l'écran. Agrandissement en courbe gaussienne qui écarte les icônes voisines, rebond au lancement (le saut en cours se termine avant l'arrêt), points sous les apps ouvertes, infobulles, menu contextuel GNOME, séparateurs. **Glisser-déposer** pour réorganiser (un espace s'ouvre sous l'icône) ; tirer une icône hors du dock la retire. **Pile Téléchargements** qui s'ouvre en éventail, **Corbeille** vide/pleine avec « Vider la Corbeille… » (confirmation). |
| **Moteur de ressorts** | Un seul minuteur partagé, une physique masse-ressort stable quelle que soit la fréquence d'images. Les animations gardent leur vitesse quand on les relance en cours de route. |
| **Barre de menus** | Menu système à gauche (À propos, Réglages, App Store, Forcer à quitter, Suspendre, Redémarrer…), nom de l'app active en gras avec son menu, horloge à droite au format macOS, bouton Activités masqué. Fond transparent comme dans Golden Gate, ou Liquid Glass en option. |
| **Boutons de fenêtre** | Les « feux tricolores » brillants de Golden Gate (gel saturé, reflet en haut, symboles visibles au survol), en GTK 3 et GTK 4/libadwaita, placés à gauche. |
| **Réglages** | Fenêtre libadwaita : taille du dock, agrandissement, flou, réfraction, dispersion, teinte, raideur et amortissement des ressorts. |

## Guide : raccourcis et gestes

Le même guide est dans l'interface : tape **guide** dans Spotlight (`Super + Espace`).

### Disposition des fenêtres

| Raccourci | Effet |
|---|---|
| `Super + Ctrl + ←` / `→` | Moitié gauche / droite de l'écran |
| `Super + Ctrl + ↑` / `↓` | Moitié haute / basse |
| `Super + Ctrl + Entrée` | Remplir l'écran |
| `Super + Ctrl + C` | Centrer la fenêtre |
| `Super + Ctrl + T` | Palette : moitiés, quarts, tiers, remplir, centrer |
| `Super + Ctrl + M` | Stage Manager (version simplifiée) : la fenêtre active reste au centre, les autres vont dans une bande de cartes à gauche ; un clic sur une carte la ramène |

Dans la palette, on choisit avec la souris, avec les flèches puis Entrée, ou avec un chiffre (1 à 9, 0). Échap ferme. Une ombre de verre glisse de l'ancienne position vers la nouvelle, puis la fenêtre s'y place. L'écart entre fenêtres suit le réglage « Marge autour des fenêtres ». Les raccourcis se changent dans dconf (`org.gnome.shell.extensions.gnomac`, clés `tile-*` et `layout-shortcut`).

### Le reste

| Où | Geste |
|---|---|
| Spotlight | `Super + Espace` ; `Ctrl + 1…5` change de mode ; `9+9` calcule ; `guide` ouvre ce guide |
| Bureau | Clic droit › **Modifier les widgets…** : glisser pour déplacer, poignée pour la taille, − pour retirer, galerie pour ajouter |
| Widget | Clic droit : matière (clair, dépoli, teinté), taille, ville de la météo, retirer |
| Centre de contrôle | Section **Apparence** : couleur d'accentuation, clair/sombre, Liquid Glass transparent ou teinté, style des icônes |
| Dock | Clic droit pour les options ; glisser un fichier sur une icône pour l'ouvrir avec cette app |
| Encoche | Survol : tableau de bord (accueil, système, actions, presse-papiers, minuteur, étagère) |
| Fonds d'écran | `Super + W` |
| Capture | `Impr. écran` : barre de capture façon macOS |
| Changer d'app | `Super + Tab` (sélecteur en verre) |
| Aperçu rapide | `Espace` sur un fichier dans Fichiers (installer `sushi` : `sudo pacman -S sushi`) |

## Installation (CachyOS)

```bash
git clone https://github.com/Nayzer974/GNOMAC.git
```

```bash
cd GNOMAC && ./install.sh --all
```

Déconnecte-toi puis reconnecte-toi : sous Wayland, GNOME Shell ne peut pas se recharger à chaud.

Options de `install.sh` :

- `--deps` : installe `inter-font`, `gnome-shell-extensions`, `gnome-tweaks`… via pacman. C'est sudo qui demande le mot de passe, jamais le script.
- `--extras` : installe [Compiz alike magic lamp](https://extensions.gnome.org/extension/3740/) (effet Génie) et [Global Menu for GNOME](https://extensions.gnome.org/extension/10288/) depuis extensions.gnome.org.
- `--icons` : installe le thème d'icônes [MacTahoe](https://github.com/vinceliuice/MacTahoe-icon-theme).
- `--cursors` : installe les curseurs façon macOS [WhiteSur](https://github.com/vinceliuice/WhiteSur-cursors), dont la main sur les liens.

Pour ouvrir les réglages : `gnome-extensions prefs gnomac@nayzer974.github.io`
Pour désinstaller : `./uninstall.sh`

Le script désactive Dash to Dock s'il est actif, car deux docks ne peuvent pas cohabiter.

Le Spotlight utilise Super + Espace, qui sert normalement à changer de disposition clavier. GNOMAC libère ce raccourci tant qu'il est actif et le rend quand on le désactive. `XF86Keyboard` continue de changer la disposition.

Dans une machine virtuelle sans accélération 3D, GNOME coupe les animations. GNOMAC les réactive par défaut (option « Forcer les animations »), puisque tout son intérêt est là.

## Déboguer

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i gnomac
```

Pour tester sans se déconnecter, lance une session imbriquée (GNOME 49 et plus) :

```bash
dbus-run-session gnome-shell --devkit --wayland
```

## Feuille de route

- [ ] Titres de sections (« Favoris », « Emplacements ») dans la barre latérale de Fichiers

- [ ] Spotlight : recherche de fichiers et presse-papiers
- [ ] Menu global intégré (DBusMenu et GMenu)
- [ ] Curseur « gant » de Golden Gate

## Pourquoi pas RevoShell ?

L'analyse complète est dans [docs/ANALYSIS.md](docs/ANALYSIS.md). En résumé, RevoShell dépend entièrement de Hyprland et de Quickshell, et son installeur laisse le mot de passe sudo en clair sur le disque.

## Polices et éléments Apple

GNOMAC n'inclut ni la police SF Pro, ni les icônes, ni les fonds d'écran d'Apple : leur licence interdit de les redistribuer. L'installeur utilise **Inter** à la place.

## Licence

GPL-3.0-or-later, comme GNOME Shell dont l'extension dérive.
