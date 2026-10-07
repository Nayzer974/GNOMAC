# Desktop Motion System

Une seule logique de mouvement pour tout le bureau : fenêtres, Dock, encoche, Spotlight, espaces de travail, notifications. Principes : continuité spatiale (une fenêtre va **vers** une icône, elle ne disparaît pas), amortissement (aucun rebond), transformation plutôt que disparition, le matériau suit la géométrie.

## Les briques

| Fichier | Rôle |
|---|---|
| `lib/motionTokens.js` | `MotionTokens` (micro 120, short 180, medium 280, long 420, system 600 ms), courbes `Easing` (`smooth`, `easeOut`, `easeOutQuart`, `easeInOut`, `springSubtle`, `linear`), `reducedMotion()` |
| `lib/animationTimeline.js` | `timelines.run({duration, easing, onFrame, onDone, delay})` : **un seul métronome** (`getTicker()`), annulation (`run.cancel()`), chaînage (`run.then(...)`), durée 0 = état final tout de suite |
| `lib/windowMotion.js` | `WindowMotionManager` : ouverture, fermeture, réduction, restauration, agrandissement, espaces de travail |
| `lib/missionControl.js` | `calculateWindowOverviewBounds`, `enterMissionControl`, `exitMissionControl` (expérimental) |
| `modules/windowAnimations.js` | le pont avec les signaux de GNOME (inchangé dans son principe) |

`springSubtle` est un ressort **critiquement amorti** : départ vif, arrivée douce, jamais de dépassement. La seule exception au « pas de rebond » reste la pastille de notification du Dock (320 ms, léger dépassement), documentée dans `animations.md`.

## Fenêtres

```
getWindowOrigin(actor)                 rectangle de la fenêtre (son cadre)
getDockTarget(window)                  icône du Dock de son application, sinon la géométrie publiée, sinon le bas de l'écran
calculateMinimizePath(from, to, {curve, compression, fade})   la trajectoire
minimizeTo(actor, content, target)     fenêtre → icône
restoreFrom(actor, content, target)    icône → fenêtre : l'inverse exact, même chemin
closeTo(actor, content, target)        fermeture : même trajet que la réduction
launchFrom(target, actor)              ouverture : de l'icône à la fenêtre
```

**La trajectoire** (`calculateMinimizePath`) : le centre suit une courbe quadratique qui s'écarte de la ligne droite de `curve × longueur` (0,12 par défaut ; 0 = ligne droite ; réglage *Courbure du chemin* `window-path-curve`), la largeur et la hauteur diminuent à des rythmes différents (la fenêtre se « plie » vers l'icône) avec une compression supplémentaire au milieu du trajet, et l'opacité ne baisse que sur la dernière partie (`fade` 0,55) : la matière disparaît avec la géométrie. La fenêtre **arrive à la taille de l'icône**, jamais à `scale(0)` au milieu de l'écran. Mesure (une fenêtre de 600 × 420, icône à 610, 760) : centre (640, 377) → (641, 487) → (627, 649) → (610, 758), échelle 1,00 → 0,80 → 0,13 → 0,07, opacité 255 → 255 → 165 → 0.

**Ouverture** : la vraie fenêtre est transformée le long du même chemin, de l'icône jusqu'à sa place (340 ms), et son icône du Dock se soulève brièvement (`dock.pulseApp`). La fenêtre n'a pas encore peint : on ne peut pas porter d'image, on transforme l'acteur.

