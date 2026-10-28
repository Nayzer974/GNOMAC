# Modifier GNOMAC : « je veux changer… »

Ce guide dit **où toucher** pour chaque type de changement. Pour comprendre le contexte : [`ARCHITECTURE.md`](../ARCHITECTURE.md). Pour la liste de tous les fichiers : [`MAP.md`](MAP.md). Pour un agent IA : [`AGENTS.md`](../AGENTS.md).

Chemins : `EXT` = `extension/gnomac@nayzer974.github.io`.

## Tableau de bord : par où commencer

| Je veux changer… | Je touche… |
|---|---|
| une **couleur**, l'arrondi, l'ombre, la taille du texte | sans code : préférences › Thème, ou `~/.config/gnomac/user.css` ([`THEMING.md`](THEMING.md)) |
| l'**allure du verre** (flou, réfraction, reflets) | `EXT/lib/glassTokens.js` |
| la **durée ou la courbe** d'une animation | `EXT/lib/motionTokens.js` ; la raideur d'un ressort : `new Spring({stiffness, damping})` dans le module |
| l'**aspect d'un élément précis** | `EXT/stylesheet.css` (la section de l'élément ; classes `gnomac-…`) |
| la **taille du dock**, son agrandissement | réglages `dock-*` (schéma) ; constantes en tête de `EXT/modules/dock.js` ; taille automatique : `EXT/lib/ui.js` |
| un **raccourci** existant | son réglage `*-shortcut` (préférences, ou `gsettings`) ; le défaut : le schéma |
| un **texte** de l'interface | `t('English', 'Français')` dans le module ; les préférences (`EXT/prefs.js`) sont en français seulement |
| l'**écran de verrouillage** | `EXT/modules/lockScreen.js` + section « Lock screen » du CSS |
| l'**écran de connexion** | `EXT/modules/loginScreen.js`, `gdm/login.css`, `gdm/login.conf` |
| les **boutons de fenêtre** (GTK) | `theme/gtk-3.0/gnomac.css`, `theme/gtk-4.0/gnomac.css` |
| le **démarrage avant la connexion** | `plymouth/gnomac/` ; le logo : `tools/make_plymouth_logo.py` |
| les **notes de version** | `EXT/whatsnew.json` (voir la recette plus bas) |

## Recettes

### Ajouter un réglage

1. **Déclarer** la clé dans `EXT/schemas/org.gnome.shell.extensions.gnomac.gschema.xml` : nom, type (`b` booléen, `i` entier, `d` décimal, `s` texte, `as` liste de textes), `<default>`, `<summary>`. Recompile : `make schemas` (l'installeur et le shell de test le font aussi).
2. **Le montrer** dans `EXT/prefs.js` : `toggle(groupe, 'ma-clé', 'Titre', 'sous-titre')`, `spin(…)`, ou une ligne `Adw.ComboRow`. Choisis le groupe (`group('Titre')`) ou ouvre-en un.
3. **Le lire** dans le module : `this._settings.get_boolean('ma-clé')` (`this._settings = extension.getSettings()`).
4. **Reconstruction** : par défaut, changer un réglage reconstruit tous les modules. Si ton module le lit **en direct** (à chaque usage, sans rien reconstruire), ajoute la clé à la liste du `connect('changed', …)` dans `EXT/extension.js`, sinon l'utilisateur verra le bureau se reconstruire à chaque cran d'un curseur.
5. `make map` (la carte se met à jour : elle liste les clés et qui les lit).

### Ajouter un module (une fonctionnalité)

1. **Le fichier** `EXT/modules/monModule.js` :

   ```js
   // Une phrase qui dit ce que fait le module (elle apparaît dans la carte).
   export class MonModule {
       constructor(extension) {
           this._extension = extension;
           this._settings = extension.getSettings();
       }

       enable() { /* construire l'interface, connecter les signaux */ }

       disable() { /* TOUT défaire : acteurs, signaux, minuteurs, raccourcis */ }
   }
   ```

2. **L'enregistrer** dans `EXT/extension.js` : `import {MonModule} from './modules/monModule.js';` et une ligne dans `MODULES` : `{key: 'enable-mon-module', Module: MonModule, keepAlive: true}`. Mets `keepAlive: true` si le module **ne dépend pas de la barre de menus de GNOME** (il reste alors construit pendant le verrouillage : déverrouillage plus rapide) ; sinon laisse-le sans.
3. **Son interrupteur** : une clé `enable-mon-module` (défaut `true`) dans le schéma + une ligne `toggle(modules, 'enable-mon-module', …)` dans les préférences (recette « Ajouter un réglage »).
4. **S'il doit être joignable** par d'autres modules : `this._extension.monModule = this;` dans `enable()` (et remets-le à `null` dans `disable()`).
5. **S'il ouvre un panneau**, donne-lui les méthodes `open()` et `close()` (ou `toggle()`) : le test automatique ouvre et ferme chaque panneau et vérifie qu'aucune prise du clavier n'est gardée.
6. **Vérifie** : `make check`, puis `make smoke` (voir « Vérifier »). Le test coupe et remet ton module : s'il laisse quelque chose, il échoue.

### Ajouter un raccourci clavier

1. Un réglage `mon-raccourci`, type `as`, défaut `['<Super><Control>x']` (schéma).
2. Dans `enable()` : `Main.wm.addKeybinding('mon-raccourci', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP, () => this.toggle());` ; dans `disable()` : `Main.wm.removeKeybinding('mon-raccourci');`.
3. **Les modes** : le raccourci ne marche que dans les modes déclarés. Si ton raccourci ouvre une fenêtre qui prend la main (`Main.pushModal`), déclare aussi `POPUP`, sinon il ne pourra pas la refermer.
4. Choisis une combinaison libre : `Super+lettre` est pris par GNOME pour plusieurs (`Super+a`, `Super+s`, `Super+v`, `Super+n`, `Super+l`, `Super+p`…).
5. Ajoute-le au guide (`EXT/lib/guide.js`) et au tableau des raccourcis du `README.md`.

### Ajouter une action à Spotlight

Dans `EXT/modules/spotlight.js`, la fonction `systemActionEntries(extension)` renvoie la liste des actions :

```js
entry(t('Mon action', 'My action'), ['mots', 'clés', 'keywords'], 'icone-symbolic', () => extension?.monModule?.open()),
```

Les mots-clés servent à la recherche (début de mot). Les actions qui dépendent de l'état (comme celles des écrans, qui n'existent qu'avec plusieurs écrans) sont construites par une fonction à part (`displayEntries`).

### Ajouter un widget de bureau

Dans `EXT/lib/widgetTypes.js` (ou `widgetExtras.js`) : écris une fonction `buildMonWidget(ctx)` qui renvoie `{actor, update?, tick?, destroy?}` (`ctx.accent` est la couleur choisie ; `tick` = toutes les N secondes `update()` est appelé). Puis ajoute dans `WIDGET_TYPES` :

```js
monWidget: {title: t('Mon widget', 'My widget'), icon: 'icone-symbolic', sizes: ['small', 'medium'], build: buildMonWidget},
```

Les tailles possibles : `small`, `medium`, `tall`, `large`, `wide`, `xxl`. Pour l'inclure dans la disposition de départ : `defaultLayout()` dans le même fichier. Les widgets d'exemple (`buildClock`, `buildBattery`) sont courts.

### Ajouter un onglet à l'encoche

C'est le plus gros changement : l'exemple complet est l'onglet **Prières** (`EXT/lib/prayerPage.js`, branché dans `EXT/modules/dynamicIsland.js`). Il faut : l'identifiant et son nom (`TAB_NAMES`), le bouton (tableau des onglets dans `Island._init`), la page (un acteur construit par ta bibliothèque), le réglage `island-tabs` qui liste les onglets visibles, et le style (section « Dynamic Island: … » du CSS). Voir [`dynamic-island.md`](dynamic-island.md).

### Ajouter ou changer une animation

- Une durée vient d'un token : `MotionTokens.short`, `.medium`, `.long`… (`lib/motionTokens.js`). Pas de durée écrite en dur dans un module.
- Un mouvement physique : `Spring` + `getTicker()` (`lib/spring.js`) : **un seul métronome** pour tout le bureau. Une animation « à temps fixe » : `AnimationTimeline` (`lib/animationTimeline.js`). Pas de rebond ni de dépassement.
- Le détail : [`motion.md`](motion.md), [`animations.md`](animations.md).

### Changer le style d'un élément

1. Trouve la classe : `style_class: 'gnomac-…'` dans le module.
2. Trouve sa règle dans `EXT/stylesheet.css` (`grep -n "gnomac-ma-classe" EXT/stylesheet.css`).
3. Pour **tester sans toucher au code** : copie la règle dans `~/.config/gnomac/user.css` ; elle s'applique dès l'enregistrement et gagne toujours.
4. Une couleur ou un arrondi qui doit suivre le **thème de l'utilisateur** : `EXT/modules/themeCustom.js` (`buildCss`) produit le CSS à partir des réglages de thème ; ajoute-y ta règle.

### Ajouter une traduction

Il n'y a pas de catalogue gettext : chaque texte est `t('English', 'Français')` (`lib/i18n.js`). Les préférences sont écrites directement en français.

### Écrire les notes de version

`EXT/whatsnew.json` est une liste ; l'entrée **la plus haute `id`** est la dernière. Format :

```json
{"id": 7, "title": ["EN title", "Titre FR"],
 "features": [["English text", "Texte français"]],
 "fixes":    [["English text", "Texte français"]]}
```

Chaque paire est `[anglais, français]`. L'utilisateur voit les entrées dont l'`id` dépasse `whatsnew-seen`, **une seule fois**, dans une fenêtre « Nouveautés » après la mise à jour. Pour compléter une version pas encore publiée, ajoute à l'entrée existante ; pour une nouvelle version, incrémente l'`id`.

### Changer l'écran de connexion

`EXT/modules/loginScreen.js` (qui tourne dans le shell de GDM) et `gdm/login.css`. L'écran de connexion lit une **copie système** de l'extension : après un changement, `sudo gdm/install-gdm.sh` la rafraîchit (ou la synchronisation automatique, si elle est installée). Voir [`THEMING.md`](THEMING.md#écran-de-connexion).

## Vérifier

```bash
make check      # statique : syntaxe, schéma, JSON, carte à jour, noms de l'API GNOME, tests purs
make smoke      # un vrai GNOME Shell sans écran, avec ton code : ouvre/ferme tout, coupe/remet chaque module
```

Variantes utiles du shell de test :

```bash
SMOKE_MONITORS='1920x1080 1280x800' tools/smoke-test.sh     # plusieurs écrans
GNOMAC_SMOKE_SHOT=/tmp/captures    tools/smoke-test.sh      # enregistre des captures d'écran
SMOKE_APPS=150                     tools/smoke-test.sh      # beaucoup d'applications (Launchpad, dock)
SMOKE_KEEP=1                       tools/smoke-test.sh      # garde le journal complet (/tmp/gnomac-smoke.log)
```

**Un test à vérifier deux fois** : lance `make check` ET `make smoke`. Le premier attrape ce qu'on peut voir sans GNOME ; le second, ce qui n'apparaît qu'à l'exécution (objet détruit, signal jamais déconnecté, raccourci mort).

### Essayer quelque chose dans un shell de test

Pour reproduire un bug ou vérifier une idée **sans te déconnecter** : écris un petit scénario et lance-le dans le shell de test.

```bash
SMOKE_DRIVER=tools/probes/shortcuts.js tools/smoke-test.sh 90
```

`tools/probe-kit.js` fournit ce qu'il faut : `keyboard()` (un clavier virtuel : les raccourcis réagissent comme avec tes doigts), `pointer()`, `openWindow()`, `shot()` (capture), `modalState()` (qui tient le clavier). `tools/probes/shortcuts.js` en est un exemple complet : copie-le. Le scénario tourne dans le shell, 8 secondes après le chargement de l'extension : tout GNOME Shell est accessible (`Main`, `global`, `St`…). Termine-le par `log('done')`.

### Lire ce que dit le shell

```bash
journalctl --user -b | grep -E "GNOMAC|JS ERROR"            # ta session
```

Lignes écrites par GNOMAC : `GNOMAC startup: …` (construction des modules), `GNOMAC boot animation: …` (fluidité de l'animation de démarrage), `GNOMAC unlock: …` (pourquoi GNOME a gardé sa propre transition). `tools/classify-critical.py` trie les erreurs d'un journal en « sans gravité à l'arrêt » et « vrai bug ».

## Publier

1. `make check` et `make smoke` passent.
2. `git commit` puis `git push` sur `main`. Sur ta machine, l'extension se met à jour avec `./install.sh --update` ; **déconnecte-toi puis reconnecte-toi** pour la charger (Wayland ne recharge pas le shell).
3. Les autres machines voient la mise à jour d'elles-mêmes : `modules/updater.js` compare le dernier commit de `main` à celui dont chaque installation est issue.
4. Si tu changes l'écran de connexion ou le démarrage (Plymouth), ces parties se mettent à jour séparément (voir le `README.md`).
