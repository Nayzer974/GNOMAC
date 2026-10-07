# Liquid Glass dans GNOMAC

GNOMAC n'utilise pas un simple « fond translucide + flou ». Chaque surface de verre (barre de menus, dock, Spotlight, notifications, menus, widgets, encoche, À propos…) passe par **le même moteur**, `lib/glass.js`, avec les mêmes réglages centralisés dans `lib/glassTokens.js`.

Inspiré des principes décrits par Apple (WWDC25, *Meet Liquid Glass*) : un matériau qui courbe la lumière, s'adapte à ce qu'il y a derrière lui et se **matérialise** plutôt que de se fondre. GNOMAC n'utilise aucun code Apple : tout est réécrit pour GNOME Shell (Cogl/GLSL).

## Architecture

```
lib/glassTokens.js   tous les nombres (matière, mouvement, qualité)
lib/adaptive.js      luminosité du fond d'écran → réglages du verre
lib/glass.js         GlassEffect (shader) + GlassSurface (flou, fond, matérialisation)
lib/reveal.js        la révélation du bureau (déverrouillage, démarrage)
modules/glassDebug.js  incrustation et vues de débogage
```

### Le matériau, couche par couche

```
fond (copie du fond d'écran ou des fenêtres)
  → flou (Shell.BlurEffect, sur un conteneur à la taille de la surface)
  → réfraction : le fond est décalé le long de la normale du bord
  → aberration chromatique (très faible)
  → saturation, teinte (adaptative)
  → ombre intérieure (épaisseur)
  → bord fin (rim) + Fresnel + reflet (spéculaire) + lueur du pointeur
  → contenu
```