**Le Dock est la source** : `dock.getAppTarget(appId)` renvoie le rectangle de l'icône sur la scène à l'instant T (agrandissement compris) ; toutes les animations (`launch`, `minimize`, `restore`, `close`) le lisent. Réglage *Réduction, restauration et fermeture* : *Trajectoire vers le dock* (défaut) ou *Effet Génie* (l'ancien, conservé ; il tourne maintenant sur le même métronome).

**Agrandir / réduire la taille** (maximiser, restaurer, tuiler) : GNOME termine le changement tout de suite et `WindowMotionManager` interpole : l'ancienne image de la fenêtre passe de l'ancien rectangle au nouveau en s'estompant, la vraie fenêtre fait l'inverse et prend le relais (420 ms, courbe douce). Au retour (démaximiser) Mutter restaure **lui-même** le rectangle précédent : rien n'est recalculé. Vérifié : fenêtre 600×420 en (340, 167) → maximisée 1260×682 → restaurée en (340, 167) 600×420, identique au pixel. **Rayon des coins, ombre, flou, matériau : non animés pour les fenêtres** : elles sont dessinées par les applications (client) et par Mutter, pas par GNOMAC.

## Espaces de travail

`workspaceTransition(progress, monitorGroup)` : pendant que GNOME fait glisser les espaces, l'espace qui part recule (échelle jusqu'à 0,955, opacité jusqu'à 0,6) et celui qui arrive avance. Pas de cube, pas de rotation. Durée 320 ms, sortie quartique. Le dessin suit la propriété `progress` de GNOME : il fonctionne donc **aussi pour un geste au pavé tactile** (le même `progress` est piloté par le doigt) : **NON TESTÉ au pavé tactile** (VM), testé avec le changement d'espace programmé : échelle 1,00 → 0,955, opacité 255 → 153 sur l'espace qui part. Les valeurs de progression 0 / 0,5 / 1 sont celles du `progress` de GNOME ; démarrer un déplacement piloté « de l'extérieur » (clavier, raccourci) passe par les moyens de GNOME (activer l'espace, ou son `SwipeTracker`).

## Dynamic Island

Elle reste dessinée en Cairo. Une couche de transition la fait changer **en phases** :

```
plier :    le contenu se comprime (140 ms)  →  la forme suit  →  le matériau se retire
déplier :  la forme grandit  →  le matériau s'étend  →  le contenu apparaît (porte à 45 % de la largeur)
```

* Le contenu n'est jamais « affiché / masqué » : chaque groupe (repos, volume, notification, tableau de bord) a une **présence** de 0 à 1 qui évolue en douceur ; l'ouverture est **conditionnée** par la géométrie (le contenu arrivant ne paraît que quand la forme est presque là).
* Le matériau : un reflet doux venu du haut et un filet de bord, qui grandissent avec la carte, en retard sur la forme (rien quand elle est repliée).
* Les ressorts sont plus amortis (30/29) : plus de dépassement de 7 %.
Mesure (ouverture) : largeur 224 → 406 → 560 avec la présence du contenu 0 → 37 → 255 ; (fermeture) : présence 132 → 0 avant que la largeur ne bouge, puis 540 → 259 → 156, le contenu du repos revient à la fin.

## Notifications

La bannière se matérialise **depuis l'encoche** (point en haut au centre) au lieu de son centre. Une pile de notifications réorganisable (`notificationStack.layout()/animateTo()`) **n'est pas faite** : GNOME n'affiche qu'une bannière à la fois (file d'attente), il n'y a pas de pile à réorganiser sans réécrire la zone de messages.

## Mission Control (expérimental)

```
calculateWindowOverviewBounds(sizes, area, {gap, padding, maxScale})   la mise en page seule
enterMissionControl()  /  exitMissionControl(window?)
```

Les **vraies** fenêtres de l'espace courant rétrécissent et se rangent en grille (translation + échelle, 420 ms) ; un clic sur une fenêtre la ramène et lui donne le focus, Échap annule. Accessible par *Spotlight › Mission Control*, aucune touche n'y est liée. Limite de Mutter : la zone qui reçoit les clics d'une fenêtre ne suit pas sa transformation ; un voile transparent prend donc le pointeur et le clavier et cherche lui-même la fenêtre sous le pointeur (la plus haute d'abord). En contrepartie : pas de glisser-déposer vers un autre espace, pas de miniatures des autres espaces, pas de recherche. Testé avec deux vraies fenêtres (éditeur de texte, calculatrice) : grille, sélection, annulation, retour à l'échelle 1 exacte.

## Mouvement réduit

Avec les animations coupées (réglage de GNOME) : réduire, restaurer, ouvrir, fermer, agrandir et changer d'espace sont **instantanés** (aucune image fantôme, aucune transformation) ; GNOME applique déjà ce choix aux siennes et nos animations lui obéissent. Testé : réduire puis restaurer sans fantôme, fenêtre à l'échelle 1, opacité 255. (Le texte de la consigne s'arrêtait à ce point ; c'est l'interprétation retenue.)

## Ce qui n'est pas fait, et pourquoi

* **Ombres et focus des fenêtres** : GNOME 50 n'expose pas les ombres des fenêtres (`Meta.ShadowFactory` n'existe plus) ; elles ne sont pas réglables, et une différence actif/inactif ne peut pas être animée. Non fait.
* **Barre de menus qui réagit** aux états de Spotlight / de l'encoche / des espaces : non fait.
* **Pile de notifications** : voir plus haut.
* **Geste complet au pavé tactile pour Mission Control** : non fait ; l'API prend une progression pour les espaces de travail seulement.
* Déverrouillage : 4 cycles verrouiller / déverrouiller (le mot de passe lui-même n'est pas simulé : `deactivate()`), aucun fantôme, aucun minuteur, Dock et barre rétablis. **Saisie réelle du mot de passe : NON TESTÉ.**
* Démarrage Brume : 4 cycles (`_playBoot`), même moteur de révélation (`lib/reveal.js`, utilisé aussi par le déverrouillage ; il n'existe pas de seconde implémentation), état final identique au départ. **Démarrage réel (redémarrage) : NON TESTÉ.**
* 30 / 60 / 120 Hz : **NON TESTÉ** (la VM est à 60 Hz).

## Interruption (testé en VM, GNOME 51)

Une fenêtre n'a qu'**un** mouvement à la fois. Démarrer un nouveau mouvement annule proprement l'ancien (sa chronologie, son fantôme, la transformation laissée sur la fenêtre) et reprend **là où il en était** : réduire puis restaurer tout de suite fait faire demi-tour à la fenêtre sur son chemin (durée proportionnelle au trajet restant), une fenêtre fermée pendant son ouverture continue depuis l'endroit atteint, un deuxième agrandissement part du rectangle réellement visible. Une fenêtre détruite en plein mouvement annule le sien. Scénarios joués sans attendre la fin de chaque animation (réduire → restaurer, agrandir → démaximiser, ouvrir → fermer à 90 ms, espace → espace, enchaînement de 7 actions à 80 ms d'intervalle) : état final à chaque fois échelle 1, translation 0, opacité 255, 0 fantôme, 0 animation en cours, 0 groupe d'espace restant, rectangle identique à l'origine (340,167,600,420).

**Limite de la mesure** : le suivi image par image de la trajectoire (détection de sauts) n'a pas pu être fait : sous GNOME 51 dans la VM, la boucle principale s'arrête ≈ 0,5 s à la réduction (voir hardware-testing.md §6). Les états finaux sont vérifiés ; l'absence de saut visuel **ne l'est pas**.

## Audit : un seul système ?

Résultat honnête : **non, pas encore**. Les animations des fenêtres, de l'île, de Spotlight, du Dock (soulèvement), de Mission Control et des espaces utilisent `MotionTokens` et `AnimationTimeline` / le métronome commun. Restent, hors de ce système, des `actor.ease({duration: …})` de Clutter à durées écrites en dur (elles tournent sur l'horloge d'images de Clutter, donc indépendantes de la fréquence d'écran, mais pas des jetons) : écran de démarrage et d'arrêt (`bootShutdown.js`), écran de connexion (`loginScreen.js`), déverrouillage (`lockScreen.js`, déjà validé, laissé tel quel), widgets, icônes du bureau, Launchpad, sélecteur de fond d'écran, info-bulles du Dock, pastille de notification (rebond volontaire) et le rebond de l'île (`EASE_OUT_ELASTIC`, réglage `island-bounce`). Des `GLib.timeout_add` subsistent pour des horloges (1 s), des relectures de fichiers et des délais de rechargement : ce ne sont pas des animations. Les migrer tous est un chantier à part, non fait.

## Mouvement réduit

Comportement inchangé (instantané), conformément à la consigne de ne le modifier que si les tests le demandent : rien ne l'a demandé.
