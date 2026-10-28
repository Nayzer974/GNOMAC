# Architecture de GNOMAC

Comment le code est construit, pour comprendre avant de modifier. Trois documents vont ensemble :

| Tu veux… | Lis |
|---|---|
| comprendre **comment ça marche** | ce fichier |
| savoir **ce qui existe et où** (liste complète des modules, bibliothèques, réglages, outils) | [`docs/MAP.md`](docs/MAP.md), générée depuis le code (ou [`docs/map.json`](docs/map.json) pour un programme) |
| **changer** quelque chose, pas à pas | [`docs/MODIFY.md`](docs/MODIFY.md) |
| travailler comme **agent IA** sur le dépôt | [`AGENTS.md`](AGENTS.md) |

## En une page

GNOMAC est **une seule extension GNOME Shell** (JavaScript, modules ES, GJS), qui donne à GNOME 50+ l'allure de macOS 27 sous Wayland. Elle est découpée en **modules** : chacun est une fonctionnalité visible (dock, Spotlight, encoche, widgets, écran de verrouillage…), avec un interrupteur dans les réglages. Les modules s'appuient sur des **bibliothèques partagées** (`lib/`) : le matériau « Liquid Glass », la physique des animations, les calculs purs.

```
                        GNOME Shell 50/51  (Mutter, St, Clutter, Shell, Meta)
                                     │
                                     ▼
   extension.js  ── enable() ──►  MODULES  (liste, une ligne par module : interrupteur + drapeaux)
        │                            │
        │                            ├─ modules/dock.js, spotlight.js, dynamicIsland.js, …
        │                            │        │  chacun : constructor(extension), enable(), disable()
        │                            │        ▼
        │                            └─ lib/  glass.js (matériau)  spring.js (animations)
        │                                     reveal.js (démarrage/déverrouillage)  …
        │
        ├─ schemas/…gschema.xml  ◄──►  prefs.js   (réglages : lus par les modules, édités ici)
        ├─ stylesheet.css               (tout le CSS ; themeCustom.js y ajoute generated.css + user.css)
        └─ whatsnew.json                (notes de version, fenêtre « Nouveautés »)

   Autour de l'extension : theme/ (boutons de fenêtre GTK), plymouth/ (démarrage), gdm/ (écran de connexion),
   install.sh / uninstall.sh / scripts/ (installation, mises à jour), tools/ (tests, cartographie)
```

Règles de base :

- **Un module ne doit rien laisser derrière lui** : `disable()` détruit ses acteurs, déconnecte ses signaux et arrête ses minuteurs. Le test automatique coupe et remet chaque module et échoue s'il reste une erreur.
- **Tout ce qui est numérique et partagé vit dans des « tokens »** (`lib/glassTokens.js`, `lib/motionTokens.js`), pas dans les composants.
- **La logique pure est séparée du shell** : un fichier de `lib/` qui n'importe aucune bibliothèque GNOME se teste avec `node` (voir « Pur » dans la carte).
- **On ne recharge pas le shell à chaud** (Wayland) : pour essayer du code, on lance un shell de test sans écran (`tools/smoke-test.sh`), pas sa propre session.

## Cycle de vie

Le point d'entrée est `extension.js`. Sa liste **`MODULES`** décrit chaque module :

```js
{key: 'enable-dock', Module: Dock, keepAlive: true}
```

- **`key`** : le réglage qui active le module (plusieurs modules peuvent partager une clé, par exemple `Dock` et `Gaps`).
- **`keepAlive`** : le module ne dépend pas de la barre de menus de GNOME ; il **reste construit** pendant que l'écran est verrouillé.
- **`locked`** : il **tourne verrouillé** (seul `LockScreen` : c'est lui qui habille l'écran de verrouillage).
- **`greeter`** : il ne tourne que dans le shell de GDM, l'écran de connexion (seul `LoginScreen`).

### Les trois modes de session

GNOME Shell change de *mode* (`Main.sessionMode`) :