Le shader calcule, pour chaque pixel, la distance au contour (champ de distance signé d'un rectangle arrondi), sa normale, et un profil de lentille : **nul au centre, fort dans la bande du bord**. C'est ce qui donne la déformation subtile près des courbes et jamais d'effet loupe.

### Fresnel

`fres = (1 − profondeur)^puissance × intensité` : le bord capte plus de lumière, comme le verre sous un angle rasant. Très faible par défaut (`fresnelIntensity 0.34`, `fresnelPower 3.2`) : on ne le voit qu'en regardant de près.

### Matérialisation

Une surface qui apparaît ne fait pas `opacité 0 → 1`. `GlassSurface.materialize({duration, reverse, fade})` fait varier ensemble :

| Paramètre | Début | Fin |
|---|---|---|
| lentille (réfraction), spéculaire, Fresnel | × 2,8 (`materializeBoost 1.8`) | × 1 |
| flou | × 1,7 | × 1 |
| échelle | 97 % | 100 % |
| opacité | 0 | 255 |

Courbe : sortie cubique, **sans rebond**. Avec les animations coupées (mouvement réduit), l'état final est appliqué tout de suite.

Options (toutes facultatives, l'appel simple reste valable) :

```js
glass.materialize({
    origin: 'center',      // 'center' | 'cursor' | 'parent' | 'source' | 'explicit'
    source: actor,         // avec origin 'source' : le bouton d'où le verre sort
    point: [x, y],         // avec origin 'explicit' : un point de la scène
    duration: 320,         // ms
    intensity: 1,          // 1 = normal ; 0,5 plus discret ; 1,5 plus marqué
    easing: 'out-cubic',   // 'out-quad' | 'in-out' | 'linear'
    mode: 'form',          // 'dissolve' = l'inverse (ancien `reverse: true`)
});
```

Depuis un point (`cursor`, `source`, `explicit`, `parent`) la surface grandit un peu plus (de ≈ 92 %) autour de ce point, pour que l'origine se lise. Spotlight, ouvert depuis la loupe de la barre de menus, sort de la loupe.

### Morphing (`morph`)

`glass.morph(from, to, {duration, easing, materialTransition, onDone})` fait passer **la même surface** d'une forme et d'un matériau à un autre : `x, y, width, height, radius, opacity, blur, brightness, saturation, tint, refraction, fresnel, specular, shadow, materialization`. `from` et `to` peuvent aussi être **un acteur** (sa place à l'écran devient `x, y, width, height`) ; `from` = `null` part de l'état courant. `easing` : `'out-cubic'`, `'out-quad'`, `'in-out'`, `'smooth'`, `'linear'`. Avec `materialTransition: true`, l'optique du verre (lentille, reflet) **gonfle au milieu du trajet** puis se calme : on voit un seul matériau qui change de forme. Rien n'est caché, montré, détruit ni recréé : seules les valeurs glissent. Dans un `GlassContainer`, `morphRegion(id, to)` fait de même pour une région.

**Spotlight** s'en sert : ouvert depuis la loupe de la barre de menus, le verre part de la taille de la loupe (rayon = moitié de la plus petite dimension) et grandit **en continu** jusqu'à la barre (420 ms, courbe douce, optique qui gonfle au milieu) ; le contenu apparaît quand il y a la place. À la fermeture la barre se **comprime** jusqu'à la loupe. Ouvert au clavier, il garde la matérialisation habituelle. Mesuré (taille de la carte, en échantillons) : 21 × 21 px → 215 × 31 → 666 × 55 → 680 × 56, puis retour à 21 × 21 ; contenu invisible jusqu'à mi-course.

### Groupes de verre (`GlassContainer`)

`lib/glassContainer.js`. Un conteneur dessine jusqu'à **8 régions** comme **un seul verre** : un fond, un flou, une passe de shader (union douce, `merge` px). Les régions partagent le même fond flouté, donc **pas de double flou** là où elles se touchent, et elles fusionnent visuellement (le verre « coule » de l'une à l'autre).

```js
const group = new GlassContainer({containerId: 'dock', backdrop: 'windows', merge: 22, glass: params});
group.addRegion('plate', {x, y, width, height}, {radius: 24, zIndex: 0, materialParameters: null});
group.addRegion('lens',  {x, y, width, height}, {radius: 16, zIndex: 1});
group.getGlassGroup();      // {containerId, groupBounds, surfaces: [...], renderPasses: {backdrop: 1, blur: 1, glass: 1}}
group.getBackdropContext(); // {renderContext, blurRadius, stageOrigin, sampled: {...}}
```

Le **Dock** est un groupe : la plaque, plus une lentille qui gonfle de 5 px sous le pointeur et se fond dans la plaque. L'icône sous le pointeur se soulève et s'éclaircit légèrement ; les voisines suivent par `dockMagnification(distance)` (gaussienne, en cases d'icône). Le reflet suit le pointeur (`followPointer`).

#### Matériau par région

Chaque région garde **son propre matériau**. Le conteneur partage ce qui est commun (le fond, le flou, la lumière), le shader reçoit pour chaque pixel le matériau de la région où il se trouve, et le **mélange en douceur à la jointure** (poids décroissant avec la distance à chaque région).

```js
group.addRegion('a', rect, {radius: 40, materialParameters: {
    opacity: 0.82,                  // 0..1
    saturation: 1.05, brightness: 1.02,
    tint: [0.07, 0.07, 0.09, 0.18], // r, g, b, alpha de la teinte
    fresnelIntensity: 0.34, specularIntensity: 1, refractionIntensity: 14,
    edgeLight: 0.55,                // intensité du bord
    materializationIntensity: 1,    // amplitude de la matérialisation de cette région
}});
group.setRegionMaterial('a', {brightness: 1.2});   // changer plus tard
```

Tout paramètre omis prend la valeur du conteneur. **`blur` n'est pas par région** : le flou fait partie du fond partagé (un seul flou par groupe, c'est le but) ; il se règle sur le conteneur. Testé : trois régions rouge / bleu / à moitié opaque dans un même groupe, avec la transition de couleur à la jointure.

### Fond local

`GlassSurface.sampleBackdrop(bounds?)` renvoie, pour la zone placée derrière la surface (ou `bounds`, en pixels de scène), `{luminance, saturation, dominant, contrast}`, lus dans la miniature 32 × 32 du fond d'écran, en cache par cellule de 16 px. Avec `adaptiveLocal: true` (le Dock), le matériau reçoit une **petite correction** (± 35 % de l'opacité de teinte, ± 30 % du bord) selon que la zone est plus claire ou plus sombre que la moyenne du fond, recalculée au plus toutes les 250 ms et seulement si la surface a bougé de plus de 24 px. La moyenne de tout le fond d'écran reste la base. Les fenêtres ne sont pas prises en compte.

### Verre adaptatif

`lib/adaptive.js` mesure la luminosité moyenne du fond d'écran (miniature 32 × 32, refaite quand le fond change) et en tire `amount` (0 sombre → 1 très clair, courbe douce). Sur fond clair le verre se teinte plus sombre et un peu plus opaque, le bord ressort et le reflet se calme ; sur fond sombre il reste léger. Le passage est **continu** (pas de bascule entre deux modes). Désactivable : *Préférences › Liquid Glass › Verre adaptatif*.

### Qualité et performances

`glass-quality` : `low`, `medium`, `high` (défaut), `ultra`.

| | flou | aberration | Fresnel | réfraction |
|---|---|---|---|---|
| low | × 0,55 | 0 | 0 | × 0,6 |
| medium | × 0,8 | × 0,5 | × 0,6 | × 0,85 |
| high | × 1 | × 1 | × 1 | × 1 |
| ultra | × 1,15 | × 1,2 | × 1,2 | × 1,1 |

Principes : pas de boucle de rendu permanente (le shader ne s'anime que pendant une matérialisation ou un survol), un seul flou par surface, un seul conteneur de fond partagé par surface, mesure du fond d'écran une seule fois par changement. Le débogage montre le nombre de surfaces vivantes.

## Réglages

Dans `lib/glassTokens.js` (valeurs par défaut) et dans les préférences (verre : flou, réfraction, dispersion, lumière de bord, intensité, teinte, qualité, adaptatif, Fresnel). Chaque nombre du matériau et du mouvement est un jeton ; aucun composant n'a ses propres valeurs.

| Jeton | Rôle |
|---|---|
| `glassBlur`, `glassSaturation`, `glassBrightness` | flou, saturation du fond, luminosité |
| `refractionStrength`, `refractionRadius` | force et épaisseur de la lentille |
| `chromaticAberration` | séparation RVB sur la réfraction |
| `fresnelIntensity`, `fresnelPower` | lumière de bord |
| `specularIntensity`, `specularSharpness` | reflet |
| `rimIntensity` | liseré du contour |
| `shadowOpacity`, `shadowBlur` | ombre sous les panneaux |
| `animationFast / Normal / Slow` | 180 / 320 / 520 ms |
| `materializeBoost`, `materializeScale`, `materializeBlurBoost` | amplitude de la matérialisation |

## Débogage

- *Spotlight › Débogage Liquid Glass* (ou `glass-debug`) : incrustation en haut à droite avec la qualité, le nombre de surfaces et de groupes, les passes de flou (avec et sans regroupement), les images par seconde, l'état de l'encoche, la luminosité du fond, l'état des animations.
- *Spotlight › Groupes Liquid Glass* (ou `glass-debug-groups`) : un contour orange autour de chaque groupe, avec son identifiant, son nombre de surfaces et ses passes de rendu (3 par groupe : fond, flou, verre).
- `glass-debug-mode` (en `gsettings` ou dconf) affiche **une seule couche** du matériau sur toutes les surfaces : `1` fond, `2` vecteurs de réfraction, `3` Fresnel, `4` spéculaire, `5` bord, `6` teinte, `0` normal.

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/gnomac@nayzer974.github.io/schemas \
  set org.gnome.shell.extensions.gnomac glass-debug-mode 3
```

## Qualité adaptative (`lib/glassPerformance.js`)

`GlassPerformanceManager` écoute les images dessinées **pendant que le bureau s'anime** (un écart de plus de 100 ms entre deux images est du repos, pas de la lenteur) et décide d'un niveau, fenêtre de 1 s :

| Images/s mesurées | Niveau |
|---|---|
| ≥ 56 | ULTRA |
| ≥ 46 | HIGH |
| ≥ 36 | MEDIUM |
| en dessous | LOW |

**Hystérésis** : descendre demande deux fenêtres mauvaises de suite ; remonter demande cinq fenêtres bonnes (4 images/s au-dessus du seuil), 20 s après le dernier changement, et d'un seul niveau. Le niveau n'oscille donc pas toutes les secondes. Le réglage *Qualité* des préférences est le **plafond** : le gestionnaire ne dépasse jamais. Le **mode économie d'énergie** (profil `power-saver`, via `net.hadess.PowerProfiles`) plafonne à LOW. Le **mouvement réduit** est signalé (les animations sautent déjà à leur état final). Un plafond lié au niveau de batterie n'est **pas** implémenté.

Ce que chaque niveau change, par rapport au réglage de l'utilisateur : flou, chromatisme, Fresnel, réfraction et reflet diminuent (table `QUALITY`), et la **fréquence de relecture du fond** passe à 250 / 500 / 1000 ms (ULTRA / HIGH / MEDIUM) ou **jamais** (LOW : seule la moyenne du fond d'écran est utilisée). Chaque surface s'abonne au gestionnaire et se désabonne à sa destruction (vérifié : le nombre d'abonnés ne grandit pas après 4 cycles activer/désactiver).

### Qualité du fond (`backdropQuality`) : ce qui existe vraiment

Le fond d'une surface est, selon le cas, une copie vivante du groupe de fenêtres (Dock, Spotlight : ce sont les vrais pixels, fenêtres comprises) ou une copie du fond d'écran. Il n'y a **pas** de capture de pixels « par région » : NON IMPLÉMENTÉ. Le niveau de qualité règle uniquement la fréquence de la **lecture locale** de la luminosité (`sampleBackdrop`, fond d'écran) décrite plus haut. Un mode « ULTRA dynamique si le compositeur le permet » n'existe pas.

## Glass Inspector

*Spotlight › Glass Inspector* (réglage `glass-inspector`, **éteint par défaut**) :

```
GLASS
FPS: 60 (while animating 60, 16.7 ms)
Groups: 4
Regions: 12
Blur passes: 4 (12 ungrouped)
Backdrop: HIGH
Shader: HIGH  (setting HIGH, auto ULTRA, power ULTRA)
Blur 30  Fresnel 0.34  Refraction 14.0
Materialization: idle        (ou la progression de chaque animation en cours)
Morph: idle
Reduced motion: off
Island: collapsed   Wallpaper luminance 0.16
Memory (shell): 404 MB
```

## Benchmark intégré

*Spotlight › Glass Benchmark* mesure 1, 5, 10, 20 et 50 surfaces de 120 × 64 px, d'abord séparées puis en groupes de 8 régions, repeintes à chaque image pendant 3 s. Il écrit `~/.cache/gnomac/glass-bench.json` (images/s, temps par image, CPU du shell, mémoire, passes de flou, captures de fond, passes de shader) et envoie une notification. Il suspend le gestionnaire de qualité pendant la mesure. **Le temps GPU n'est pas mesuré** (GNOME Shell ne l'expose pas) : lancez-le sur votre machine.

Résultats dans la VM (rendu logiciel llvmpipe, 1280 × 800) :

| Surfaces | séparées : fps / CPU / Mo | groupées : fps / CPU / Mo |
|---|---|---|
| 1 | 60 / 7 % / 401 | 59,7 / 8 % / 396 |
| 5 | 60 / 19 % / 409 | 60 / 22 % / 414 |
| 10 | 60 / 45 % / 423 | 58,6 / 75 % / 441 |
| 20 | 59 / 76 % / 455 | 42,1 / 77 % / 479 |
| 50 | 26,4 / 77 % / 520 | 17,2 / 76 % / 595 |

Là encore, **regrouper n'a pas été plus rapide** en rendu logiciel (le coût suit les pixels et le nombre de régions parcourues par pixel, pas le nombre de passes), et consomme un peu plus de mémoire à 50. Le gain attendu du groupement (20 → 3 flous, moins de textures de fond) concerne un vrai GPU : **non vérifié**.

## Mesures de performance (première série)

Banc d'essai : N surfaces de 200 × 110 px, repeintes à chaque image pendant 3 s ; soit N `GlassSurface` séparées, soit des `GlassContainer` de 8 régions. VM VirtualBox, rendu **logiciel** (llvmpipe), GNOME Shell 50.5, 1280 × 800.

| N | passes de flou (séparées → groupées) | images/s séparées | images/s groupées |
|---|---|---|---|
| 1 | 1 → 1 | 59,7 | 60 |
| 5 | 5 → 1 | 58,3 | 58,9 |
| 10 | 10 → 2 | 56,4 | 42,6 |
| 20 | 20 → 3 | 30,5 | 26,6 |

Lecture honnête : le regroupement **divise les passes de flou et les textures de fond** (20 → 3), ce qui est le gain attendu sur un vrai GPU. Mais sur le rendu logiciel, où le coût est proportionnel aux pixels, il n'est **pas plus rapide** et devient un peu plus lent à partir de 10 régions (le shader parcourt les régions de chaque pixel, et le flou couvre aussi les vides entre elles). Conclusion pratique : regrouper des surfaces **voisines qui doivent fusionner** (plaque et lentille du Dock, parties de l'encoche), pas des surfaces éparpillées. Ces chiffres sont à refaire sur du vrai GPU.

Le shader n'évalue plus rien en dehors du verre (les vides d'un groupe, les coins), ce qui a fait gagner quelques images dans ce banc.

## Ce qui n'est pas (encore) fait

Soyons honnêtes sur l'écart avec le matériau d'Apple :

- **Dynamic Island** : toujours dessinée en Cairo, pas une surface de verre ; une couche de transition en phases (forme, matériau, contenu) la pilote (voir [motion.md](motion.md)), mais elle n'utilise pas `morph` ni le shader.
- **Regroupement limité** : un conteneur partage fond et flou entre **ses** régions, pas entre deux acteurs séparés (Spotlight et une bannière restent deux verres).
- **L'encoche** n'est pas une surface de verre : elle est dessinée (Cairo) et change de taille par ressorts ; ses états (`collapsed`, `expanded`, `media`, `notification`, `timer`, `volume`, `system`) sont nommés (`DynamicIsland.state`) mais elle ne fusionne pas avec un verre.
- **Luminosité locale** : lue dans le fond d'écran seul, pas la couleur du texte ni les fenêtres ouvertes derrière.
