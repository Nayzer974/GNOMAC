# Le bureau : icônes, menu, fond vidéo, centre de notifications

## Icônes du bureau

Les fichiers de votre dossier Bureau s'affichent et se manipulent comme sous Windows / macOS.

* **Clic** : sélectionne ; **Ctrl+clic** ajoute ; **glisser sur un endroit vide** trace un rectangle de sélection ; **double clic** ouvre. Un « clic » est un appui et un relâchement qui restent à moins de 8 px : les tapes du pavé tactile bougent un peu, le seuil est large.
* **Glisser** une icône (ou plusieurs) la déplace ; elle s'accroche à la grille et la position est retenue. Le glisser garde une **capture du pointeur** : l'icône continue de suivre même quand le pointeur sort d'elle, et on dépose en relâchant n'importe où. Déposer sur l'encoche garde le fichier sur l'étagère.
* **Clavier** (après un clic sur le bureau) : Entrée ouvre, F2 renomme, Suppr met à la corbeille, Ctrl+A / C / X / V, F5 actualise.
* **Clic droit sur une icône** : Ouvrir, Renommer, Couper, Copier, Copier le chemin, Garder sur l'étagère, Mettre à la corbeille. **Clic droit sur le bureau** : Nouveau dossier, Nouveau document texte, Coller, Trier par (nom, type, date, taille), Actualiser, Tout sélectionner, **Afficher les éléments du bureau** (case à cocher), Ouvrir le dossier Bureau, Ouvrir dans le terminal, Modifier l'arrière-plan, Paramètres d'affichage, Préférences de GNOMAC. (Les menus s'ouvrent au **relâchement** du bouton, comme ceux de GNOME.)

### Déposer une icône quelque part

Pendant le glisser, l'icône est dessinée **au-dessus des fenêtres** (une copie suit le pointeur) et une petite étiquette dit ce que le dépôt fera. Selon l'endroit où on relâche :

