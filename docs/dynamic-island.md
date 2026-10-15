# L'encoche de GNOMAC face à la Dynamic Island et aux apps d'encoche

Comparaison faite le 15 octobre 2026. Sources : le guide Apple des Live Activities ([Human Interface Guidelines](https://developer-rno.apple.com/design/human-interface-guidelines/components/system-experiences/live-activities), [ActivityKit](https://developer.apple.com/documentation/activitykit/creating-custom-views-for-live-activities.md)), et les fiches publiques d'[Alcove](https://alternativeto.net/software/alcove), de [NotchNook](https://alternativeto.net/software/notchnook) et de [Boring Notch](https://alternativeto.net/software/the-boring-notch). Ces fiches décrivent les apps en quelques lignes : les points précis (gestes, effets) viennent de ce qu'elles annoncent, pas d'un essai de ma part.

## Ce que fait Apple

| Notion | Dynamic Island |
|---|---|
| **Compact** | Une activité : un morceau à gauche de la caméra, un à droite, qui se lisent comme un seul objet. |
| **Minimal** | Deux activités : l'une reste collée à l'île, l'autre flotte à côté, en bulle. |
| **Étendu** | Appui long : une vue plus grande, avec des actions. |
| **Principes** | Peu de contenu, loin des bords, animations rares, jamais de publicité. |
| **Évènements** | Minuteur, musique, appel, navigation, charge, appareil Bluetooth connecté (AirPods), notifications qui sortent de l'île. |

## Ce que font les apps de Mac

- **Alcove** : activités en direct, remplacement du volume et de la luminosité, aperçus de notifications, gestes, présence sur l'écran verrouillé.
- **NotchNook** : un « nook » qui se déplie avec des raccourcis, une étagère de fichiers, un miroir de caméra.
- **Boring Notch** : lecteur de musique avec visualiseur, calendrier, étagère, batterie, miroir.

## Où en était GNOMAC, et où il en est

| | Avant | Maintenant |
|---|---|---|
| Compact : musique, minuteur, pastille de notifications | ✅ | ✅ |
| Étendu : tableau de bord à onglets, lecteur complet | ✅ | ✅ |
| Volume et luminosité dans l'encoche | ✅ | ✅ |
| Étagère de fichiers, presse-papiers, actions rapides, Pomodoro | ✅ | ✅ |
| Charge branchée / débranchée | ⚠️ seulement si « Notifications dans l'île » était activé (désactivé par défaut) | ✅ affichée par défaut |
| **Plusieurs notifications d'affilée** | ❌ la seconde remplaçait la première | ✅ elles font la queue, la carte dit « +2 », cinq au plus |
| **Toucher une notification** | ❌ un clic dépliait le tableau de bord | ✅ un clic ouvre l'app d'où elle vient et ferme la carte |
| **Batterie faible** | ❌ | ✅ à 20 % et à 10 % |
| **Appareil Bluetooth connecté** | ❌ | ✅ nom, icône de l'appareil et batterie s'il la donne |
| **Nouveau morceau** | ❌ | ✅ une carte avec la pochette, le titre et l'artiste (pas pendant une pause, pas quand le tableau de bord est ouvert) |
| **Molette** | ❌ | ✅ elle tourne les pages de la carte ouverte |
| Noms des onglets pour les lecteurs d'écran | ❌ | ✅ |
| **Onglet Prières** (désactivé par défaut) | ❌ | ✅ prière en cours et prochaine, compte à rebours, six heures, date hégirienne, notification à chaque prière |
| Deux activités côte à côte (compact + minimal) | ❌ | ❌ voir plus bas |
| Appui long pour étendre | ❌ | ❌ le survol et le clic font l'équivalent |

## Ce qui reste, et pourquoi

- **Compact à deux côtés, minimal flottant** : l'encoche replie déjà la musique à gauche et le minuteur ou les notifications non lues à droite. Une vraie bulle « minimale » détachée demande un second acteur indépendant de la forme principale ; c'est un chantier à part.
- **Écran verrouillé** (Alcove) : l'extension y est chargée, mais l'encoche n'y est pas affichée. À étudier.
- **Miroir de caméra** (NotchNook, Boring Notch) : il faudrait un flux PipeWire dans le shell ; non fait.
- **Indicateurs de micro et de caméra** à côté de l'encoche (iOS) : GNOME affiche déjà les siens dans la barre de menus, ils restent visibles.
- **Visualiseur de musique réel** : les barres suivent l'état de lecture, pas le son (le shell n'a pas accès au signal audio).

## Heures de prière

Calculées sur la machine avec les formules astronomiques usuelles (déclinaison du soleil, équation du temps, angle du soleil sous l'horizon), sans réseau ni compte. Dix méthodes (Ligue islamique mondiale, UOIF, Umm al-Qura, ISNA, Égypte, Karachi, Turquie, Algérie, Tunisie, Maroc), Asr standard ou hanafite, règle pour les hautes latitudes, ajustement en minutes de chaque prière pour coller à l'horaire d'une mosquée.

Vérification : `tools/test-prayer.mjs` compare les calculs aux horaires de l'API Aladhan pour Paris (automne et solstice d'été, où Fajr et Icha sortent de la règle de l'angle) et La Mecque. Toutes les heures concordent à la minute près, sauf Asr à Paris en octobre : la formule exacte donne 16:28 là où Aladhan affiche 16:30. `tools/test-prayer-schedule.js` vérifie ensuite la prière en cours et la suivante, le passage de minuit, le changement d'heure et les alertes (une seule fois, rien après une mise en veille).

**Choix du lieu** : dans les préférences, une recherche de ville interroge l'API de géocodage d'Open-Meteo, seulement quand tu le demandes et en n'envoyant que le texte saisi. Tu peux aussi saisir la latitude et la longitude à la main. Rien n'est envoyé tant que la fonction est désactivée.

**Limite** : le fuseau horaire est celui du système. Si tu choisis une ville dans un autre fuseau, les heures sont calculées pour sa position mais lues avec le fuseau de ta machine : les préférences le signalent.
