# Animations de GNOMAC

Principe : rapides, douces, précises, **amorties**. Courbes de sortie cubique ou ressorts fortement amortis, **aucun rebond** dans les transitions système. Avec les animations coupées (mouvement réduit, ou rendu logiciel sans réglage), chaque transition applique directement son état final.

Durées de base (`lib/glassTokens.js`) : rapide 180 ms, normale 320 ms, lente 520 ms.

## Déverrouillage (`modules/lockScreen.js` + `lib/reveal.js`)

Une seule chronologie, environ 1,1 s en deux temps : le bureau sort d'un **flou** et devient net, puis **ses éléments se posent un par un**. GNOME fait glisser tout l'écran de verrouillage vers le haut ; GNOMAC le remplace par :

```
0 ms        mot de passe accepté
0–220       la zone de saisie se contracte (97 %) et s'efface
0–240       l'avatar et le nom s'effacent
40–280      l'horloge monte de 10 px et s'efface
0–520       le flou et l'assombrissement du fond d'écran diminuent (sortie cubique)
140–520     la couche de verrouillage se dissout et découvre le bureau
0–480       le fond d'écran sort d'un flou de 30 px et devient net (sortie cubique)
100–500     les fenêtres apparaissent
220–600     la barre de menus se pose (opacité, descend de 8 px)
260–680     le dock : sa plaque monte de 24 px, son verre se matérialise
320 + 38/icône   les icônes du dock montent l'une après l'autre
400 + 45/widget  les widgets montent l'un après l'autre
440 + 35/icône   les icônes du bureau montent l'une après l'autre
~1100       fin : les effets de flou temporaires sont retirés, plus rien ne bouge
```

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
- Réduction / fermeture / restauration d'une fenêtre : effet Génie (bandes), 560 ms / 460 ms.
- Compteur de notifications : apparition avec léger dépassement (320 ms, seule exception).

## Encoche (Dynamic Island)

Largeur et hauteur sur des ressorts distincts (raideur 330/300, amortissement 21/20) : une seule forme qui change, jamais cachée puis remontrée. États nommés : `collapsed`, `expanded`, `media`, `notification`, `timer`, `volume`, `system` (`DynamicIsland.state`).

**Lecteur** (carte dépliée, page Accueil) : la barre de progression **part de la gauche** et suit la musique (position relue chez le lecteur toutes les 2 s, interpolée entre-temps) ; un clic ou un glissement sur la barre **déplace la lecture** (`SetPosition`) ; lecture/pause, précédent et suivant appellent directement le lecteur par D-Bus (l'icône change tout de suite) ; quand le lecteur n'a pas de piste précédente/suivante (onglet de navigateur, podcast), les boutons **avancent/reculent de 10 s** au lieu de ne rien faire. Testé avec un lecteur MPRIS simulé : lecture/pause, suivant, précédent, déplacement dans la piste (les appels arrivent au lecteur). **NON TESTÉ** avec un vrai Spotify/Firefox.

**Chronologie commune** : les animations des surfaces, du Dock, de l'encoche et de Spotlight tournent sur **un seul métronome** (`lib/spring.js`, `getTicker()`), pas sur des dizaines de minuteries. Une classe `AnimationTimeline` dédiée (chaînage, synchronisation) n'a **pas** été créée : NON FAIT. Au changement de contenu : cascade (28 ms entre éléments, 260 ms chacun), glissement d'onglet 280 ms. Arrivée d'une notification : étirement bref (520 ms).

## Spotlight

Depuis la loupe de la barre de menus, **le verre de la loupe devient la barre** : il grandit en continu de la taille du bouton à celle de la barre (420 ms, courbe douce), le contenu apparaît à mi-course, et à la fermeture la barre se comprime jusqu'à la loupe (336 ms). Ouvert au clavier : la barre s'ouvre avec un ressort (90 % → 100 %) ; son **verre se matérialise** en 320 ms (optique qui se stabilise, flou qui diminue, échelle 97 % → 100 %), le champ et les résultats apparaissent par fondu de 140 ms. Fermeture 120 ms.

## Notifications

La bannière glisse (animation de GNOME) pendant que son verre se matérialise (360 ms, sans toucher à l'opacité que GNOME pilote).

## Espaces de travail et aperçu

Animations de GNOME conservées, habillées en verre (voir `stylesheet.css`). L'encoche affiche brièvement les points d'espaces (1,4 s).

## Démarrage de l'ordinateur et arrêt

Plymouth : logo et barre fine. Arrêt : l'écran s'assombrit en 520 ms, le logo en verre respire avec un reflet qui passe, la barre se remplit pendant la durée réglée.

## Verre : matérialiser, morpher

`materialize` (le verre se forme : optique qui se stabilise, flou qui baisse) accepte `origin`, `duration`, `intensity`, `easing`, `mode` ; `morph(from, to)` fait glisser une surface d'une forme et d'un matériau à l'autre. Détails et exemples : [liquid-glass.md](liquid-glass.md).

## Tester une animation au ralenti

Les durées ont un facteur global pour les tests : `globalThis.GNOMAC_BOOT_SPEED` (démarrage), `globalThis.GNOMAC_UNLOCK_SPEED` (déverrouillage). Exemple depuis Looking Glass (`Alt+F2`, `lg`) :

```js
globalThis.GNOMAC_UNLOCK_SPEED = 8   // 8 fois plus lent, jusqu'au prochain rechargement
```
