# Carte de GNOMAC

> **Fichier généré** par `tools/gen-map.py` à partir du code : ne le modifie pas à la main, lance `make map`.
> `tools/check.sh` échoue si cette carte n'est pas à jour. La version lisible par un programme est [`map.json`](map.json). Les descriptions viennent des commentaires d'en-tête de chaque fichier (en anglais).

Pour comprendre **comment ça marche** : [`ARCHITECTURE.md`](../ARCHITECTURE.md). Pour **modifier** quelque chose : [`docs/MODIFY.md`](MODIFY.md). Pour un agent IA : [`AGENTS.md`](../AGENTS.md).

## Sommaire

- [Points d'entrée](#points-dentrée)
- [Modules (ce que l'utilisateur voit)](#modules)
- [Bibliothèques (`lib/`)](#bibliothèques-lib)
- [Réglages](#réglages)
- [Feuille de style](#feuille-de-style)
- [Outils et tests](#outils-et-tests)
- [Installation, système, CI](#installation-système-ci)
- [Documentation](#documentation)

## Points d'entrée

| Quoi | Fichier |
|---|---|
| L'extension (cycle de vie, liste des modules) | [`extension.js`](../extension/gnomac@nayzer974.github.io/extension.js) |
| La fenêtre de préférences | [`prefs.js`](../extension/gnomac@nayzer974.github.io/prefs.js) |
| Le schéma des réglages (GSettings) | [`schemas/org.gnome.shell.extensions.gnomac.gschema.xml`](../extension/gnomac@nayzer974.github.io/schemas/org.gnome.shell.extensions.gnomac.gschema.xml) |
| Tout le CSS | [`stylesheet.css`](../extension/gnomac@nayzer974.github.io/stylesheet.css) |
| Les notes de version (fenêtre « Nouveautés ») | [`whatsnew.json`](../extension/gnomac@nayzer974.github.io/whatsnew.json) |

## Modules

Un module = une fonctionnalité visible, avec `enable()` et `disable()`, créé par `extension.js`. **Interrupteur** : le réglage GSettings qui l'active. **Reste construit pendant le verrouillage** (`keepAlive`) : il n'est pas reconstruit au déverrouillage. **Tourne verrouillé** : il fonctionne même écran verrouillé. **Atteint via** : le nom sous lequel les autres modules le trouvent (`extension.<nom>`).

| Module | Fichier | Interrupteur | Reste construit | Atteint via | Raccourcis |
|---|---|---|:-:|---|---|
| **ThemeCustom** | [`themeCustom.js`](../extension/gnomac@nayzer974.github.io/modules/themeCustom.js) | `enable-theme-custom` | ✓ |  |  |
| **Updater** | [`updater.js`](../extension/gnomac@nayzer974.github.io/modules/updater.js) | `enable-updater` |  | `extension.updater` |  |
| **GlassDebug** | [`glassDebug.js`](../extension/gnomac@nayzer974.github.io/modules/glassDebug.js) | `enable-glass-menus` | ✓ | `extension.glassDebug` |  |
| **BootShutdown** | [`bootShutdown.js`](../extension/gnomac@nayzer974.github.io/modules/bootShutdown.js) | `enable-boot-shutdown` |  |  |  |
| **LockScreen** | [`lockScreen.js`](../extension/gnomac@nayzer974.github.io/modules/lockScreen.js) | `enable-lock-screen` | tourne verrouillé |  |  |
| **LoginScreen** | [`loginScreen.js`](../extension/gnomac@nayzer974.github.io/modules/loginScreen.js) | `enable-login-screen` | écran de connexion seulement |  |  |
| **Launchpad** | [`launchpad.js`](../extension/gnomac@nayzer974.github.io/modules/launchpad.js) | `enable-launchpad` | ✓ | `extension.launchpad` |  |
| **TopBar** | [`topbar.js`](../extension/gnomac@nayzer974.github.io/modules/topbar.js) | `enable-topbar` |  |  |  |
| **AppMenus** | [`appMenus.js`](../extension/gnomac@nayzer974.github.io/modules/appMenus.js) | `enable-app-menus` |  |  |  |
| **SecondaryBars** | [`secondaryBars.js`](../extension/gnomac@nayzer974.github.io/modules/secondaryBars.js) | `enable-topbar` |  |  |  |
| **Dock** | [`dock.js`](../extension/gnomac@nayzer974.github.io/modules/dock.js) | `enable-dock` | ✓ |  |  |
| **Gaps** | [`gaps.js`](../extension/gnomac@nayzer974.github.io/modules/gaps.js) | `enable-dock` | ✓ |  |  |
| **Spotlight** | [`spotlight.js`](../extension/gnomac@nayzer974.github.io/modules/spotlight.js) | `enable-spotlight` | ✓ |  | `spotlight-shortcut` |
| **Displays** | [`displays.js`](../extension/gnomac@nayzer974.github.io/modules/displays.js) | `enable-displays` | ✓ | `extension.displays` | `displays-shortcut` |
| **GlassMenus** | [`glassMenus.js`](../extension/gnomac@nayzer974.github.io/modules/glassMenus.js) | `enable-glass-menus` | ✓ |  |  |
| **WindowAnimations** | [`windowAnimations.js`](../extension/gnomac@nayzer974.github.io/modules/windowAnimations.js) | `enable-window-animations` | ✓ | `extension.windowMotion` | `mission-control-shortcut` |
| **DynamicIsland** | [`dynamicIsland.js`](../extension/gnomac@nayzer974.github.io/modules/dynamicIsland.js) | `enable-dynamic-island` | ✓ |  |  |
| **Notifications** | [`notifications.js`](../extension/gnomac@nayzer974.github.io/modules/notifications.js) | `enable-notifications` | ✓ |  |  |
| **NotificationCenter** | [`notificationCenter.js`](../extension/gnomac@nayzer974.github.io/modules/notificationCenter.js) | `enable-notification-center` |  | `extension.notificationCenter` |  |
| **Vibrancy** | [`vibrancy.js`](../extension/gnomac@nayzer974.github.io/modules/vibrancy.js) | `enable-vibrancy` | ✓ |  |  |
| **Widgets** | [`widgets.js`](../extension/gnomac@nayzer974.github.io/modules/widgets.js) | `enable-widgets` | ✓ | `extension.widgets` |  |
| **DesktopIcons** | [`desktopIcons.js`](../extension/gnomac@nayzer974.github.io/modules/desktopIcons.js) | `enable-desktop-icons` | ✓ | `extension.desktopIcons` |  |
| **WallpaperPicker** | [`wallpaperPicker.js`](../extension/gnomac@nayzer974.github.io/modules/wallpaperPicker.js) | `enable-wallpaper-picker` | ✓ | `extension.wallpaperPicker` | `wallpaper-shortcut` |
| **MenuBarIcons** | [`menuBarIcons.js`](../extension/gnomac@nayzer974.github.io/modules/menuBarIcons.js) | `enable-menubar-icons` |  |  |  |
| **Appearance** | [`appearance.js`](../extension/gnomac@nayzer974.github.io/modules/appearance.js) | `enable-appearance` |  |  |  |
| **WindowLayout** | [`windowLayout.js`](../extension/gnomac@nayzer974.github.io/modules/windowLayout.js) | `enable-window-layout` | ✓ |  | `layout-shortcut`, `quit-shortcut` |
| **StageManager** | [`stageManager.js`](../extension/gnomac@nayzer974.github.io/modules/stageManager.js) | `enable-window-layout` | ✓ |  | `stage-manager-shortcut` |

### Ce que fait chaque module

#### ThemeCustom

Theme customisation, live.

- **Réglages lus** `theme-accent`, `theme-corners`, `theme-density`, `theme-font`, `theme-shadow`, `theme-text-scale`

#### Updater

Updates, from GitHub: every few hours (and shortly after login) the latest commit on main is compared with the one this machine was installed from.

- **Utilise** `animationTimeline.js`, `i18n.js`, `motionTokens.js`, `whatsNew.js`
- **Réglages lus** `enable-updater`, `update-button`, `update-dismissed`, `update-hours`, `update-latest`, `update-mode`, `whatsnew-seen`

#### GlassDebug

Liquid Glass debug overlay, off by default (setting glass-debug, or Spotlight "Liquid Glass debug").

- **Utilise** `adaptive.js`, `diagnostics.js`, `glass.js`, `glassContainer.js`, `glassPerformance.js`
- **Réglages lus** `glass-debug`, `glass-debug-groups`, `glass-debug-mode`, `glass-inspector`, `glass-quality`

#### BootShutdown

Start-up and shut-down animations, after macOS 26/27.

- **Utilise** `bootArt.js`, `glass.js`, `i18n.js`, `lensEffect.js`, `reveal.js`
- **Réglages lus** `boot-animation`, `boot-duration`, `boot-hello-words`, `boot-style`, `enable-shutdown-animation`, `shutdown-duration`

#### LockScreen

macOS 27 lock screen on top of GNOME's UnlockDialog (authentication, PAM, notifications and user switching stay GNOME's): - date and a very large clock at the top, never flying away, - avatar, name and a glass password pill at the bottom, - the wallpaper is crisp at rest and frosts while the prompt is up, - prompt rises with a fade instead of GNOME's zoom crossfade.

- **Utilise** `i18n.js`, `reveal.js`
- **Réglages lus** `enable-unlock-animation`

#### LoginScreen

GDM login screen, in the macOS 27 style. Runs only in GDM's own shell (session mode "gdm"), where this extension is loaded once it has been installed system-wide (see gdm/install-gdm.sh).

- **Utilise** `i18n.js`
- **Réglages lus** `login-wallpaper`

#### Launchpad

Launchpad: full-screen app grid over frosted glass, opened from the dock's Applications button (or Super+A when enabled).

- **Utilise** `glass.js`, `i18n.js`, `spring.js`

#### TopBar

macOS-style menu bar on top of the stock GNOME panel: system menu on the left, bold focused-app name with its menu, clock moved to the far right in the macOS format, Activities hidden.

- **Utilise** `about.js`, `glass.js`, `i18n.js`, `session.js`
- **Réglages lus** `glass-blur`, `logo-style`, `menu-icons`, `panel-style`

#### AppMenus

macOS menu bar menus for the focused app: File, Edit, View, (app extras such as Spotify's Playback), Window, Help.

- **Utilise** `i18n.js`, `keys.js`

#### SecondaryBars

A menu bar on every screen but the primary one, as on macOS: the focused app's name on the left, the clock on the right.

- **Utilise** `i18n.js`

#### Dock

macOS-style dock: floating Liquid Glass pane, gaussian magnification that pushes neighbours apart (like the real dock, unlike a plain scale), launch bounce, running dots, tooltips and the stock GNOME app context menu.

- **Utilise** `animationTimeline.js`, `glass.js`, `glassContainer.js`, `i18n.js`, `motionTokens.js`, `spring.js`, `ui.js`
- **Réglages lus** `dock-badges`, `dock-click-minimize`, `dock-icon-style`, `dock-magnification`, `dock-max-scale`, `dock-reserve-space`, `dock-show-running`, `glass-adaptive`, `glass-blur`, `spring-damping`, `spring-stiffness`, `window-gap`

#### Gaps

Breathing room around maximized windows, like RevoShell's Hyprland gaps: thin invisible struts on the left, right and top edges keep maximized windows off the screen sides and away from the menu bar (the dock already reserves the bottom, plus the same gap above it).

- **Réglages lus** `window-gap`

#### Spotlight

Spotlight (Super+Space): a floating Liquid Glass search bar above the windows.

- **Utilise** `benchControl.js`, `calculator.js`, `clipboardHistory.js`, `diagnostics.js`, `display.js`, `displayLayout.js`, `gdmInstall.js`, `glass.js`, `glassBench.js`, `guide.js`, `i18n.js`, `keys.js`, `missionControl.js`, `motionBench.js`, `session.js`, `spring.js`
- **Réglages lus** `glass-blur`, `glass-refraction`, `spotlight-shortcut`

#### Displays

Displays (Super + Ctrl + D): a small panel to manage several displays — which one is the main display, on which side of it each other one sits (left, right, above, below), turn one off or on, mirror, extend, or keep only one.

- **Utilise** `display.js`, `displayLayout.js`, `i18n.js`
- **Réglages lus** `displays-shortcut`

#### GlassMenus

Liquid Glass for every shell menu: quick settings (restyled as a macOS Control Center), the calendar, app menus, dock menus, the system menu.

- **Utilise** `glass.js`, `spring.js`
- **Réglages lus** `glass-blur`, `glass-refraction`

#### WindowAnimations

macOS window animations: open from the dock icon, close, minimize and restore into the dock icon (a curved path, or the Genie effect), maximise.

- **Utilise** `animationTimeline.js`, `genie.js`, `missionControl.js`, `motionTokens.js`, `windowMotion.js`
- **Réglages lus** `close-animation`, `minimize-effect`, `mission-control-shortcut`, `open-animation`

#### DynamicIsland

Dynamic Island, modelled on RevoShell's: not a floating pill but a notch hanging from the top edge of the screen, flat against it, with concave "ears" blending into the edge and rounded bottom corners.

- **Utilise** `clipboardHistory.js`, `coverArt.js`, `i18n.js`, `motion.js`, `mprisClient.js`, `notchPages.js`, `notchViews.js`, `notificationOpen.js`, `prayerPage.js`, `prayerSchedule.js`, `prayerTimes.js`, `spring.js`
- **Réglages lus** `island-autoclose-seconds`, `island-bounce`, `island-cascade`, `island-clock-24h`, `island-close-delay`, `island-default-tab`, `island-hide-fullscreen`, `island-hover-delay`, `island-hud`, `island-hud-seconds`, `island-live-events`, `island-notice-seconds`, `island-notifications`, `island-open-trigger`, `island-remember-tab`, `island-rest-style`, `island-scale`, `island-shelf`, `island-show-badge`, `island-show-clock`, `island-show-media`, `island-show-timer-ring`, `island-tabs`, `prayer-enabled`

#### Notifications

macOS notification banners: top-right corner, rounded Liquid Glass card that slides in under the menu bar.

- **Utilise** `glass.js`, `notificationOpen.js`
- **Réglages lus** `glass-blur`

#### NotificationCenter

Notification Center: every notification GNOME is holding, in one glass panel that slides in from the right edge (macOS style).

- **Utilise** `animationTimeline.js`, `glass.js`, `i18n.js`, `motionTokens.js`, `notificationOpen.js`
- **Réglages lus** `glass-blur`

#### Vibrancy

macOS "vibrancy" behind app sidebars: a frosted copy of the wallpaper is placed inside the window actor, under the app's own surface.

- **Utilise** `glass.js`
- **Réglages lus** `glass-blur`

#### Widgets

Desktop widgets (macOS 27): glass tiles on the wallpaper, under every window, that the user can add, remove, move, resize, colour and restyle.

- **Utilise** `desktopLayer.js`, `glass.js`, `i18n.js`, `motion.js`, `spring.js`, `ui.js`, `widgetTypes.js`
- **Réglages lus** `widgets-anchor`, `widgets-layout`, `widgets-margin`, `widgets-scale`, `window-gap`

#### DesktopIcons

Icons on the desktop: the files and folders of your Desktop folder, shown on the wallpaper and usable like on Windows / macOS: - click selects (Ctrl+click adds, drag on an empty spot draws a selection rectangle), double-click opens, - drag an icon (or several) to move it; it snaps to a grid and is remembered; drop it on the notch to keep it on the shelf, - keys: Enter open, F2 rename, Delete trash, Ctrl+A / C / X /…

- **Utilise** `desktopLayer.js`, `i18n.js`, `ui.js`
- **Réglages lus** `desktop-icons-layout`, `desktop-icons-side`, `desktop-icons-size`, `desktop-icons-visible`

#### WallpaperPicker

Wallpaper picker (RevoShell's coverflow): Super+W opens a dark full-screen carousel of wallpapers fanned out in 3D; arrows or the wheel move it on a spring, Enter applies.

- **Utilise** `i18n.js`, `lensEffect.js`, `motionTokens.js`, `spring.js`
- **Réglages lus** `wallpaper-shortcut`

#### MenuBarIcons

macOS 27 status items on the right of the menu bar: Wi-Fi fan (or the Ethernet "<···>" glyph), a horizontal battery with its percentage, and the Control Center symbol.

- **Réglages lus** `menubar-hide-extras`

#### Appearance

"Appearance" section of the Control Center, as in the macOS 27 Appearance settings: accent colour, light/dark/auto, Liquid Glass clear/tinted and the icon & widget style, all one click away from the menu bar.

- **Utilise** `i18n.js`, `motion.js`
- **Réglages lus** `dock-icon-style`, `glass-tinted`

#### WindowLayout

Window tiling, as in macOS Sequoia/Golden Gate: halves, quarters, thirds, fill and centre.

- **Utilise** `i18n.js`, `motion.js`
- **Réglages lus** `layout-shortcut`, `quit-shortcut`, `tile-bottom`, `tile-center`, `tile-fill`, `tile-left`, `tile-right`, `tile-top`, `window-gap`

#### StageManager

Stage Manager, as a simplified version of macOS's: the window you work in stays on stage, every other window of the workspace steps aside into a strip of cards on the left.

- **Utilise** `i18n.js`, `motion.js`
- **Réglages lus** `enable-stage-manager`, `stage-manager-shortcut`

## Bibliothèques (`lib/`)

Code partagé. **Pur** = n'utilise aucune bibliothèque GNOME : il se teste avec `node`, hors du shell. **Utilisé par** : les fichiers qui l'importent.

| Fichier | Pur | Rôle | Utilisé par |
|---|:-:|---|---|
| [`about.js`](../extension/gnomac@nayzer974.github.io/lib/about.js) |  | "About This Mac", after macOS 26/27: a glass card with a drawn machine, its model and name, three tabs (Overview, Displays, Storage) and the buttons More Info… (GNOME's… | `topbar.js` |
| [`adaptive.js`](../extension/gnomac@nayzer974.github.io/lib/adaptive.js) |  | Adaptive glass: the wallpaper's brightness steers the material. | `extension.js`, `glass.js`, `glassDebug.js` |
| [`animationTimeline.js`](../extension/gnomac@nayzer974.github.io/lib/animationTimeline.js) |  | AnimationTimeline: every time-based animation of the desktop motion system runs on the ONE metronome of the extension (lib/spring.js getTicker()), not on a timer or… | `diagnostics.js`, `missionControl.js`, `motionBench.js`, `whatsNew.js`, `windowMotion.js`, `dock.js` … |
| [`benchControl.js`](../extension/gnomac@nayzer974.github.io/lib/benchControl.js) |  | Timers for the benchmarks (Spotlight: "Glass Benchmark", "Motion Benchmark") that can all be stopped at once. | `glassBench.js`, `motionBench.js`, `spotlight.js` |
| [`bootArt.js`](../extension/gnomac@nayzer974.github.io/lib/bootArt.js) |  | The drawings of the start-up animation, as in macOS 26/27 "Hello": - the logo is traced with a line, then fills with glass and a sheen sweeps across it, - greeting words… | `bootShutdown.js` |
| [`calculator.js`](../extension/gnomac@nayzer974.github.io/lib/calculator.js) | ✓ | Tiny arithmetic evaluator for Spotlight. Never uses eval(): a recursive descent parser over + - * / % ^ and parentheses, accepting × ÷ and a decimal comma so "12,5 × 4"… | `spotlight.js` |
| [`clipboardHistory.js`](../extension/gnomac@nayzer974.github.io/lib/clipboardHistory.js) |  | Clipboard history shared by Spotlight (Clipboard mode) and the Dynamic Island. | `extension.js`, `notchPages.js`, `dynamicIsland.js`, `spotlight.js` |
| [`clipboardStore.js`](../extension/gnomac@nayzer974.github.io/lib/clipboardStore.js) | ✓ | The clipboard history as plain data, with no link to the shell: it is shared by Spotlight and the Dynamic Island (lib/clipboardHistory.js feeds it), and it only exists… | `clipboardHistory.js` |
| [`coverArt.js`](../extension/gnomac@nayzer974.github.io/lib/coverArt.js) |  | Album covers for the Dynamic Island. | `dynamicIsland.js` |
| [`desktopLayer.js`](../extension/gnomac@nayzer974.github.io/lib/desktopLayer.js) |  | The desktop layer: one transparent, full-screen layer that desktop icons and widgets live on, and that takes the desktop's own clicks (so the right-click menu is ours,… | `diagnostics.js`, `desktopIcons.js`, `widgets.js` |
| [`diagnostics.js`](../extension/gnomac@nayzer974.github.io/lib/diagnostics.js) |  | GNOMAC Diagnostics (Spotlight > "GNOMAC Diagnostics"): what this machine and this shell really are, in one panel, also saved to ~/.cache/gnomac/diagnostics.txt so it can… | `motionBench.js`, `glassDebug.js`, `spotlight.js` |
| [`display.js`](../extension/gnomac@nayzer974.github.io/lib/display.js) |  | What the screen really is: resolution and refresh rate of each monitor, read from Mutter's DisplayConfig service (the same source as GNOME Settings). | `extension.js`, `diagnostics.js`, `motionBench.js`, `displays.js`, `spotlight.js` |
| [`displayLayout.js`](../extension/gnomac@nayzer974.github.io/lib/displayLayout.js) | ✓ | Multi-monitor layouts: from what Mutter's DisplayConfig service reports to what it is asked to apply. | `display.js`, `displays.js`, `spotlight.js` |
| [`filePicker.js`](../extension/gnomac@nayzer974.github.io/lib/filePicker.js) |  | Choose files from inside the shell, through the desktop portal (org.freedesktop.portal.FileChooser), the same dialog every app uses. | `notchViews.js` |
| [`gdmInstall.js`](../extension/gnomac@nayzer974.github.io/lib/gdmInstall.js) |  | Install (or check) GNOMAC's login screen from inside the desktop: Spotlight > "Install the Login Screen". | `spotlight.js` |
| [`genie.js`](../extension/gnomac@nayzer974.github.io/lib/genie.js) |  | macOS Genie: the window is sucked into its dock icon through a narrowing funnel. | `windowAnimations.js` |
| [`glass.js`](../extension/gnomac@nayzer974.github.io/lib/glass.js) |  | Liquid Glass material. | `about.js`, `glassBench.js`, `glassContainer.js`, `whatsNew.js`, `bootShutdown.js`, `dock.js` … |
| [`glassBench.js`](../extension/gnomac@nayzer974.github.io/lib/glassBench.js) |  | Glass benchmark: N surfaces (1, 5, 10, 20, 50), once as separate GlassSurface and once as GlassContainer groups of 8 regions, repainted on every frame for 3 s each. | `spotlight.js` |
| [`glassContainer.js`](../extension/gnomac@nayzer974.github.io/lib/glassContainer.js) |  | GlassContainer: several glass regions drawn as ONE piece of glass. | `diagnostics.js`, `glassBench.js`, `dock.js`, `glassDebug.js` |
| [`glassPerformance.js`](../extension/gnomac@nayzer974.github.io/lib/glassPerformance.js) |  | GlassPerformanceManager: watches the frame rate while the desktop is animating and lowers (then, carefully, raises) the quality of the glass. | `extension.js`, `diagnostics.js`, `glass.js`, `glassBench.js`, `motionBench.js`, `glassDebug.js` |
| [`glassTokens.js`](../extension/gnomac@nayzer974.github.io/lib/glassTokens.js) | ✓ | Liquid Glass design tokens: every number that shapes the material or its motion lives here (docs/liquid-glass.md). | `glass.js`, `glassContainer.js`, `glassPerformance.js`, `reveal.js` |
| [`guide.js`](../extension/gnomac@nayzer974.github.io/lib/guide.js) |  | "Guide GNOMAC": a glass sheet with every shortcut and gesture of the project, found by typing "guide" in Spotlight. | `extension.js`, `spotlight.js` |
| [`helloPaths.js`](../extension/gnomac@nayzer974.github.io/lib/helloPaths.js) | ✓ | Greeting words as vector paths (1000-unit em, y down, baseline at 0), made from the Sacramento font by Astigmatic, SIL Open Font License 1.1 (https://scripts.sil.org/OFL). | `bootArt.js` |
| [`i18n.js`](../extension/gnomac@nayzer974.github.io/lib/i18n.js) |  | Minimal two-language strings until proper gettext catalogs exist. | `about.js`, `desktopLayer.js`, `gdmInstall.js`, `guide.js`, `notchPages.js`, `notchViews.js` … |
| [`keys.js`](../extension/gnomac@nayzer974.github.io/lib/keys.js) |  | Sends keyboard shortcuts to the focused window, so menu bar items like Edit › Copy act on the app the way the real shortcut would. | `appMenus.js`, `spotlight.js` |
| [`lensEffect.js`](../extension/gnomac@nayzer974.github.io/lib/lensEffect.js) |  | The start-up lens: a disc of liquid glass that opens at the centre of the screen and grows until it covers it (modules/bootShutdown.js, style "lens"). | `bootShutdown.js`, `wallpaperPicker.js` |
| [`menuGuard.js`](../extension/gnomac@nayzer974.github.io/lib/menuGuard.js) |  | GNOME Shell keeps, for each popup menu, the "settings" items added with addSettingsAction() (Network, Bluetooth, power profiles... | `extension.js` |
| [`missionControl.js`](../extension/gnomac@nayzer974.github.io/lib/missionControl.js) |  | MissionControl: the windows of the current workspace shrink and arrange themselves on a grid; a click on one brings it back to full size and focuses it. | `motionBench.js`, `spotlight.js`, `windowAnimations.js` |
| [`motion.js`](../extension/gnomac@nayzer974.github.io/lib/motion.js) |  | Apple-style micro-interactions shared by the island, widgets and menus. | `about.js`, `notchPages.js`, `prayerPage.js`, `widgetExtras.js`, `widgetTypes.js`, `appearance.js` … |
| [`motionBench.js`](../extension/gnomac@nayzer974.github.io/lib/motionBench.js) |  | Motion benchmark (Spotlight > "Motion Benchmark"): runs the real window animations on YOUR open windows and measures what the screen actually does. | `spotlight.js` |
| [`motionTokens.js`](../extension/gnomac@nayzer974.github.io/lib/motionTokens.js) |  | Motion tokens: one set of durations and curves for the whole desktop, so a window, the dock, Spotlight, the island and a workspace change feel like one physical system. | `animationTimeline.js`, `diagnostics.js`, `missionControl.js`, `whatsNew.js`, `windowMotion.js`, `dock.js` … |
| [`mprisClient.js`](../extension/gnomac@nayzer974.github.io/lib/mprisClient.js) |  | A small MPRIS client, straight over D-Bus, for the Dynamic Island. | `dynamicIsland.js` |
| [`notchPages.js`](../extension/gnomac@nayzer974.github.io/lib/notchPages.js) |  | More Dynamic Island pages: system stats, quick actions, clipboard, and the "idle home" shown in place of the player when nothing is playing. | `widgetTypes.js`, `dynamicIsland.js` |
| [`notchViews.js`](../extension/gnomac@nayzer974.github.io/lib/notchViews.js) |  | Extra views of the Dynamic Island, as in Alcove / Boring Notch: - MonthCalendar: the current month with today highlighted, - PomodoroTimer: focus/break countdown shown… | `widgetTypes.js`, `dynamicIsland.js` |
| [`notificationOpen.js`](../extension/gnomac@nayzer974.github.io/lib/notificationOpen.js) |  | Clicking a notification must open what it is about. | `dynamicIsland.js`, `notificationCenter.js`, `notifications.js` |
| [`prayerPage.js`](../extension/gnomac@nayzer974.github.io/lib/prayerPage.js) |  | The "Prayers" tab of the Dynamic Island: the next prayer and how long until it, the six times of the day with the current one lit, and the date in the Hijri calendar. | `dynamicIsland.js` |
| [`prayerPrefs.js`](../extension/gnomac@nayzer974.github.io/lib/prayerPrefs.js) |  | The "Heures de prière" group of the preferences window. | `prefs.js` |
| [`prayerSchedule.js`](../extension/gnomac@nayzer974.github.io/lib/prayerSchedule.js) |  | The prayer times of a day as real moments (GLib.DateTime), which prayer is current and which is next, and the alerts that fire at each prayer. | `prayerPage.js`, `dynamicIsland.js` |
| [`prayerTimes.js`](../extension/gnomac@nayzer974.github.io/lib/prayerTimes.js) | ✓ | Prayer times, computed on the machine from the sun's position: no network, no account. | `prayerPage.js`, `prayerPrefs.js`, `prayerSchedule.js`, `dynamicIsland.js` |
| [`reveal.js`](../extension/gnomac@nayzer974.github.io/lib/reveal.js) |  | The desktop is REVEALED in two beats, shared by the unlock transition and the start-up: | `bootShutdown.js`, `lockScreen.js` |
| [`session.js`](../extension/gnomac@nayzer974.github.io/lib/session.js) |  | Session actions for the system menu and Spotlight. | `spotlight.js`, `topbar.js` |
| [`shaderEffect.js`](../extension/gnomac@nayzer974.github.io/lib/shaderEffect.js) |  | GLSLEffect: the base class of every GNOMAC shader. | `glass.js`, `lensEffect.js` |
| [`spring.js`](../extension/gnomac@nayzer974.github.io/lib/spring.js) |  | Spring physics shared by every GNOMAC animation. | `extension.js`, `animationTimeline.js`, `motion.js`, `dock.js`, `dockExtras.js`, `dynamicIsland.js` … |
| [`svgPath.js`](../extension/gnomac@nayzer974.github.io/lib/svgPath.js) | ✓ | A small SVG path reader for Cairo: absolute and relative M L H V C S Q T Z, curves flattened only to measure lengths. | `bootArt.js` |
| [`throttle.js`](../extension/gnomac@nayzer974.github.io/lib/throttle.js) | ✓ | Lets an event handler run at most once per interval. | `glass.js` |
| [`ui.js`](../extension/gnomac@nayzer974.github.io/lib/ui.js) |  | Shared sizing helper. Every pixel size in GNOMAC was designed on a 1280x800 logical screen; on a taller logical screen (a bigger VM window, a 4K monitor at scale 1)… | `desktopIcons.js`, `dock.js`, `widgets.js` |
| [`weather.js`](../extension/gnomac@nayzer974.github.io/lib/weather.js) |  | Weather for the desktop widget, from wttr.in (JSON, no API key). | `widgetExtras.js`, `widgetTypes.js` |
| [`whatsNew.js`](../extension/gnomac@nayzer974.github.io/lib/whatsNew.js) |  | "What's new": a glass card listing the new features and the fixes of the releases you have not seen yet. | `updater.js` |
| [`widgetExtras.js`](../extension/gnomac@nayzer974.github.io/lib/widgetExtras.js) |  | More desktop widgets: analog clock, world clocks, day/week/month/year progress, countdown, photo, live CPU/memory graph and a weather forecast. | `widgetTypes.js` |
| [`widgetTypes.js`](../extension/gnomac@nayzer974.github.io/lib/widgetTypes.js) |  | Desktop widget types. Every type is {id, title, icon, sizes, build(ctx)}: build() receives a context and returns {actor, destroy, update?}. | `widgets.js` |
| [`windowMotion.js`](../extension/gnomac@nayzer974.github.io/lib/windowMotion.js) |  | WindowMotionManager: the one place that moves windows. | `windowAnimations.js` |

## Réglages

Tous les réglages de l'extension (`org.gnome.shell.extensions.gnomac`). **Lu dans** : les fichiers où la clé apparaît.
Changer un réglage reconstruit les modules, sauf les clés listées dans `extension.js` (`_settings.connect('changed'…)`).

### Interrupteurs des modules

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `enable-dock` | `b` | `true` | Show the GNOMAC dock | `extension.js`, `prefs.js` |
| `enable-notification-center` | `b` | `true` | Notification Center: a bell in the menu bar opens a glass panel with every notification | `extension.js` |
| `enable-spotlight` | `b` | `true` | Spotlight search bar | `extension.js`, `prefs.js` |
| `enable-displays` | `b` | `true` | Displays panel (main display, placement, mirror) | `extension.js`, `prefs.js` |
| `enable-glass-menus` | `b` | `true` | Liquid Glass menus and macOS-style Control Center | `extension.js`, `prefs.js` |
| `enable-window-animations` | `b` | `true` | macOS window animations (open, close, Genie minimize) | `extension.js`, `prefs.js` |
| `enable-dynamic-island` | `b` | `true` | Dynamic Island for music and notifications | `extension.js`, `prefs.js` |
| `enable-launchpad` | `b` | `true` | Launchpad app grid (dock Applications button) | `extension.js`, `prefs.js` |
| `enable-notifications` | `b` | `true` | macOS-style glass notification banners in the top-right corner | `extension.js`, `prefs.js` |
| `enable-lock-screen` | `b` | `true` | macOS-style lock screen | `extension.js`, `prefs.js` |
| `enable-vibrancy` | `b` | `true` | Frosted glass behind app sidebars (Files) | `extension.js`, `prefs.js` |
| `enable-menubar-icons` | `b` | `true` | macOS status symbols (Wi-Fi, battery, Control Center) in the menu bar | `extension.js`, `prefs.js` |
| `enable-wallpaper-picker` | `b` | `true` | Wallpaper carousel (Super+W) with circle reveal | `extension.js`, `prefs.js` |
| `enable-widgets` | `b` | `true` | Desktop widgets (battery, calendar, reminders) | `extension.js`, `prefs.js` |
| `enable-boot-shutdown` | `b` | `true` | macOS start-up and shut-down animations | `extension.js`, `prefs.js` |
| `enable-shutdown-animation` | `b` | `true` | Play the shut-down animation before powering off, restarting or logging out | `bootShutdown.js`, `prefs.js` |
| `enable-appearance` | `b` | `true` | Appearance section (accent colour, light/dark, glass, icon style) in the Control Center | `extension.js`, `prefs.js` |
| `enable-window-layout` | `b` | `true` | Window tiling shortcuts and layout palette | `extension.js`, `prefs.js` |
| `enable-stage-manager` | `b` | `false` | Start with Stage Manager on (Super+Ctrl+M toggles it at any time) | `stageManager.js`, `prefs.js` |
| `enable-login-screen` | `b` | `true` | GDM login screen styling (only used once installed system-wide with gdm/install-gdm.sh) | `extension.js` |
| `enable-theme-custom` | `b` | `true` | Theme customisation: generated.css from the settings and your own ~/.config/gnomac/user.css | `extension.js`, `prefs.js` |
| `enable-unlock-animation` | `b` | `true` | Unlock transition: the lock screen dissolves and the desktop is revealed (instead of GNOME's slide) | `lockScreen.js`, `prefs.js` |
| `enable-updater` | `b` | `true` | Check GitHub for GNOMAC updates | `extension.js`, `updater.js`, `prefs.js` |
| `enable-desktop-icons` | `b` | `true` | Show the files of the Desktop folder as icons on the wallpaper | `extension.js`, `prefs.js` |
| `enable-topbar` | `b` | `true` | Turn the GNOME panel into a macOS-style menu bar | `extension.js`, `prefs.js` |
| `enable-app-menus` | `b` | `true` | macOS app menus (File, Edit, View, Window, Help) in the menu bar | `extension.js`, `prefs.js` |

### Raccourcis clavier

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `spotlight-shortcut` | `as` | `['<Super>space']` | Keyboard shortcut that toggles Spotlight | `spotlight.js` |
| `displays-shortcut` | `as` | `['<Super><Control>d']` | Keyboard shortcut that opens the displays panel | `displays.js` |
| `wallpaper-shortcut` | `as` | `['<Super>w']` | Keyboard shortcut that opens the wallpaper picker | `wallpaperPicker.js` |
| `layout-shortcut` | `as` | `['<Super><Control>t']` | Open the window layout palette | `windowLayout.js` |
| `stage-manager-shortcut` | `as` | `['<Super><Control>m']` | Toggle Stage Manager | `stageManager.js` |
| `mission-control-shortcut` | `as` | `['<Super>F3']` | Show all windows (Mission Control) | `windowAnimations.js` |
| `quit-shortcut` | `as` | `['<Super>q']` | Quit the focused application (closes all its windows) | `windowLayout.js` |

### Boot

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `boot-style` | `s` | `'lens'` | Start-up: a lens of liquid glass opens from the centre (lens), the desktop through a light haze (mist), logo traced then greetings written (hello), the traced logo only, or the former logo and bar | `bootShutdown.js`, `prefs.js` |
| `boot-hello-words` | `i` | `2` | How many greetings are written during the start-up | `bootShutdown.js`, `prefs.js` |
| `boot-animation` | `s` | `'auto'` | In-session start-up logo: auto skips it when the GNOMAC Plymouth theme already played it | `bootShutdown.js`, `prefs.js` |
| `boot-duration` | `i` | `2600` | Start-up progress bar duration in milliseconds | `bootShutdown.js`, `prefs.js` |

### Desktop

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `desktop-icons-visible` | `b` | `true` | Show the desktop items (the right-click menu toggles it) | `extension.js`, `desktopIcons.js` |
| `desktop-icons-layout` | `s` | `''` | Remembered grid cell of each desktop icon (JSON) | `extension.js`, `desktopIcons.js` |
| `desktop-icons-size` | `s` | `'medium'` | Size of the desktop icons | `desktopIcons.js`, `prefs.js` |
| `desktop-icons-side` | `s` | `'right'` | Side of the screen the icons start from | `desktopIcons.js`, `prefs.js` |

### Dock

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `dock-click-minimize` | `b` | `true` | Clicking the dock icon of the active app hides it (like the Windows taskbar) | `dock.js`, `prefs.js` |
| `dock-badges` | `b` | `true` | Red notification counters on the dock icons | `dock.js`, `prefs.js` |
| `dock-auto-size` | `b` | `true` | Size the dock from the screen height instead of a fixed pixel size | `ui.js`, `prefs.js` |
| `dock-size-scale` | `d` | `1.0` | Dock size multiplier applied on top of the automatic size | `ui.js`, `prefs.js` |
| `dock-icon-size` | `i` | `48` | Dock icon size in pixels | `ui.js`, `prefs.js` |
| `dock-magnification` | `b` | `true` | Magnify dock icons under the pointer | `dock.js`, `prefs.js` |
| `dock-max-scale` | `d` | `1.75` | Maximum magnification factor | `dock.js`, `prefs.js` |
| `dock-reserve-space` | `b` | `true` | Keep maximized windows above the dock | `dock.js`, `prefs.js` |
| `dock-icon-style` | `s` | `'default'` | Dock icon style (macOS Tahoe icon and widget styles) | `appearance.js`, `dock.js`, `prefs.js` |
| `dock-show-running` | `b` | `true` | Show a dot under running apps | `dock.js`, `prefs.js` |

### Glass

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `glass-quality` | `s` | `'high'` | Liquid Glass quality: lower levels drop optics (chroma, fresnel, blur) to save GPU | `diagnostics.js`, `glassBench.js`, `glassPerformance.js`, `glassTokens.js` … |
| `glass-adaptive` | `b` | `true` | Adapt the glass to the brightness of the wallpaper | `glass.js`, `dock.js`, `prefs.js` |
| `glass-fresnel` | `d` | `1.0` | Strength of the Fresnel edge light of the glass | `glass.js`, `prefs.js` |
| `glass-debug-mode` | `i` | `0` | Debug view of one layer of the glass: 0 off, 1 backdrop, 2 refraction, 3 fresnel, 4 specular, 5 rim, 6 tint | `extension.js`, `glass.js`, `glassDebug.js` |
| `glass-debug` | `b` | `false` | Show the Liquid Glass debug overlay (surfaces, quality, brightness) | `extension.js`, `glassDebug.js`, `prefs.js` |
| `glass-inspector` | `b` | `false` | Glass Inspector: detailed overlay (groups, regions, passes, quality levels, animations) | `extension.js`, `glassDebug.js` |
| `glass-debug-groups` | `b` | `false` | Outline every glass group (bounds, id, surfaces, render passes) | `extension.js`, `glassDebug.js` |
| `glass-blur` | `i` | `5` | Backdrop blur radius | `glassBench.js`, `whatsNew.js`, `dock.js`, `glassMenus.js` … |
| `glass-refraction` | `d` | `40` | Edge refraction strength in pixels | `glass.js`, `glassMenus.js`, `spotlight.js`, `prefs.js` |
| `glass-chroma` | `d` | `4` | Chromatic dispersion at the edges in pixels | `glass.js`, `prefs.js` |
| `glass-rim` | `d` | `0.55` | Rim light intensity | `glass.js`, `prefs.js` |
| `glass-intensity` | `d` | `0.3` | Liquid Glass intensity: how much the glass is tinted (macOS Tahoe slider) | `glass.js`, `prefs.js` |
| `glass-tinted` | `b` | `false` | Tinted glass (accent colour) instead of clear glass | `glass.js`, `appearance.js`, `prefs.js` |
| `glass-dark` | `b` | `true` | Dark glass tint (light tint when false) | `glass.js`, `prefs.js` |

### Island

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `island-always-visible` | `b` | `true` | Keep the Dynamic Island visible as a notch when nothing plays |  |
| `island-notifications` | `b` | `false` | Show notifications in the Dynamic Island too | `dynamicIsland.js`, `prefs.js` |
| `island-open-trigger` | `s` | `'both'` | How the island opens its dashboard: pointer over it, click, both, or never | `dynamicIsland.js`, `prefs.js` |
| `island-hover-delay` | `i` | `0` | Milliseconds the pointer must stay over the island before it opens | `dynamicIsland.js`, `prefs.js` |
| `island-close-delay` | `i` | `0` | Milliseconds after the pointer leaves before the dashboard closes | `dynamicIsland.js`, `prefs.js` |
| `island-autoclose-seconds` | `i` | `0` | Close a dashboard opened by a click after this many idle seconds (0 = never) | `dynamicIsland.js`, `prefs.js` |
| `island-rest-style` | `s` | `'notch'` | Folded island: always visible, only when it has something to show, or invisible until used | `dynamicIsland.js`, `prefs.js` |
| `island-scale` | `d` | `1.0` | Size of the island (width, and height when open) | `dynamicIsland.js`, `prefs.js` |
| `island-show-clock` | `b` | `true` | Show the time in the folded island | `dynamicIsland.js`, `prefs.js` |
| `island-clock-24h` | `b` | `true` | 24-hour clock in the island | `prayerSchedule.js`, `dynamicIsland.js`, `prefs.js` |
| `island-show-badge` | `b` | `true` | Show the unread notification badge in the folded island | `dynamicIsland.js`, `prefs.js` |
| `island-show-timer-ring` | `b` | `true` | Show the Pomodoro ring in the folded island | `dynamicIsland.js`, `prefs.js` |
| `island-show-media` | `b` | `true` | Show the cover and equaliser in the folded island | `dynamicIsland.js`, `prefs.js` |
| `island-hud` | `b` | `true` | Show volume and brightness in the island instead of GNOME on-screen display | `dynamicIsland.js`, `prefs.js` |
| `island-hud-seconds` | `d` | `1.5` | Seconds the volume and brightness bar stays up | `dynamicIsland.js`, `prefs.js` |
| `island-notice-seconds` | `i` | `4` | Seconds a notification card stays in the island | `dynamicIsland.js`, `prefs.js` |
| `island-live-events` | `b` | `true` | Live events in the island: charger plugged in, low battery, Bluetooth device connected, new track | `dynamicIsland.js`, `prefs.js` |
| `island-bounce` | `b` | `true` | Squash-and-stretch bounce when something arrives | `dynamicIsland.js`, `prefs.js` |
| `island-cascade` | `b` | `true` | Content pops in one piece after another when the dashboard opens | `dynamicIsland.js`, `prefs.js` |
| `island-hide-fullscreen` | `b` | `true` | Hide the island over full-screen windows | `dynamicIsland.js`, `prefs.js` |
| `island-remember-tab` | `b` | `false` | Reopen on the last used tab instead of the default one | `dynamicIsland.js`, `prefs.js` |
| `island-default-tab` | `s` | `'home'` | Tab shown when the dashboard opens | `dynamicIsland.js`, `prefs.js` |
| `island-tabs` | `as` | `['home', 'stats', 'actions', 'clipboa…` | Tabs available in the dashboard | `dynamicIsland.js`, `prefs.js` |
| `island-shelf` | `as` | `[]` | Files kept on the notch shelf (URIs) | `extension.js`, `dynamicIsland.js` |

### Menu

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `menu-icons` | `b` | `false` | Show a symbol before each item of the Apple menu (macOS Tahoe style; Golden Gate removed most of them) | `topbar.js`, `prefs.js` |

### Panel

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `panel-style` | `s` | `'transparent'` | Menu bar background (Golden Gate default is transparent) | `topbar.js`, `prefs.js` |

### Pomodoro

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `pomodoro-focus` | `i` | `25` | Pomodoro focus length in minutes | `notchViews.js`, `prefs.js` |
| `pomodoro-short` | `i` | `5` | Pomodoro short break length in minutes | `notchViews.js`, `prefs.js` |
| `pomodoro-long` | `i` | `15` | Pomodoro long break length in minutes | `notchViews.js`, `prefs.js` |
| `pomodoro-rounds` | `i` | `4` | Focus rounds before a long break | `notchViews.js`, `prefs.js` |
| `pomodoro-auto` | `b` | `false` | Start the next phase automatically | `notchViews.js`, `prefs.js` |

### Prayer

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `prayer-enabled` | `b` | `false` | Prayer times: the "Prayers" tab of the island and the alerts (off until you turn it on) | `extension.js`, `prayerPrefs.js`, `prayerSchedule.js`, `dynamicIsland.js` |
| `prayer-city` | `s` | `''` | Name of the place the prayer times are computed for (display only) | `prayerPrefs.js`, `prayerSchedule.js` |
| `prayer-latitude` | `d` | `0` | Latitude of the place (0 with a 0 longitude means not chosen yet) | `prayerPrefs.js`, `prayerSchedule.js` |
| `prayer-longitude` | `d` | `0` | Longitude of the place | `prayerPrefs.js`, `prayerSchedule.js` |
| `prayer-method` | `s` | `'mwl'` | Calculation method (Fajr and Isha angles) | `prayerPrefs.js`, `prayerSchedule.js` |
| `prayer-asr` | `s` | `'standard'` | Asr: shadow as long as the object (standard) or twice as long (Hanafi) | `prayerPrefs.js`, `prayerSchedule.js` |
| `prayer-high-latitude` | `s` | `'angle'` | What to do when the sun does not go low enough for Fajr or Isha (far north or south) | `prayerPrefs.js`, `prayerSchedule.js` |
| `prayer-offsets` | `ai` | `[0, 0, 0, 0, 0, 0]` | Minutes added to Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha (to match a local timetable) | `prayerPrefs.js`, `prayerSchedule.js` |
| `prayer-notify` | `as` | `['fajr', 'dhuhr', 'asr', 'maghrib', '…` | Prayers that raise a notification (fajr, sunrise, dhuhr, asr, maghrib, isha) | `prayerPrefs.js`, `prayerSchedule.js` |
| `prayer-before-minutes` | `i` | `0` | Also remind this many minutes before each prayer (0 = no reminder) | `prayerPrefs.js`, `prayerSchedule.js` |
| `prayer-sound` | `b` | `false` | Play a short sound with the prayer notification | `prayerPrefs.js`, `prayerSchedule.js` |

### Reduce

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `reduce-transparency` | `b` | `false` | Reduce transparency: glass becomes an opaque pane (also on when GNOME's high contrast is on) | `glass.js`, `prefs.js` |

### Theme

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `theme-accent` | `s` | `'#0a84ff'` | Accent colour of GNOMAC panels, tabs, bars and highlights (hex) | `themeCustom.js`, `prefs.js` |
| `theme-corners` | `s` | `'round'` | Corner style of GNOMAC cards, buttons and tiles | `themeCustom.js`, `prefs.js` |
| `theme-shadow` | `s` | `'soft'` | Shadow under the floating panels | `themeCustom.js`, `prefs.js` |
| `theme-text-scale` | `d` | `1.0` | Text size of the GNOMAC interface | `themeCustom.js`, `prefs.js` |
| `theme-font` | `s` | `''` | Font family for the GNOMAC interface (empty = the system font) | `themeCustom.js`, `prefs.js` |
| `theme-density` | `d` | `1.0` | Spacing of lists: below 1 is more compact | `themeCustom.js`, `prefs.js` |

### Update

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `update-button` | `b` | `true` | A button in the menu bar to check for updates by hand | `updater.js` |
| `update-mode` | `s` | `'notify'` | New version found: tell me (notify), install it (auto), or do nothing (off) | `updater.js`, `prefs.js` |
| `update-hours` | `i` | `6` | Hours between two checks | `updater.js`, `prefs.js` |
| `update-latest` | `s` | `''` | Latest commit seen on GitHub at the last check | `updater.js` |
| `update-dismissed` | `s` | `''` | Commit the user chose to ignore (no notification again for it) | `updater.js` |

### Whatsnew

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `whatsnew-seen` | `i` | `0` | The newest release notes already shown (whatsnew.json) | `extension.js`, `whatsNew.js`, `updater.js` |

### Widget

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `widget-size` | `s` | `'standard'` | Desktop widget size (macOS 27 offers XXL widgets) |  |
| `widget-weather` | `b` | `true` | Weather widget (asks wttr.in for the forecast) | `weather.js`, `widgetExtras.js`, `widgetTypes.js`, `prefs.js` |
| `widget-weather-city` | `s` | `''` | City for the weather widget; empty means locate by IP address | `weather.js`, `widgetExtras.js`, `widgetTypes.js`, `prefs.js` |
| `widget-reminders` | `as` | `[]` | Reminders shown in the desktop widget | `extension.js`, `widgetTypes.js` |

### Widgets

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `widgets-layout` | `s` | `''` | Desktop widgets layout (JSON list of widgets); empty means the default layout | `extension.js`, `widgets.js`, `prefs.js` |
| `widgets-anchor` | `s` | `'left'` | Side of the screen the widget grid starts from | `widgets.js`, `prefs.js` |
| `widgets-scale` | `d` | `1.0` | Size of the desktop widgets | `widgets.js`, `prefs.js` |
| `widgets-margin` | `i` | `18` | Space between the widgets and the screen edge, in pixels | `widgets.js`, `prefs.js` |

### Window

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `window-path-curve` | `d` | `0.12` | How much the window's path to the dock icon bows (0 = straight line) | `windowMotion.js` |
| `window-gap` | `i` | `10` | Gap between maximized windows and the screen edges / dock | `dock.js`, `gaps.js`, `widgets.js`, `windowLayout.js` … |

### Autres

| Clé | Type | Défaut | Rôle | Lu dans |
|---|---|---|---|---|
| `force-animations` | `b` | `true` | Keep animations on with software rendering (virtual machines) | `extension.js`, `prefs.js` |
| `menubar-hide-extras` | `b` | `true` | Collapse app tray icons behind a chevron in the menu bar | `menuBarIcons.js`, `prefs.js` |
| `tile-left` | `as` | `['<Super><Control>Left']` | Tile the focused window: left | `windowLayout.js` |
| `tile-right` | `as` | `['<Super><Control>Right']` | Tile the focused window: right | `windowLayout.js` |
| `tile-top` | `as` | `['<Super><Control>Up']` | Tile the focused window: top | `windowLayout.js` |
| `tile-bottom` | `as` | `['<Super><Control>Down']` | Tile the focused window: bottom | `windowLayout.js` |
| `tile-fill` | `as` | `['<Super><Control>Return']` | Tile the focused window: fill | `windowLayout.js` |
| `tile-center` | `as` | `['<Super><Control>c']` | Tile the focused window: center | `windowLayout.js` |
| `login-wallpaper` | `s` | `'/usr/share/gnomac/login.jpg'` | Wallpaper shown behind the GDM login screen | `loginScreen.js` |
| `open-animation` | `s` | `'dock'` | Opening a window: it grows out of its dock icon, or pops in from 90 percent | `windowAnimations.js`, `prefs.js` |
| `minimize-effect` | `s` | `'genie'` | Minimise, restore and close: a curved path into the dock icon, or the Genie funnel | `windowAnimations.js`, `prefs.js` |
| `close-animation` | `s` | `'genie'` | Closing a window: Genie into the dock, or GNOME's own animation | `windowAnimations.js`, `prefs.js` |
| `shutdown-duration` | `i` | `1900` | Shut-down animation duration in milliseconds | `bootShutdown.js`, `prefs.js` |
| `logo-style` | `s` | `'apple'` | Menu bar logo: Apple-style or Golden Gate bridge | `topbar.js`, `prefs.js` |
| `spring-stiffness` | `d` | `260` | Spring stiffness for animations | `dock.js`, `prefs.js` |
| `spring-damping` | `d` | `26` | Spring damping for animations | `dock.js`, `prefs.js` |

### Déclarés mais jamais lus

Ces clés sont dans le schéma mais aucun fichier ne les lit : du code mort, à supprimer ou à brancher.

- `island-always-visible` : Keep the Dynamic Island visible as a notch when nothing plays
- `widget-size` : Desktop widget size (macOS 27 offers XXL widgets)

## Feuille de style

[`stylesheet.css`](../extension/gnomac@nayzer974.github.io/stylesheet.css) : un seul fichier, découpé en sections (`grep -n "/\* ------" stylesheet.css` donne les lignes) :

- Dock
- Menu bar
- Spotlight
- Glass menus & Control Center
- Dynamic Island
- Dock extras: Downloads fan, Trash dialog
- Launchpad
- Notification banners
- Lock screen
- Menu bar status symbols
- Dynamic Island notch (RevoShell style)
- Menu bar: Apple menu, app menus, status extras
- About This Mac
- Wallpaper picker
- Dynamic Island dashboard
- Dynamic Island: pages
- Dynamic Island: the Prayers tab
- Dynamic Island: the player card
- Desktop widgets
- Colour chips (macOS system colours)
- Start-up / shut-down
- Editable widgets
- Control Center: Appearance section
- Window layout palette and ghost
- App switcher (Cmd+Tab)
- Screenshot toolbar (Shift+Cmd+5)
- Mission Control (overview)
- GNOMAC guide
- Stage Manager strip
- Notification Center: calendar as in macOS
- GDM login screen (loaded only by GDM's shell)
- Widgets: colour, new types, edit mode
- Dock: notification badge and poof
- Start-up v2
- GDM login: premium touches
- About This Mac (v2)
- Desktop icons
- Notification Center
- What's new

Les classes de GNOMAC commencent par `gnomac-`. L'utilisateur peut aussi restyler sans toucher au code : [`docs/THEMING.md`](THEMING.md).

## Outils et tests

| Fichier | Rôle |
|---|---|
| [`check-compat.py`](../tools/check-compat.py) | Check the GObject Introspection names used by the extension against the typelibs installed on this machine. |
| [`check.sh`](../tools/check.sh) | Static checks, the same ones the CI runs. |
| [`classify-critical.py`](../tools/classify-critical.py) | Sort the CRITICAL / JS ERROR lines of a GNOME Shell log into BENIGN SHUTDOWN and REAL BUG. |
| [`gen-map.py`](../tools/gen-map.py) | Builds the map of GNOMAC from the code itself: docs/MAP.md (for people) and docs/map.json (for programs and AI agents). |
| [`make_hello.py`](../tools/make_hello.py) | Turn greeting words into SVG path data using the OFL font Sacramento, so the extension can draw them (no font needs to be installed). |
| [`make_plymouth_logo.py`](../tools/make_plymouth_logo.py) | Render plymouth/gnomac/logo.png from icons/apple.svg's path: glass-white body with a soft vertical shading and a fading reflection underneath (same look as the start-up animation). |
| [`prefs-smoke.js`](../tools/prefs-smoke.js) | Builds the prayer part of the preferences in a small window of its own and drives it, so a typing mistake or a broken search shows up in a test. |
| [`probe-kit.js`](../tools/probe-kit.js) | Helpers for writing your own scenario for the headless GNOME Shell of tools/smoke-test.sh: wait, log, screenshots, a virtual keyboard and pointer, a real window, and a look at the modal grab that… |
| [`smoke-driver.js`](../tools/smoke-driver.js) | Test driver for tools/smoke-test.sh. It is copied into a throw-away copy of the extension and run inside a headless GNOME Shell: it opens and closes every panel that has an open/close pair, turns… |
| [`smoke-test.sh`](../tools/smoke-test.sh) | Start GNOME Shell headless with the extension from this checkout, in a throw-away session (own D-Bus, own settings, own data dir), drive it with tools/smoke-driver.js and report what GNOMAC logs. |
| [`test-cover.js`](../tools/test-cover.js) | The size cap on album covers (lib/coverArt.js): web addresses are capped while the data arrives, `data:` addresses before they are decoded. |
| [`test-display-layout.mjs`](../tools/test-display-layout.mjs) | lib/displayLayout.js: what is asked of Mutter for each multi-monitor action. |
| [`test-install.sh`](../tools/test-install.sh) | Runs install.sh --update and uninstall.sh in a throw-away home (own D-Bus, in-memory settings), and the login screen sync script as an ordinary user, to check that: - a gnomac.css of your own… |
| [`test-island-logic.js`](../tools/test-island-logic.js) | The transport buttons of the island (lib/mprisClient.js skipControl). |
| [`test-island-logic.mjs`](../tools/test-island-logic.mjs) | Pure logic of the island that has no need of the shell: the transport buttons and the clipboard history. |
| [`test-prayer-schedule.js`](../tools/test-prayer-schedule.js) | Checks lib/prayerSchedule.js: which prayer is current and next, the wall clock around a daylight-saving change, and the alerts. |
| [`test-prayer.mjs`](../tools/test-prayer.mjs) | Checks lib/prayerTimes.js against reference timetables from the Aladhan API (api.aladhan.com, fetched for the dates below). |
| [`test-throttle.mjs`](../tools/test-throttle.mjs) | lib/throttle.js: at most one pass per interval, and enter/leave never dropped. |
| [`test-weather.js`](../tools/test-weather.js) | The "Weather widget" setting must stop every request to wttr.in. |
| [`trace_logo.py`](../tools/trace_logo.py) | Trace a black-on-light logo bitmap into smooth SVG Bezier paths. |

## Installation, système, CI

| Fichier | Rôle |
|---|---|
| `install.sh` | GNOMAC installer — CachyOS / Arch first, works on any GNOME 50+ distro. |
| `uninstall.sh` | Removes GNOMAC and gives GNOME the look it had before ./install.sh: - the extension and its settings, - the GTK window controls, - the window buttons, fonts, icon/cursor theme, colour scheme, accent… |
| `get.sh` | One-line installer: |
| `ez-install.sh` | GNOMAC, express install: one command, a few questions, everything set up. |
| `Makefile` | Package for extensions.gnome.org. |
| `scripts/state.py` | Remembers the GNOME settings GNOMAC changes, so uninstall.sh can put them back. |
| `scripts/update.sh` | GNOMAC updater: fetch the newest version and refresh the extension and styles. |
| `gdm/install-gdm.sh` | GNOMAC on the GDM login screen (CachyOS / Arch GNOME). |
| `gdm/sync-login.sh` | Copies the user's GNOMAC extension to the system folder GDM reads, so the login screen follows updates. |
| `gdm/sync-units.sh` | The two systemd units of the login screen auto-sync, as functions that print them. |
| `gdm/login.css` | GNOMAC login screen: your own CSS. |
| `gdm/login.conf` | GNOMAC login screen settings (read by GDM's shell at each boot). |
| `.github/workflows/ci.yml` | GNOME Shell's own typelibs are not on the runner: the library-name check runs on a machine with GNOME (tools/check.sh locally). |
| `theme/gtk-3.0/` | gnomac.css |
| `theme/gtk-4.0/` | gnomac.css |
| `plymouth/gnomac/` | gnomac.plymouth, gnomac.script, logo.png, pixel.png |

## Documentation

- [AGENTS.md — GNOMAC for coding agents](../AGENTS.md) — `AGENTS.md`
- [Architecture de GNOMAC](../ARCHITECTURE.md) — `ARCHITECTURE.md`
- [README.md](../README.md) — `README.md`
- [Analyse : RevoShell, Gnomintosh, macOS 27 Golden Gate](../docs/ANALYSIS.md) — `docs/ANALYSIS.md`
- [Modifier GNOMAC : « je veux changer… »](../docs/MODIFY.md) — `docs/MODIFY.md`
- [Personnaliser le thème de GNOMAC](../docs/THEMING.md) — `docs/THEMING.md`
- [Animations de GNOMAC](../docs/animations.md) — `docs/animations.md`
- [Le bureau : icônes, menu, fond vidéo, centre de notifications](../docs/desktop.md) — `docs/desktop.md`
- [L'encoche de GNOMAC face à la Dynamic Island et aux apps d'encoche](../docs/dynamic-island.md) — `docs/dynamic-island.md`
- [Tester GNOMAC sur une vraie machine](../docs/hardware-testing.md) — `docs/hardware-testing.md`
- [Liquid Glass dans GNOMAC](../docs/liquid-glass.md) — `docs/liquid-glass.md`
- [Desktop Motion System](../docs/motion.md) — `docs/motion.md`