| Mode | Quand | Ce qui tourne |
|---|---|---|
| `user` | session normale | tous les modules dont l'interrupteur est actif |
| `unlock-dialog` | écran verrouillé | `LockScreen` + les modules `keepAlive` (leurs éléments sont **glissés sous** l'écran de verrouillage : `_sinkChrome`) ; les autres sont arrêtés |
| `gdm` | écran de connexion | seulement `LoginScreen` |

Au verrouillage, GNOME réarrange sa barre de menus : les modules qui en dépendent (`TopBar`, `AppMenus`, `MenuBarIcons`…) sont arrêtés puis reconstruits au déverrouillage. Les autres ne bougent pas, ce qui rend le déverrouillage rapide (c'était le « saccadé » d'origine : tout reconstruire à chaque fois).

### Quand tout est reconstruit

`_reload()` arrête et relance les modules quand :

- un **réglage change** (`_scheduleReload`, avec 250 ms d'attente pour ne pas reconstruire à chaque cran d'un curseur), **sauf** les clés listées dans le `connect('changed')` de `extension.js` : celles-là sont lues « en direct » par leur module (Pomodoro, heures de prière, thème, mises à jour…). Si tu ajoutes un réglage lu en direct, ajoute-le à cette liste ;
- le **mode de session change** (verrouillage, déverrouillage) ;
- le **contraste élevé** est activé ou coupé (le verre devient opaque).

Un réglage changé **pendant** le verrouillage attend le déverrouillage (`_reloadWhenUnlocked`) : reconstruire écran verrouillé arrêterait le module de l'écran de verrouillage et sa transition.

### Construction au démarrage

À l'ouverture de session les modules sont construits **par petites tranches entre deux images** (`_start(…, {sliced: true})`), tous d'un coup ils bloquaient le shell une seconde au moment où l'animation commence. Pendant que le rideau noir du démarrage est levé, les tranches sont plus longues (`_startBudget`) : rien ne bouge. `extension.whenBuilt(callback)` prévient quand tout est construit : l'animation de démarrage l'attend, pour qu'aucun module n'ajoute d'éléments pendant qu'elle joue. Le shell écrit une ligne dans le journal :

```
GNOMAC startup: 26 modules built in 513 ms, longest block 70 ms
```

## Démarrage et déverrouillage : le « rideau » et la révélation

Deux transitions partagent la même mécanique (`lib/reveal.js`) :

1. **Un rideau** couvre l'écran (noir au démarrage, le fond d'écran flouté au déverrouillage) pendant que le bureau est (re)construit dessous.
2. **Préchauffage** (`prewarmDesktop`) : le bureau est dessiné une fois en secret (opacité presque nulle) pour que les shaders et les textures soient prêts ; sinon la première image, lente, mange l'animation (elle est basée sur le temps).
3. **Révélation** (`revealDesktop`) : le fond sort du flou, puis la barre de menus, le dock, les widgets, les icônes arrivent l'un après l'autre.

