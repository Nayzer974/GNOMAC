# Animations de GNOMAC

Principe : rapides, douces, précises, **amorties**. Courbes de sortie cubique ou ressorts fortement amortis, **aucun rebond** dans les transitions système. Avec les animations coupées (mouvement réduit, ou rendu logiciel sans réglage), chaque transition applique directement son état final.

Durées de base (`lib/glassTokens.js`) : rapide 180 ms, normale 320 ms, lente 520 ms.

## Déverrouillage (`modules/lockScreen.js` + `lib/reveal.js`)

Deux temps, environ 1,4 s : l'interface de verrouillage s'en va, puis le fond d'écran **se dissout dans le bureau**, qui sort d'un **flou** et devient net pendant que **ses éléments se posent un par un**. GNOME fait glisser tout l'écran de verrouillage vers le haut ; GNOMAC le remplace par :

```
A. l'interface de verrouillage s'en va (le fond reste flou et fixe)
0 ms        mot de passe accepté
0–200       la zone de saisie se contracte (97 %) et s'efface
0–200       l'avatar et le nom s'effacent
30–230      l'horloge monte de 10 px et s'efface
230         GNOME quitte le mode verrouillé et RECONSTRUIT le bureau (dock, widgets,
            verre) : quelques centaines de ms une seule fois, sur une image fixe ;
            le bureau est masqué aussitôt, on attend une image (32 ms)
B. le fond se dissout dans le bureau (t = 0 au début de B)
0–400       le flou et l'assombrissement du fond d'écran diminuent (sortie cubique)
0–380       la couche de verrouillage se dissout et découvre le bureau
0–480       le fond d'écran sort d'un flou de 30 px et devient net (sortie cubique)
100–500     les fenêtres apparaissent
220–600     la barre de menus se pose (opacité, descend de 8 px)
260–680     le dock : sa plaque monte de 24 px, son verre se matérialise
320 + 38/icône   les icônes du dock montent l'une après l'autre
400 + 45/widget  les widgets montent l'un après l'autre
440 + 35/icône   les icônes du bureau montent l'une après l'autre
~1100       fin : les effets de flou temporaires sont retirés, plus rien ne bouge
```

Pourquoi deux temps : avant, la reconstruction du bureau avait lieu à t = 0, pendant que les animations démarraient. Elles sont calées sur l'horloge, donc quand la première image arrivait elles étaient déjà presque finies : l'écran de verrouillage semblait sauter au bureau, et seul le dock (qui démarre plus tard) s'animait. Maintenant la reconstruction est cachée entre A et B, et le module d'écran de verrouillage n'est plus coupé puis relancé à chaque verrouillage/déverrouillage (il reste, seuls dock, barre, widgets… sont construits ou retirés).

