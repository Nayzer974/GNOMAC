# Tester GNOMAC sur une vraie machine

Tout ce qui est dit « testé » dans les autres documents l'a été dans **une machine virtuelle** (VirtualBox, rendu logiciel llvmpipe, 60 Hz, 1280 × 800). Ça valide la logique (pas d'erreur, pas de fuite, bons états finaux), **pas** la performance ni l'aspect sur un vrai GPU. Ce document dit quoi lancer sur votre CachyOS et quoi remonter.

## 1. Diagnostic (1 minute)

*Spotlight › GNOMAC Diagnostics*. Le panneau (et `~/.cache/gnomac/diagnostics.txt`) donne : version de GNOME et de GNOMAC, Wayland ou X11, **renderer** (nécessite `mesa-utils` : `sudo pacman -S mesa-utils`, sinon `N/A`), **GPU**, **fréquence de rafraîchissement réelle** (lue chez Mutter, jamais supposée), résolution, CPU, RAM, mémoire du shell, qualité du verre, groupes, régions, passes de flou, animations en cours, FPS et temps par image mesurés **pendant une animation**, mouvement réduit, mode économie d'énergie, batterie. Une valeur illisible s'affiche `N/A`.

Les durées d'animation ne dépendent pas de la fréquence : tout est en millisecondes sur l'horloge monotone (`lib/animationTimeline.js`), donc 420 ms restent 420 ms à 60 ou à 144 Hz ; seul le nombre d'images change. Les seuils du gestionnaire de qualité suivent la fréquence réelle (×2,4 à 144 Hz).

## 2. Benchmarks

