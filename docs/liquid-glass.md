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

- *Spotlight › Débogage Liquid Glass* (ou `glass-debug`) : incrustation en haut à droite avec la qualité, le nombre de surfaces, les images par seconde, la luminosité du fond, l'état des animations.
- `glass-debug-mode` (en `gsettings` ou dconf) affiche **une seule couche** du matériau sur toutes les surfaces : `1` fond, `2` vecteurs de réfraction, `3` Fresnel, `4` spéculaire, `5` bord, `6` teinte, `0` normal.

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/gnomac@nayzer974.github.io/schemas \
  set org.gnome.shell.extensions.gnomac glass-debug-mode 3
```

## Ce qui n'est pas (encore) fait

Soyons honnêtes sur l'écart avec le matériau d'Apple :

- **Pas de regroupement de surfaces** (`GlassContainer`) : chaque surface échantillonne son fond seule ; deux surfaces voisines ne fusionnent pas visuellement.
- **Pas de morphing de forme** entre deux surfaces (l'encoche change de taille par ressorts, pas par fusion de verres).
- **Luminosité locale** : l'adaptation utilise la luminosité *moyenne* du fond d'écran, pas celle de la zone exacte sous chaque panneau ni la couleur du texte.
- **Fond avec fenêtres** : l'adaptation ne tient pas compte des fenêtres ouvertes derrière.