Réglable : *Préférences › Démarrage et extinction › Transition de déverrouillage*. En cas d'erreur, le chemin d'origine de GNOME prend le relais (on n'est jamais bloqué).

## Démarrage de la session, style « Brume » (`modules/bootShutdown.js`)

L'écran reste noir pendant que GNOME démarre, puis :

```
0–280       le voile apparaît : fond d'écran flou (48) et pâle, brume légère
200         la révélation du bureau démarre (la même que le déverrouillage)
200–720     le flou et l'opacité du voile diminuent ensemble ; la brume monte de 48 px
~880        le voile est retiré
```

Les styles « Hello » (logo dessiné, mots d'accueil écrits) et « Logo » utilisent la même révélation à la fin.

## Dock

- Apparition (révélation) : voir ci-dessus.
- Survol : agrandissement en courbe gaussienne (`dockMagnification`), ressort court (raideur et amortissement dans les préférences › Animations). L'icône sous le pointeur se soulève et s'éclaircit, ses voisines suivent selon la distance, et le verre gonfle de 5 px sous le pointeur en se fondant dans la plaque (un seul groupe de verre).
- Rebond de lancement : saut qui se termine avant l'arrêt.
- Réduction / fermeture / restauration d'une fenêtre : trajectoire courbe vers l'icône du Dock (420 ms, défaut) ou effet Génie (bandes, 560 ms / 460 ms) au choix ; voir [motion.md](motion.md).
- Compteur de notifications : apparition avec léger dépassement (320 ms, seule exception).

## Encoche (Dynamic Island)

Largeur et hauteur sur des ressorts distincts (raideur 330/300, amortissement 21/20) : une seule forme qui change, jamais cachée puis remontrée. États nommés : `collapsed`, `expanded`, `media`, `notification`, `timer`, `volume`, `system` (`DynamicIsland.state`).

**Lecteur** (carte dépliée, page Accueil) : la barre de progression **part de la gauche** et suit la musique (position relue chez le lecteur toutes les 2 s, interpolée entre-temps) ; un clic ou un glissement sur la barre **déplace la lecture** (`SetPosition`) ; lecture/pause, précédent et suivant appellent directement le lecteur par D-Bus (l'icône change tout de suite) ; quand le lecteur n'a pas de piste précédente/suivante (onglet de navigateur, podcast), les boutons **avancent/reculent de 10 s** au lieu de ne rien faire. Testé avec un lecteur MPRIS simulé : lecture/pause, suivant, précédent, déplacement dans la piste (les appels arrivent au lecteur). **NON TESTÉ** avec un vrai Spotify/Firefox.

**Chronologie commune** : les animations des fenêtres, de l'encoche, de Spotlight, du Dock tournent sur **un seul métronome** (`lib/spring.js`, `getTicker()`) ; `lib/animationTimeline.js` (`timelines.run`) y ajoute durée, courbe, annulation et chaînage. Voir [motion.md](motion.md) (le « Desktop Motion System »). Au changement de contenu : cascade (28 ms entre éléments, 260 ms chacun), glissement d'onglet 280 ms. Arrivée d'une notification : étirement bref (520 ms).

## Spotlight

Depuis la loupe de la barre de menus, **le verre de la loupe devient la barre** : il grandit en continu de la taille du bouton à celle de la barre (420 ms, courbe douce), le contenu apparaît à mi-course, et à la fermeture la barre se comprime jusqu'à la loupe (336 ms). Ouvert au clavier : la barre s'ouvre avec un ressort (90 % → 100 %) ; son **verre se matérialise** en 320 ms (optique qui se stabilise, flou qui diminue, échelle 97 % → 100 %), le champ et les résultats apparaissent par fondu de 140 ms. Fermeture 120 ms.

## Notifications

La bannière glisse (animation de GNOME) pendant que son verre se matérialise (360 ms, sans toucher à l'opacité que GNOME pilote).

## Espaces de travail et aperçu

Animations de GNOME, avec une profondeur (l'espace qui part recule et s'estompe un peu) et la durée des jetons de mouvement ; habillées en verre (voir `stylesheet.css`). L'encoche affiche brièvement les points d'espaces (1,4 s).

## Démarrage de l'ordinateur et arrêt

Plymouth : logo et barre fine. Arrêt : l'écran s'assombrit en 520 ms, le logo en verre respire avec un reflet qui passe, la barre se remplit pendant la durée réglée.

## Verre : matérialiser, morpher

`materialize` (le verre se forme : optique qui se stabilise, flou qui baisse) accepte `origin`, `duration`, `intensity`, `easing`, `mode` ; `morph(from, to)` fait glisser une surface d'une forme et d'un matériau à l'autre. Détails et exemples : [liquid-glass.md](liquid-glass.md).

## Tester une animation au ralenti

Les durées ont un facteur global pour les tests : `globalThis.GNOMAC_BOOT_SPEED` (démarrage), `globalThis.GNOMAC_UNLOCK_SPEED` (déverrouillage). Exemple depuis Looking Glass (`Alt+F2`, `lg`) :

```js
globalThis.GNOMAC_UNLOCK_SPEED = 8   // 8 fois plus lent, jusqu'au prochain rechargement
```

## Sélecteur de fond d'écran : la bulle (`modules/wallpaperPicker.js`)

`Entrée` sur une carte : la carte choisie grossit un peu, les autres cartes, le titre et l'aide s'effacent (140 ms), puis la carte **éclate en bulle** de verre : un disque du nouveau fond d'écran, de la taille de la carte et à sa place, grandit jusqu'à couvrir l'écran (850 ms, sortie cubique). Pendant ce temps :

* le bord de la bulle **courbe l'image** comme une lentille (avec une légère dispersion des couleurs et un filet de lumière), c'est le même effet que la lentille de démarrage (`lib/lensEffect.js`),
* la bulle projette une **ombre douce** sur l'ancien fond, qui s'efface quand elle quitte l'écran,
* le nouveau fond **se pose** : il part à 106 % et revient à 100 % (sortie quartique),
* le fond sombre du carrousel s'éclaircit (470 ms) et la carte se fond dans la bulle.

Sous les fenêtres, au-dessus de l'ancien fond. Ce qui la rend fluide : l'image est **décodée hors de la boucle principale**, déjà réduite à la taille de l'écran (avant, le décodage d'un JPEG 4K par le CSS gelait le shell) ; elle est envoyée une seule fois en texture ; la bulle est une passe de shader sur cette texture en cache (seuls le rayon, l'ombre et le zoom changent) ; le shader est retiré dès qu'elle couvre l'écran ; GNOME reçoit **un seul** changement de réglage (trois changements lui faisaient charger le fond trois fois) ; la superposition disparaît quand GNOME a fini son fondu (signal `changed` du gestionnaire de fonds), pas après un délai fixe. Sans animations (accessibilité), le fond change d'un coup.

## Démarrage « Lentille » : la bulle du fond d'écran (`modules/bootShutdown.js` + `lib/lensEffect.js`)

Après le mot de passe de connexion, un disque de verre s'ouvre au centre d'un écran noir (900 ms, sortie cubique), le fond d'écran se courbe sur son bord, puis le disque fond dans le bureau (révélation de `lib/reveal.js`, lancée à mi-course).

Ce qui la faisait ramer : le disque était une `GlassSurface` **redimensionnée à chaque image**, jusqu'à un carré de plus de 2000 px de côté, avec deux effets hors-écran (flou + shader de verre). Chaque redimensionnement réallouait leurs textures, le shader de verre (régions, gradient, anneau de flou) est bien plus lourd qu'un disque, et ~30 uniformes étaient réécrits par image. Maintenant : `LensSurface` garde la taille de l'écran, le fond est peint une seule fois dans sa texture, un petit shader dessine le disque (courbure du bord avec dispersion de couleur, filet de lumière, reflet de Fresnel ; un seul échantillon au cœur du disque) et **seul le rayon change** pendant l'ouverture. Dans la révélation, le flou du fond ne change plus que par pas de 3 px tant qu'il est large (chaque changement refait le flou de tout le fond).

## Démarrage : fin d'animation commune

Pour tous les styles, à la fin (ou si on clique pour passer), le bureau est remis à son état final d'un bloc (`settleDesktop` dans `lib/reveal.js` : barre, fenêtres, dock et ses icônes, widgets, icônes du bureau, flou temporaire retiré). Pour « Hello » et « Classique », le fond du bureau sort de son flou pendant que le cache se dissout (il devenait net d'un coup à la toute fin), et le dock, les widgets et les icônes, construits après le cache, sont cachés avant la révélation pour pouvoir arriver.
