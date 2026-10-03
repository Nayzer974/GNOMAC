# GNOMAC

Le ressenti de **macOS 27 Golden Gate** sur **GNOME 50+**, sans Hyprland.

GNOMAC est une extension GNOME Shell unique et cohérente, au lieu d'un empilement d'extensions qui se marchent dessus. Elle s'accompagne d'un thème GTK pour les boutons de fenêtre et d'un installeur propre pour CachyOS et Arch.

> Statut : **v0.1, en développement**. Écrit pour GNOME 50.5 (CachyOS) et pas encore testé au-delà.

## Ce que fait la v0.1

| Élément | Détail |
|---|---|
| **Liquid Glass** | Vraie réfraction : un shader GLSL courbe une copie floutée de ce qui est derrière (fenêtres comprises) près des bords arrondis, avec dispersion chromatique, éclairage du bord et reflet en haut. Dans RevoShell, le shader Quickshell réfracte un simple rectangle de couleur. |
| **Spotlight** | Super + Espace : barre de recherche en verre au-dessus des fenêtres. Apps (classées comme dans GNOME), calculatrice (« 12,5 × 4 »), actions système (verrouiller, suspendre, éteindre…), recherche web. Flèches, Entrée, Échap. Ouverture avec un ressort. |
| **Dock** | Flotte au-dessus du bas de l'écran. Agrandissement en courbe gaussienne qui écarte les icônes voisines, rebond au lancement (le saut en cours se termine avant l'arrêt), points sous les apps ouvertes, infobulles, menu contextuel GNOME, séparateurs, bouton Applications. |
| **Moteur de ressorts** | Un seul minuteur partagé, une physique masse-ressort stable quelle que soit la fréquence d'images. Les animations gardent leur vitesse quand on les relance en cours de route. |
| **Barre de menus** | Menu système à gauche (À propos, Réglages, App Store, Forcer à quitter, Suspendre, Redémarrer…), nom de l'app active en gras avec son menu, horloge à droite au format macOS, bouton Activités masqué. Fond transparent comme dans Golden Gate, ou Liquid Glass en option. |
| **Boutons de fenêtre** | Les « feux tricolores » brillants de Golden Gate (gel saturé, reflet en haut, symboles visibles au survol), en GTK 3 et GTK 4/libadwaita, placés à gauche. |
| **Réglages** | Fenêtre libadwaita : taille du dock, agrandissement, flou, réfraction, dispersion, teinte, raideur et amortissement des ressorts. |

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

Pour ouvrir les réglages : `gnome-extensions prefs gnomac@nayzer974.github.io`
Pour désinstaller : `./uninstall.sh`

Le script désactive Dash to Dock s'il est actif, car deux docks ne peuvent pas cohabiter.

Le Spotlight utilise Super + Espace, qui sert normalement à changer de disposition clavier. GNOMAC libère ce raccourci tant qu'il est actif et le rend quand on le désactive. `XF86Keyboard` continue de changer la disposition.

## Déboguer

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i gnomac
```

Pour tester sans se déconnecter, lance une session imbriquée (GNOME 49 et plus) :

```bash
dbus-run-session gnome-shell --devkit --wayland
```

## Feuille de route

- [ ] Glisser-déposer pour réorganiser le dock, et une corbeille
- [ ] Spotlight : recherche de fichiers et presse-papiers
- [ ] Centre de contrôle en Liquid Glass (remplace les Réglages rapides)
- [ ] Dynamic Island : musique (MPRIS) et notifications
- [ ] Effet Génie intégré, piloté par le moteur de ressorts
- [ ] Menu global intégré (DBusMenu et GMenu)
- [ ] Animations à ressort pour les fenêtres (ouverture, fermeture, maximisation)
- [ ] Liste des processus en arrière-plan dans le menu du dock (nouveauté de macOS 27)
- [ ] Curseur « gant » de Golden Gate

## Pourquoi pas RevoShell ?

L'analyse complète est dans [docs/ANALYSIS.md](docs/ANALYSIS.md). En résumé, RevoShell dépend entièrement de Hyprland et de Quickshell, et son installeur laisse le mot de passe sudo en clair sur le disque.

## Polices et éléments Apple

GNOMAC n'inclut ni la police SF Pro, ni les icônes, ni les fonds d'écran d'Apple : leur licence interdit de les redistribuer. L'installeur utilise **Inter** à la place.

## Licence

GPL-3.0-or-later, comme GNOME Shell dont l'extension dérive.