Au démarrage (`modules/bootShutdown.js`), plusieurs styles : `lens` (défaut : un disque de verre s'ouvre au centre), `mist`, `hello`, `logo`, `classic`. Une ligne du journal donne l'image par image de l'animation :

```
GNOMAC boot animation: 90 frames in 1482 ms, longest wait between two 28 ms, 0 over 50 ms
```

Au déverrouillage (`modules/lockScreen.js`), `unlockTransition` remplace le glissement de GNOME. Si l'écran de verrouillage n'est pas visible à ce moment, GNOME garde sa propre transition et le journal le dit (`GNOMAC unlock: …`).

## Le moteur partagé (`lib/`)

| Besoin | Où | À savoir |
|---|---|---|
| **Liquid Glass** (le matériau) | `glass.js` (`GlassSurface`), `glassContainer.js` (plusieurs régions = un seul verre), `shaderEffect.js` (base des shaders), `glassTokens.js` | Détail dans [`docs/liquid-glass.md`](docs/liquid-glass.md). Un effet de flou **ne doit pas être modifié après sa première image** : voir les pièges dans `AGENTS.md` |
| **Adaptation au fond d'écran** | `adaptive.js` | La luminosité du fond règle le matériau ; mesure mise en cache par fond d'écran |
| **Qualité automatique** | `glassPerformance.js` | Surveille la fluidité et baisse (puis remonte) la qualité du verre |
| **Animations** | `spring.js` (UN métronome partagé : `getTicker()`), `animationTimeline.js`, `motionTokens.js`, `motion.js` | Détail dans [`docs/motion.md`](docs/motion.md) et [`docs/animations.md`](docs/animations.md). Toute durée vient d'un token ; pas de rebond |
| **Fenêtres** | `windowMotion.js` (le seul endroit qui déplace des fenêtres), `genie.js`, `missionControl.js` | Utilisés par `WindowAnimations` |
| **Bureau** | `desktopLayer.js` | Une couche plein écran où vivent icônes et widgets ; prend les clics du bureau |
| **Textes** | `i18n.js` : `t('English', 'Français')` | Deux langues, choisies d'après la langue du système. Les préférences (`prefs.js`) sont en français seulement |
| **Tailles** | `ui.js` | Tout a été dessiné pour un écran logique de 1280×800 ; l'aide met à l'échelle |
| **Calculs purs** | `displayLayout.js`, `prayerTimes.js`, `calculator.js`, `throttle.js`, `clipboardStore.js`, `svgPath.js` | Sans GNOME : testables avec `node` |

## Réglages

Le schéma `schemas/org.gnome.shell.extensions.gnomac.gschema.xml` est la **source de vérité** : chaque réglage y est déclaré (type, défaut, résumé). `prefs.js` (en GTK/libadwaita, un autre processus que le shell) permet de les changer ; les modules les lisent avec `this._settings.get_boolean('…')`. La liste complète, avec le fichier qui lit chaque clé, est dans [`docs/MAP.md`](docs/MAP.md#réglages).

## Thème et CSS

Tout le style est dans `stylesheet.css` (sections titrées par `/* ---------- Titre ---------- */`). `modules/themeCustom.js` y ajoute, **en direct** :

1. `~/.config/gnomac/generated.css`, produit à partir des réglages de thème (accent, angles, ombre, taille du texte, police, densité) ;
2. `~/.config/gnomac/user.css`, écrit par l'utilisateur : chargé **en dernier**, ses règles gagnent toujours.

Voir [`docs/THEMING.md`](docs/THEMING.md) côté utilisateur. Les classes de GNOMAC commencent par `gnomac-`.

## Raccourcis clavier

Un module déclare un raccourci par un réglage de type `as` (`spotlight-shortcut`…) et l'enregistre avec `Main.wm.addKeybinding(clé, réglages, drapeaux, modes, action)`. **Les modes comptent** : le shell ignore un raccourci dont le mode n'est pas celui du moment. Une fenêtre qui prend la main (`Main.pushModal(..., {actionMode: POPUP})`) coupe tous les raccourcis qui ne déclarent pas `POPUP`. Règle de GNOMAC : un raccourci qui ouvre une fenêtre déclare aussi `POPUP`, pour pouvoir la refermer ; les fenêtres d'information laissent passer les raccourcis (`NORMAL | POPUP`).

`Spotlight` libère `Super+Espace` de GNOME (changement de source de saisie) tant qu'il tourne, et le rend en s'arrêtant.

## Plusieurs écrans

- `lib/display.js` lit l'état des écrans auprès de Mutter (`org.gnome.Mutter.DisplayConfig`) et applique un changement (`apply`).
- `lib/displayLayout.js` (pur) calcule la disposition demandée : écran principal, placement à gauche/droite/au-dessus/en dessous, dupliquer, étendre, éteindre, un seul écran. Les changements sont **temporaires** (`method 1`) : une mauvaise disposition ne survit pas.
- `modules/displays.js` : le panneau `Super + Ctrl + D`, affiché sur **tous** les écrans à la fois.
- `modules/secondaryBars.js` : une barre de menus sur chaque écran autre que le principal.
- L'écran de verrouillage suit le pointeur d'un écran à l'autre (`followPointer` dans `lockScreen.js`).

## Écran de connexion, démarrage, installation

- **GDM** (`gdm/`) : l'écran de connexion est un autre shell GNOME (mode `gdm`) qui charge l'extension copiée dans un dossier système ; `modules/loginScreen.js` l'habille. `gdm/install-gdm.sh` installe, `gdm/sync-login.sh` garde la copie à jour.
- **Plymouth** (`plymouth/gnomac/`) : l'animation de démarrage avant la connexion.
- **Thème GTK** (`theme/`) : les boutons de fenêtre, GTK 3 et 4.
- **Installation** : `install.sh` (extension + boutons), `ez-install.sh` (tout), `get.sh` (en une ligne). `uninstall.sh` rend à GNOME ce que `scripts/state.py` avait mémorisé.
- **Mises à jour** (`modules/updater.js`, `scripts/update.sh`) : l'extension compare le dernier commit de `main` sur GitHub à celui dont la machine est issue (`~/.config/gnomac/installed.json`).

## Tests

| Quoi | Commande | Ce que ça attrape |
|---|---|---|
| Vérifications statiques | `make check` (`tools/check.sh`) | syntaxe JS/shell/Python, schéma, JSON, **carte à jour**, noms utilisés dans les bibliothèques de GNOME (a attrapé les changements d'API de GNOME 51), tests purs (`node`/`gjs`), installation dans un dossier jetable |
| Shell de test sans écran | `make smoke` (`tools/smoke-test.sh`) | lance un vrai GNOME Shell avec l'extension dans une session jetable, ouvre et ferme chaque panneau, coupe et remet chaque module, vraies fenêtres, rechargements en rafale, raccourcis clavier ; échoue s'il reste une erreur dans le journal |
| Ton propre scénario | `SMOKE_DRIVER=tools/probes/shortcuts.js tools/smoke-test.sh` | voir `tools/probe-kit.js` : clavier et pointeur virtuels, captures, fenêtres |

Le shell de test accepte `SMOKE_MONITORS='1920x1080 1280x800'` (plusieurs écrans), `GNOMAC_SMOKE_SHOT=dossier` (captures), `SMOKE_APPS=150` (beaucoup d'applications), `SMOKE_KEEP=1` (garde le journal complet). Il tourne sur le vrai GPU, sans écran.

La CI GitHub (`.github/workflows/ci.yml`) lance `tools/check.sh` (sans GNOME : pas de `gjs`, pas de contrôle des noms).

## Où aller ensuite

- Le contenu exact de chaque fichier : [`docs/MAP.md`](docs/MAP.md).
- Modifier : [`docs/MODIFY.md`](docs/MODIFY.md).
- Les sous-systèmes en détail : [`docs/liquid-glass.md`](docs/liquid-glass.md), [`docs/motion.md`](docs/motion.md), [`docs/animations.md`](docs/animations.md), [`docs/desktop.md`](docs/desktop.md), [`docs/dynamic-island.md`](docs/dynamic-island.md), [`docs/THEMING.md`](docs/THEMING.md), [`docs/hardware-testing.md`](docs/hardware-testing.md).
