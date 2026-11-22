# Changelog

All notable changes to Liquid Store. The APK version name and `versionCode` in
`AndroidManifest.xml` track the headings below.

## 14.5 — 23 November 2026

Fully transparent glass, everywhere again.

- **Every glass tint is transparent.** The tab bar, the search orb, the selection
  lens, the menu, the toast, the loader card, the search field and the background
  pane now paint no colour of their own: what a reader sees through them is the
  page behind, bent at the rim with the dispersion and the edge light. The 14.4
  tints on the dock (34%) and the lens (58%) are gone, and so are the whisper
  tints the text panels carried since 13.1.
- **One knob, kept in one place.** All eight surfaces still carry their `tint`
  attribute, and every one of those variables now resolves to `transparent`
  (`--lg-bg`, `--lg-dock`, `--lg-lens`, `--lg-menu`, `--lg-panel`, `--lg-field`).
  Raising one surface back out of see-through is a single line — give that
  variable a colour with an alpha, e.g. `rgb(255 255 255 / .5)` — and nothing
  else changes.
- **Everything from 14.4 stays**: the bar is 72px (compact 60px), the orb is
  72px, the dock still shrinks and then leaves as you read on and returns full
  size the moment you scroll back.
- Verified in the page: `--lg-dock`, `--lg-lens`, `--lg-menu` all read
  `transparent`, the lens and the dock's own tint layer compute to
  `rgba(0, 0, 0, 0)`, the lens still reports `optics: lens`, no JavaScript errors.
- Screenshots refreshed in both appearances; the dock is see-through in each.
- APK: `versionCode` 121, `versionName` 14.5.

## 14.4 — 23 November 2026

The dock: it leaves when you read on, and it is bigger.

- **The dock follows the scroll, in two steps** — compact first, then off the
  bottom edge after another 110px; back full size the moment the finger reverses,
  and never away near the top of a list.
- **Bigger**: bar 66 → 72px, orb 66 → 72px, compact bar 54 → 60px.
- Tints on the dock, the orb and the lens (removed again in 14.5).
- APK: `versionCode` 120, `versionName` 14.4.

## 14.3 — 23 November 2026

A real download figure on every app a real figure exists for.

- **GitHub apps keep their own count** — the APK assets of the release each entry
  points at, summed (103 entries, 8.8M between them).
- **F-Droid apps take Google Play's install bucket**, from a shipped map
  `assets/play_installs.json`, always labelled — `1M+ on Play`.
- **108 of the demo's 114 apps show a real figure.**
- APK: `versionCode` 119, `versionName` 14.3.

## 14.2 — 23 November 2026

Download counts on every GitHub app, not just the author's own.

- **All 103 GitHub entries carry a real download count and a version**; catalogue
  total 8,828,439.
- **One entry per package** in the demo (the GitHub entry wins).
- APK: `versionCode` 118, `versionName` 14.2.

## 14.1 — 23 November 2026

Downloads and versions, on every app that has them.

- **Downloads counted from the release's APK assets**: a *Downloads* cell, a line
  under the name, and the second line of every list row.
- **Store-style rounding** past a thousand (`7.4k`, `1.2M`).
- APK: `versionCode` 117, `versionName` 14.1.

## 14.0 — 23 November 2026

Icons and screenshots for the catalogue's own apps.

- **Every GitHub entry can name its own icon and screenshots**, pointing at files
  the project publishes in its own repo. 53 of 67 have an icon, 62 have
  screenshots.
- APK: `versionCode` 116, `versionName` 14.0.

## 13.9 — 23 November 2026

One catalogue: the author's own apps, alongside everything else.

- **67 of the author's repositories are in the catalogue**, next to 36 third-party
  projects — 103 entries, each added only because it publishes an APK.
- **Package names were read from the APKs themselves** (`aapt2 dump badging`).
- APK: `versionCode` 115, `versionName` 13.9.

## 13.8 — 23 November 2026

The exclusion, in the page too.

- **`assets/index.html` carries the same four-repo exclusion list**, and both
  bridges answer through it.
- **It is visible**: the Sources sheet ends with *Kept out of this catalogue*.
- APK: `versionCode` 114, `versionName` 13.8.

## 13.7 — 23 November 2026

Four repos that must never reach the catalogue.

- **A shipped exclusion list, `assets/github_exclude.json`**, applied before
  fetching, after merging, and to the cache drawn before a refresh finishes.
- APK: `versionCode` 113, `versionName` 13.7.

## 13.6 — 23 November 2026

Today, laid out like the App Store's Today page.

- **The Today tab is a stack of rails**: *Apps We Love*, *New This Week*,
  *Browse Categories*, *Recently Updated*, *Top Charts*.
- APK: `versionCode` 112, `versionName` 13.6.

## 13.5 — 23 November 2026

Three dots, a popover that moves, and a choice of background.

- **The account icon is now three dots** (`⋯`), morphing while the menu is open.
- **The menu opens like a popover** — spring, stagger, reverse close, dimming
  scrim, reduced-motion support.
- **Background: liquid glass, or black**, remembered in `localStorage`.
- APK: `versionCode` 111, `versionName` 13.5.

## 13.4 — 23 November 2026

A glass background, and a screenshot strip you can actually move.

- **The app's whole background is the same material as the chrome**, over a
  see-through window.
- **The screenshot strip moves**: arrows, arrow keys, mouse drag with snap, wheel.
- APK: `versionCode` 110, `versionName` 13.4.

## 13.3 — 23 November 2026

Real screenshots in the demo, not mock-ups.

- **The demo catalogue is real apps with real screenshots**; the file names come
  from each app's fastlane metadata.
- APK: `versionCode` 109, `versionName` 13.3.

## 13.2 — 23 November 2026

Screenshots show up again.

- **The demo's screenshots were dead links**; the page hides a slot whose image
  never loads.
- APK: `versionCode` 108, `versionName` 13.2.

## 13.1 — 23 November 2026

Fully transparent glass.

- **Every surface is `variant="clear"`** — a 4% tint, no lift, the wider 28 dp
  refraction band, dispersion and the rim.
- APK: `versionCode` 107, `versionName` 13.1.

## 13.0 — 23 November 2026

The glass is now the real thing.

- **LiquidGlass 1.0.0 vendored and inlined**; ten glass surfaces, each a backplate
  inside the control's own box.
- **Theme-aware glass**, **chrome no longer tilts**, **`engine="canvas"` off on
  purpose**, **`build.sh` builds from any checkout**.
- APK: `versionCode` 106, `versionName` 13.0.

## 12.3 — earlier

- CI attaches the built APK to the release.