| Où | Effet |
|---|---|
| Un **dossier du bureau** (il s'allume) | le fichier est **déplacé dedans** |
| La **corbeille du dock** (elle s'allume) | le fichier est **mis à la corbeille** |
| Une **fenêtre Fichiers** | le fichier est **déplacé dans le dossier qu'elle affiche** |
| L'**encoche** | le fichier est gardé sur l'étagère |
| Ailleurs | l'icône se place sur la grille |

Un nom déjà pris dans le dossier n'est jamais écrasé : le nouveau devient « nom (1).ext ». Un dossier ne peut pas être déposé dans lui-même ; si l'opération échoue, l'icône revient à sa place avec une notification.

**Fenêtre Fichiers : comment on sait quel dossier elle affiche.** Le shell ne voit d'une autre application que le titre de sa fenêtre, et Fichiers y met le nom du dossier. GNOMAC reconnaît donc : « Dossier personnel » (le dossier personnel), « Corbeille », puis les dossiers utilisateur (Documents, Téléchargements, Images…), puis tout dossier de ce nom sous le dossier personnel (4 niveaux). Si **plusieurs** dossiers portent ce nom (deux « Projets »), l'icône revient à sa place et un menu propose les chemins. Si le titre ne correspond à rien (volume externe, résultats de recherche, « Récent »), une notification invite à copier puis **Coller**. Déposer sur la fenêtre Fichiers qui affiche le Bureau ne fait rien.

**Limite de Wayland** : le shell ne peut pas recevoir un glisser-déposer qui part d'une autre application (la fenêtre Fichiers) : l'inverse de ce qui précède, depuis Fichiers vers le bureau, n'est pas possible. Pour ajouter des fichiers : copier dans Fichiers puis **Coller** (menu du bureau ou Ctrl+V), ou **Nouveau dossier / document**.

## Fond d'écran vidéo (Hidamari)

Un fond vidéo est **une fenêtre** : elle recouvre tout ce qui est « dans le fond » de GNOME, et les icônes y étaient cachées. Les icônes et les widgets vivent maintenant sur une **couche du bureau** (`lib/desktopLayer.js`) placée juste au-dessus du fond d'écran, sous toutes les fenêtres, et **juste au-dessus d'une fenêtre de fond d'écran** (type DESKTOP, ou classe / titre contenant hidamari, wallpaper, xwinwrap, mpvpaper, komorebi…). La couche prend aussi les clics du bureau : le menu est donc le même avec ou sans fond vidéo. Testé en VM avec une fenêtre plein écran qui joue le rôle du fond (les icônes passent au-dessus) ; **pas testé avec Hidamari lui-même**. Si votre fond n'est pas reconnu par son nom, dites-moi sa classe de fenêtre.

## Étagère de l'encoche

Elle est **conservée entre les sessions**. Pour y mettre des fichiers : **Ajouter des fichiers…** (le sélecteur de fichiers du système, via le portail), **Coller des fichiers**, un « + » en fin de rangée, ou glisser une icône du bureau sur l'encoche.

## Centre de notifications

Une **cloche** dans la barre de menus (point rouge s'il y a des notifications) ouvre un panneau de verre qui glisse depuis la droite : une carte par notification (application, titre, texte, heure ; clic pour ouvrir ce dont elle parle, × pour la fermer), **Tout effacer** et **Ne pas déranger**. Échap ou un clic à côté le ferme. Même contenu que le calendrier de GNOME : rien n'est copié. Limite : il montre ce que GNOME garde ; une notification déjà fermée ou expirée n'est dans aucun historique. Aussi dans Spotlight (« Centre de notifications »).

## Recharge

Quand on branche ou débranche le chargeur, l'encoche affiche « En charge » ou « Sur batterie » avec le niveau (réglage `island-notifications`).

## Écran de connexion (GDM)

C'est le shell **de GDM**, un autre programme que votre bureau : il ne change qu'après `gdm/install-gdm.sh` (c'est pourquoi il peut rester celui de GNOME sur une vraie machine alors que la VM, où le script a été lancé, est en style GNOMAC). Depuis le bureau : *Spotlight › Installer l'écran de connexion* (le système affiche **sa** fenêtre de mot de passe, GNOMAC ne le voit jamais) ; *Spotlight › Vérifier l'écran de connexion* écrit l'état dans `~/.cache/gnomac/login-screen-check.txt`. Ensuite, se déconnecter pour le voir.

## Déverrouillage

Après le mot de passe, GNOME déverrouille par le signal `Unlock` de logind, qui appelle `deactivate(false)`. L'animation n'était déclenchée que pour `deactivate(true)` : le vrai déverrouillage l'ignorait et le bureau apparaissait d'un coup. Elle s'exécute maintenant dans les deux cas (vérifié en VM avec `deactivate(false)` : la barre et les fenêtres apparaissent par la révélation de `lib/reveal.js`).

## Mises à jour : bouton et écran « Nouveautés »

* **Bouton** dans la barre de menus (icône de mise à jour, réglage `update-button`) : un clic cherche une mise à jour tout de suite ; l'icône tourne pendant la requête et la réponse arrive en notification (« à jour », ou « Nouvelle mise à jour disponible » avec Mettre à jour / Plus tard). Un point rouge signale qu'une version plus récente existe.
* **Écran « Nouveautés de GNOMAC »** : une carte de verre qui liste les nouveautés et les corrections des versions que vous n'avez pas encore vues. Elle s'affiche **une fois**, 8 secondes après l'ouverture de la première session qui lance la nouvelle version (après une mise à jour, donc), et à la demande par *Spotlight › Nouveautés de GNOMAC*. Les notes sont le fichier `extension/gnomac@nayzer974.github.io/whatsnew.json` : **pour une nouvelle version, ajoutez une entrée avec un `id` plus grand** (nouveautés et corrections, chaque ligne en `["anglais", "français"]`). Sur une première installation, seule la dernière entrée est montrée.
* Corrigé au passage : écrire certains réglages internes (étagère, éléments du bureau, notes lues) **rechargeait toute l'extension** ; ils sont maintenant exclus du rechargement.

## Pavé tactile

GNOMAC ne gère pas le pavé tactile lui-même : le dock, les icônes, les widgets et le menu du bureau reçoivent les mêmes événements (appui, mouvement, relâchement) qu'avec une souris. Ce qui manque sur un portable tient presque toujours à trois **réglages de GNOME**, éteints par défaut sur beaucoup d'installations :

* **Toucher pour cliquer** (`tap-to-click`) : le toucher léger fait le clic ; à deux doigts, le clic droit ; à trois, le clic du milieu.
* **Toucher et glisser** (`tap-and-drag`) : toucher, reposer le doigt aussitôt et glisser. Sans lui (et sans « Toucher pour cliquer »), glisser n'est possible qu'en appuyant physiquement sur le pavé.
* **Méthode de clic** (`click-method`) : `fingers` = appuyer à deux doigts fait le clic droit ; `areas` = appuyer dans le coin inférieur droit.

`install.sh` active les deux premiers (installation neuve), et *Préférences de GNOMAC › Pavé tactile* règle tout (plus le défilement naturel et « Appui long = clic droit »). Sans passer par l'installateur :

```sh
gsettings set org.gnome.desktop.peripherals.touchpad tap-to-click true
gsettings set org.gnome.desktop.peripherals.touchpad tap-and-drag true
gsettings set org.gnome.desktop.peripherals.touchpad click-method areas   # ou fingers
```

Pour voir l'état actuel : `gsettings list-recursively org.gnome.desktop.peripherals.touchpad`. Non testé sur un vrai pavé tactile.

## Encoche (île dynamique) : lecteur multimédia et texte

* **Pendant une lecture** (musique, vidéo), la page « Accueil » est **le lecteur et rien d'autre** : plus de calendrier. À gauche la pochette (112 px, coins arrondis, ombre), à droite l'application, le titre, l'artiste, la barre de progression (clic ou glisser pour avancer), et les commandes (précédent, lecture/pause en pastille blanche, suivant). Un clic sur la pochette ramène la fenêtre du lecteur. Sans lecture : grande horloge, puces (Silence, Mode sombre, Capture, Verrouiller) et calendrier.
* **Pochettes** : Spotify et les navigateurs donnent une adresse web (ou une image encodée), pas un fichier ; `lib/coverArt.js` la télécharge une fois dans `~/.cache/gnomac/covers/` (effacée après 7 jours) et l'encoche l'affiche, y compris dans la ligne repliée. Sans pochette : l'icône du lecteur sur un dégradé.
* **Commandes** : `lib/mprisClient.js` parle directement aux lecteurs MPRIS. Il lit ce que chaque lecteur sait faire : un onglet YouTube n'a pas de piste suivante ni précédente, et ses boutons deviennent **−10 s / +10 s** (icônes de saut) au lieu de ne rien faire ; lecture/pause essaie `PlayPause`, puis `Play` ou `Pause` si le lecteur ignore le premier. S'il y a plusieurs lecteurs, l'encoche suit celui qui joue (le dernier à avoir démarré), sinon le dernier utilisé, sans sauter de l'un à l'autre.
* **Texte** : une échelle de couleurs pour tout l'encoche (blanc, 66 % pour le secondaire, 45 % pour le tertiaire), des chiffres à chasse fixe, des corps de texte plus grands (aucun sous 8 pt), des puces avec marge et **noms longs raccourcis par une ellipse** au lieu de toucher le bord (« Mode sombre », « Ne pas déranger »). La rangée de puces de l'accueil est en quatre colonnes égales.