* *Spotlight › Glass Benchmark* : 1, 5, 10, 20, 50 surfaces de verre, séparées puis groupées → `~/.cache/gnomac/glass-bench.json`.
* *Spotlight › Motion Benchmark* : joue les vraies animations (réduire, restaurer, Mission Control) sur **vos fenêtres ouvertes** pour 1, 5, 10, 20 fenêtres (un scénario est ignoré s'il manque des fenêtres, avec la raison) → `~/.cache/gnomac/motion-bench.json` (FPS moyen et minimal, temps par image moyen et maximal, mémoire avant/après, durée, animations simultanées, fréquence et résolution).

Ouvrez au moins 5 fenêtres (terminal, Firefox, éditeur, calculatrice, fichiers), mieux 10 à 20, avant de lancer le Motion Benchmark. Ne touchez à rien pendant la mesure. **Renvoyez les deux fichiers JSON et `diagnostics.txt`.**

Ne concluez rien de « plus rapide / plus lent » à partir des mesures de la VM : en rendu logiciel, le coût suit les pixels, pas les passes.

## 3. À vérifier à l'œil (liste)

| Test | Quoi regarder |
|---|---|
| Réduire / restaurer | pas de saut, pas de clignotement, l'icône du Dock se soulève un peu à l'arrivée |
| Réduire puis restaurer tout de suite | la fenêtre fait demi-tour là où elle est, sans téléportation |
| Maximiser puis démaximiser tout de suite | retour exact à la position et à la taille d'avant |
| Ouvrir puis fermer tout de suite | pas de fantôme |
| Changer d'espace deux fois de suite | rien ne reste à moitié transparent ou réduit |
| Spotlight depuis la loupe et retour | un seul verre, pas de flash, le focus revient |
| Île : replié → média → déplié → notification → replié | le contenu ne saute pas, la forme ne bondit pas |
| Mission Control (Spotlight) avec 2, 5, 10 fenêtres | grille, clic, Échap, retour exact |
| Verrouiller (Super+L), mot de passe, Entrée, 4 fois | la révélation, rien de bloqué |
| Lecteur : Spotify, Firefox, lecteur vidéo | pause, lecture, précédent/suivant (ou ±10 s), clic sur la barre |
| 30 minutes d'usage normal | `GNOMAC Diagnostics` : mémoire du shell stable ; journal ci-dessous |

## 4. Journal du shell et classement des CRITICAL

```bash
journalctl --user -b -o short-iso /usr/bin/gnome-shell | tools/classify-critical.py
```

Le script sépare **BENIGN SHUTDOWN** (dans les 2 dernières secondes du journal : le shell s'arrête et des objets sont détruits pendant qu'un rappel est encore en file) de **REAL BUG** (tout le reste). Les deux listes sont imprimées ; rien n'est masqué. Dans la VM, les ~100 CRITICAL « objet déjà détruit » / « appel pendant le ramasse-miettes » tombaient tous dans la dernière seconde, au moment où le test tue le shell : classés *BENIGN SHUTDOWN*. Une partie venait du ticker d'un bouton déjà détruit (`lib/motion.js`) : un drapeau `destroy` l'évite maintenant.

## 5. Écran de connexion (GDM) et Plymouth

Procédure (les deux demandent `sudo`, jamais lancée par GNOMAC) :

```bash
cd ~/.local/share/gnomac-src              # copie complète du dépôt (curl … get.sh | bash la crée)
sudo ./gdm/install-gdm.sh                 # écran de connexion ; ajouter --auto-sync pour le tenir à jour
sudo ./gdm/install-gdm.sh --check         # état, sans rien changer
sudo cp -r plymouth/gnomac /usr/share/plymouth/themes/
sudo plymouth-set-default-theme gnomac && sudo mkinitcpio -P
```

Puis **vraiment** : déconnexion → GDM → connexion ; puis redémarrage → Plymouth → GDM → bureau (Brume). **NON TESTÉ sur matériel** : seuls le code du thème et les fichiers générés ont été vérifiés. À regarder : pas d'éclair blanc entre Plymouth et GDM, ni entre GDM et le bureau. Limite connue : Plymouth, GDM et le bureau sont trois programmes ; les transitions de luminosité entre eux ne peuvent pas toutes être lissées.

## 6. GNOME 51

La VM a été mise à jour pendant ce travail vers **GNOME Shell 51 / Mutter 51**, et l'extension ne se chargeait plus : `Shell.GLSLEffect` (la base de tous les shaders) a disparu, et `St.BoxLayout` n'accepte plus `vertical`. Corrigé : `lib/shaderEffect.js` rend la même petite API au-dessus de `Clutter.OffscreenEffect` et des snippets Cogl (le natif est utilisé sur GNOME 50), et `orientation` remplace `vertical`. Constaté sous 51 en VM : l'extension se charge sans erreur, le Dock en verre, les icônes, l'encoche s'affichent. **Si vous mettez CachyOS à jour, GNOME 51 arrive : récupérez ce correctif avant** (voir « mise à jour » dans le README).

Problème ouvert sous 51 en VM : au moment de réduire une fenêtre, la boucle principale s'arrête environ 0,5 s (la prise de l'image de la fenêtre), donc l'animation n'est pas visible. Je n'ai pas pu dire si c'est le rendu logiciel ou GNOME 51 : **à vérifier sur votre GPU** (Motion Benchmark : `frameMsMax`).

## 7. Tableau de validation

| Point | État |
|---|---|
| GPU réel | ❌ non testé |
| Déverrouillage réel (Super+L, mot de passe) | ❌ non testé (4 cycles avec `deactivate()` en VM : ✅) |
| Redémarrage réel / Plymouth / GDM | ❌ non testé |
| 60 Hz | ✅ VM seulement |
| 90 / 120 / 144 Hz | ❌ non testé |
| Lecteur MPRIS réel (Spotify, Firefox) | ❌ non testé (lecteur simulé : ✅) |
| Pavé tactile | ❌ non testé (GNOMAC lit les mêmes événements que pour une souris ; toucher pour cliquer, clic droit à deux doigts et toucher-glisser sont des réglages de GNOME, voir [desktop.md](desktop.md#pavé-tactile)) |
| GNOME 50.5 | ✅ VM |
| GNOME 51 : chargement | ✅ VM (logiciel) ; animations de fenêtres : ⚠ à vérifier |
