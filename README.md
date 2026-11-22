<div align="center">

<img src="assets/icon.png" width="96" height="96" alt="Liquid Store icon">

<img src="assets/banner.svg" alt="Liquid Store">

<a href="https://github.com/technicalnihilist-lgtm/liquid-store/stargazers"><img src="https://img.shields.io/badge/stars-2-5A31F4?style=for-the-badge&logo=github&logoColor=white" alt="stars: 2"></a>&nbsp;<a href="https://github.com/technicalnihilist-lgtm/liquid-store/network/members"><img src="https://img.shields.io/badge/forks-0-3FB950?style=for-the-badge" alt="forks: 0"></a>

<a href="https://github.com/technicalnihilist-lgtm/liquid-store/releases/latest/download/LiquidStore.apk"><img src="https://img.shields.io/badge/DOWNLOAD-APK-6D5AE6?style=for-the-badge&logo=android&logoColor=white" alt="Download APK"></a> <a href="https://technicalnihilist-lgtm.github.io/apps-site/apps/liquid-store.html"><img src="https://img.shields.io/badge/WEBSITE-OPEN-3B82F6?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Website"></a>

<b>Support the work</b>

<img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-COMING%20SOON-4B5563?style=for-the-badge&logo=buymeacoffee&logoColor=white" alt="Buy me a coffee — coming soon"> <img src="https://img.shields.io/badge/UPI-COMING%20SOON-4B5563?style=for-the-badge&logo=googlepay&logoColor=white" alt="UPI — coming soon"> <img src="https://img.shields.io/badge/PayPal-COMING%20SOON-4B5563?style=for-the-badge&logo=paypal&logoColor=white" alt="PayPal — coming soon">

<sub>Donations aren't live yet — Paytm, UPI, PayPal and Buy&nbsp;Me&nbsp;a&nbsp;Coffee all show <b>coming soon</b>. Until then, a ⭐ star is the best support.</sub>

<a href="https://github.com/technicalnihilist-lgtm/liquid-store/releases/latest"><img src="https://img.shields.io/badge/VERSION-v14.5-6D5AE6?style=for-the-badge" alt="VERSION: v14.5"></a> <img src="https://img.shields.io/badge/DOWNLOADS-406-3FB950?style=for-the-badge" alt="DOWNLOADS: 406"> <a href="https://github.com/technicalnihilist-lgtm/liquid-store/releases"><img src="https://img.shields.io/badge/RELEASES-GITHUB-EC4899?style=for-the-badge&logo=github&logoColor=white" alt="RELEASES: GITHUB"></a>

</div>

---

## Download

**[LiquidStore.apk](https://github.com/technicalnihilist-lgtm/liquid-store/releases/latest/download/LiquidStore.apk)** &nbsp;·&nbsp; Android 7.0+ (API 24) &nbsp;·&nbsp; ~193 KB

That link always resolves to the newest release. See
[Releases](https://github.com/technicalnihilist-lgtm/liquid-store/releases) for the
version history.

The APK is signed with a self-generated key rather than a Play Store key, so
Android will ask you to allow "install unknown apps" the first time you open it.

## What it does

- **Live catalogue.** Downloads F-Droid's signed `index-v1.jar` and parses it
  *while it streams*, so the store fills in progressively instead of blocking on
  the whole file. Roughly 4,800 installable apps.
- **Mirror racing.** Ten official mirrors are probed in parallel — including two
  in India (Hyderabad, Delhi) and the Cloudflare CDN — and the download starts on
  whichever answers first, with a short grace period in case a faster one is
  still replying. A mirror that is down costs nothing.
- **Real installs.** APKs are downloaded and their SHA-256 is checked against the
  index before the bytes are handed to Android's `PackageInstaller`. Nothing is
  installed that does not match the repository's own hash.
- **App detail.** Screenshots, licence, author, source-code link, size, version
  and minimum Android version, straight from the index.
- **Saved catalogue.** Later launches open instantly from a local copy, and
  refreshes send `If-Modified-Since` / `ETag` so an unchanged index costs one
  round trip instead of a full download.
- **Real glass, not a blur.** Every floating surface — the tab bar, the lens that
  travels along it, the menu, the toast, the search field, the loader — refracts
  the page behind it through a displacement filter built from the shader's own
  geometry, so the content under the glass bends at the rim the way iOS 26 does.
  This is [LiquidGlass](https://github.com/shayann07/liquidglass) 1.0.0, vendored
  in `web/liquidglass/` and inlined into the page. See [Liquid Glass](#liquid-glass).
- **Light and dark.** Light glass by default, following the system preference, with a
  toggle in the toolbar. Both are driven from the same set of colour tokens.
- **Arcade.** A curated games page — newest first, then the full list.
- **GitHub releases, alongside F-Droid.** A curated list of open-source projects that
  publish their own APK on GitHub is merged into the same catalogue, so they appear in
  search and in the category lists next to everything else. Results are cached for six
  hours to stay well inside GitHub's unauthenticated rate limit, and the asset's SHA-256
  from the GitHub API is verified on install where the project publishes one.
  The list lives in `assets/github_apps.json` - add a repo there to include it.
  It now carries the apps this store is built by as well: 67 of the author's own
  repositories, each one added only because it publishes a signed APK on its
  releases page, alongside 36 third-party projects (103 entries in all). Each
  entry names the icon and the screenshots the project publishes in its own repo
  (`raw.githubusercontent.com/...`), so a GitHub app shows its own artwork and
  not the author's avatar, and its **download count** — the APK assets of the
  release it points at, summed — with the release's version beside it. F-Droid
  publishes no download counts, so an F-Droid app takes Play's install bucket
  instead, labelled **on Play** (`assets/play_installs.json` — Play's number, not
  this store's), and an app that is on neither still shows nothing rather than a
  number nobody measured.
  `assets/github_exclude.json` is the other direction: repos that must never
  appear in this catalogue, whatever the curated list says. They stay on GitHub
  and on other stores; this file only keeps them out of this one.
- **Sources screen.** Pin a specific mirror, or enter your own repository address.
- **No account, no login, no ads.** There is nothing to sign into.

## Screenshots

| Today | Apps | App detail |
| --- | --- | --- |
| ![Today](screenshots/01-today.png) | ![Apps](screenshots/02-apps.png) | ![Detail](screenshots/03-app-detail.png) |

| Arcade | Search | Dark theme |
| --- | --- | --- |
| ![Arcade](screenshots/04-arcade.png) | ![Search](screenshots/05-search.png) | ![Dark](screenshots/06-dark.png) |

| Menu (the three dots) | Black background | Today's rails |
| --- | --- | --- |
| ![Menu](screenshots/07-menu.png) | ![Black](screenshots/08-black.png) | ![Rails](screenshots/09-rails.png) |

| One of the author's apps, with its own icon and screenshots | The dock, away |
| --- | --- |
| ![Age Scanner](screenshots/10-own-app.png) | ![Dock away](screenshots/11-dock-away.png) |

> The screenshots above were captured from the bundled UI running against a
> small demo catalogue, so the app names are placeholders. The interface, layout
> and behaviour are the real ones.

## Liquid Glass

The glass is the [`<liquid-glass>`](https://github.com/shayann07/liquidglass) web
component from **LiquidGlass 1.0.0** (Apache-2.0), bundled to one file and
inlined into `assets/index.html`. Nothing is fetched at runtime and the app stays
offline-first.

Ten surfaces use it, all floating chrome: the navbar, the tab bar, the lens that
slides under the selected tab, the search button, the menu, the toast, the loader
card, the two buttons on the detail page bar and the search field.

All of them are **`variant="clear"`** — Glass.Clear, the material's transparent
variant: a 4% tint with no lift, a wider refraction band than the regular
material (28 dp against 14), dispersion and the rim. The page behind the glass is
seen, not covered; what makes a fully see-through pane still read as glass is the
bend at the rim and the light on the edge. The three surfaces that carry text —
the menu, the toast, the loader — add a 10–18% tint on top so their own labels
still win against the content behind them; set `--lg-menu` and `--lg-panel` to 0
in the stylesheet for a completely bare pane. Each is a
*backplate* — the glass is a child that fills the control's own box from behind —
so no control moved, no hit target changed and no focus order changed.

Two decisions worth knowing:

- **`engine="html"`, never `engine="canvas"`.** The HTML engine refracts the live
  page through an SVG displacement filter in Chromium (every Android WebView this
  app runs in) and frosts elsewhere, for ~78 kB of JavaScript. The canvas engine
  is exact but needs CanvasKit — 7.3 MB of WebAssembly — to draw the same glass in
  an APK that is under 400 kB.
- **Cards, rows and chips keep the cheaper translucency.** They sit under the 3D
  depth transform, and a `backdrop-filter` inside a transformed layer is what
  makes WebView tile and flash. Those surfaces are excluded from the tilt
  instead.

The material has a light and a dark tint chosen from `prefers-color-scheme`, while
this app's Appearance switch writes `data-theme` on `<html>`; a small sync script
hands the resolved scheme to every glass surface so the two never disagree.

Vendored source, licence and the exact rebuild command: [`web/liquidglass/`](web/liquidglass/).

## Building

No Gradle. The build script drives `aapt2`, `javac`, `d8`, `zipalign` and
`apksigner` directly.

You need:

- JDK 17
- Android SDK **build-tools 34** and **platform 34** (`android.jar`)
- `gson-2.10.1.jar` (the index parser)

Point the script at them with environment variables — `JAVA_HOME`, `SDK`, `BT`,
`AJ`, `GSON`, `KEYSTORE`, `KS_PASS`, `OUT` — or drop them at the defaults the
script documents. A keystore is generated on the first build and reused after
that, so updates keep the same signing identity.

```bash
## Layout

```
AndroidManifest.xml
src/com/liquid/store/
  MainActivity.java     WebView host, back handling, external links
  StoreBridge.java      everything the UI may do, exposed as window.Android
  IndexLoader.java      mirror probing, index download and streaming parse
  InstallReceiver.java  PackageInstaller result handling
  AppEntry.java         one catalogue entry
res/values/             strings, colours, theme
res/mipmap-*/           launcher icon (transparent background)
assets/index.html       the entire store UI, one self-contained page
web/liquidglass/        the vendored LiquidGlass web component (Apache-2.0)
assets/fonts/           Plus Jakarta Sans (SIL Open Font License)
```

The UI is a single HTML file. It talks to the native side through
`window.Android`; in a plain browser the same file falls back to a small demo
catalogue, which is how it can be opened and inspected without a device.

## Permissions

| Permission | Why |
| --- | --- |
| `INTERNET` | fetching the index, icons, screenshots and APKs |
| `REQUEST_INSTALL_PACKAGES` | handing a downloaded APK to Android's installer |
| `QUERY_ALL_PACKAGES` | knowing which catalogue apps are already installed |

Installing requires the user to allow "install unknown apps" for this app once;
the store detects that and offers to open the setting.

## Known limitations

- The catalogue is F-Droid, which is free and open-source software only. The
  store deliberately does not carry modified or "premium-unlocked" builds of
  proprietary apps.
- F-Droid's index is large (tens of MB). The first run is a real download; after
  that it is cached.
- The download and install paths have been exercised against local HTTP servers
  and F-Droid's own index fixture, but not yet on physical hardware.

---

---

## 🌍 Languages

<sub>Donations are <b>coming soon</b> in every language below — nothing to pay today, nothing to click.</sub>

<div align="center">

<sub><b>हिन्दी · বাংলা · मराठी · తెలుగు · தமிழ் · ગુજરાતી · ಕನ್ನಡ · മലയാളം · ਪੰਜਾਬੀ · ଓଡ଼ିଆ · অসমীয়া · اردو</b></sub>

</div>

<details>
<summary><b>🌍 Open the same message in 53 languages</b></summary>

**🇮🇳 Indian languages**

- **हिन्दी** (Hindi) — ☕ जल्द ही आ रहा है। · ⭐ अगर आपको यह ऐप और हमारा काम पसंद है, तो कृपया रिपॉजिटरी को स्टार दें और हमें फॉलो करें।
- **বাংলা** (Bengali) — ☕ খুব শিগগিরই আসছে। · ⭐ যদি আপনার এই অ্যাপ এবং আমাদের কাজ ভালো লাগে, তবে অনুগ্রহ করে রিপোজিটরিটিকে একটি স্টার দিন এবং আমাদের ফলো করুন।
- **मराठी** (Marathi) — ☕ लवकरच येत आहे. · ⭐ जर तुम्हाला हे ॲप आणि आमचं काम आवडलं असेल, तर कृपया रिपॉझिटरीला स्टार द्या आणि आम्हाला फॉलो करा.
- **తెలుగు** (Telugu) — ☕ త్వరలో రాబోతోంది. · ⭐ మీకు ఈ యాప్, మా పని నచ్చితే, దయచేసి రిపోజిటరీకి ఒక స్టార్ ఇచ్చి మమ్మల్ని ఫాలో అవ్వండి.
- **தமிழ்** (Tamil) — ☕ விரைவில் வருகிறது. · ⭐ உங்களுக்கு இந்த ஆப்பும் எங்க வேலையும் பிடிச்சிருந்தா, தயவுசெஞ்சு இந்த ரெபாசிட்டரிக்கு ஒரு ஸ்டார்…
- **ગુજરાતી** (Gujarati) — ☕ ટૂંક સમયમાં આવી રહ્યું છે. · ⭐ જો તમને આ એપ અને અમારું કામ ગમતું હોય, તો પ્લીઝ રિપોઝિટરીને સ્ટાર આપો અને અમને ફોલો કરો.
- **ಕನ್ನಡ** (Kannada) — ☕ ಶೀಘ್ರದಲ್ಲೇ ಬರುತ್ತಿದೆ. · ⭐ ನಿಮಗೆ ಈ ಆ್ಯಪ್ ಮತ್ತು ನಮ್ಮ ಕೆಲಸ ಇಷ್ಟವಾದರೆ, ದಯವಿಟ್ಟು ರೆಪೊಸಿಟರಿಗೆ ಸ್ಟಾರ್ ಕೊಡಿ ಮತ್ತು ನಮ್ಮನ್ನು ಫಾಲೋ ಮಾಡಿ.
- **മലയാളം** (Malayalam) — ☕ ഉടൻ വരുന്നു. · ⭐ നിങ്ങൾക്ക് ഈ ആപ്പും ഞങ്ങളുടെ പ്രവർത്തനവും ഇഷ്ടപ്പെട്ടെങ്കിൽ, ദയവായി റെപ്പോസിറ്ററിക്ക് ഒരു സ്റ്റാർ…
- **ਪੰਜਾਬੀ** (Punjabi) — ☕ ਜਲਦੀ ਆ ਰਿਹਾ ਹੈ। · ⭐ ਜੇ ਤੁਹਾਨੂੰ ਇਹ ਐਪ ਅਤੇ ਸਾਡਾ ਕੰਮ ਪਸੰਦ ਹੈ, ਤਾਂ ਕਿਰਪਾ ਕਰਕੇ ਰਿਪੋਜ਼ਟਰੀ ਨੂੰ ਸਟਾਰ ਦਿਓ ਅਤੇ ਸਾਨੂੰ ਫਾਲੋ ਕਰੋ।
- **ଓଡ଼ିଆ** (Odia) — ☕ ଖୁବ୍ ଶୀଘ୍ର ଆସୁଛି। · ⭐ ଯଦି ଆପଣଙ୍କୁ ଏହି ଆପ୍ ଏବଂ ଆମର କାମ ଭଲ ଲାଗୁଛି, ତେବେ ଦୟାକରି ରିପୋଜିଟୋରୀକୁ ଗୋଟିଏ ଷ୍ଟାର୍ ଦିଅନ୍ତୁ ଏବଂ ଆମକୁ ଫଲୋ କରନ୍ତୁ।
- **অসমীয়া** (Assamese) — ☕ অতি সোনকালেই আহি আছে। · ⭐ যদি আপুনি এই এপটো আৰু আমাৰ কাম ভাল পায়, তেন্তে অনুগ্ৰহ কৰি ৰিপজিটৰীটোক এটা ষ্টাৰ দিয়ক আৰু আমাক ফ'ল' কৰক।
- **اردو** (Urdu) — ☕ جلد آرہا ہے۔ · ⭐ اگر آپ کو یہ ایپ اور ہمارا کام پسند آئے تو براہ کرم ریپازٹری کو سٹار دیں اور ہمیں فالو کریں۔
- **संस्कृतम्** (Sanskrit) — ☕ शीघ्रमेव आगच्छति।
- **मैथिली** (Maithili) — ☕ जल्दिये आबि रहल अछि।
- **कोंकणी** (Konkani) — ☕ रोखडेंच येता.
- **کٲشُر** (Kashmiri) — ☕ جَلدی یِوان چھُ۔
- **سنڌي** (Sindhi) — ☕ जल्द अची रह्यो आहे।
- **डोगरी** (Dogri) — ☕ जल्दी आ करदा ऐ।
- **ꯃꯤꯇꯩ ꯂꯣꯟ** (Manipuri) — ☕ ꯑꯊꯨꯕꯥ ꯃꯇꯝꯗꯥ ꯂꯥꯛꯀꯅꯤ꯫
- **बर’** (Bodo) — ☕ थाबैनो फैगोन।
- **ᱥᱟᱱᱛᱟᱲᱤ** (Santali) — ☕ ᱞᱚᱜᱚᱱ ᱦᱤᱡᱩᱜ ᱠᱟᱱᱟ᱾
- **नेपाली** (Nepali) — ☕ छिट्टै आउँदैछ। · ⭐ यदि तपाईंलाई यो एप र हाम्रो काम मन पर्‍यो भने, कृपया रिपोजिटरीलाई स्टार दिनुहोस् र हामीलाई फलो गर्नुहोस्।

**🌍 World languages**

- **العربية** (Arabic) — ☕ قريبًا. · ⭐ إذا أعجبك هذا التطبيق وعملنا، فيرجى منح المستودع نجمة ومتابعتنا.
- **简体中文** (Chinese (Simplified)) — ☕ 即将推出。
- **繁體中文** (Chinese (Traditional)) — ☕ 即將推出。
- **Čeština** (Czech) — ☕ Již brzy.
- **Dansk** (Danish) — ☕ Kommer snart.
- **Nederlands** (Dutch) — ☕ Binnenkort beschikbaar. · ⭐ Vind je deze app en ons werk leuk?
- **Filipino** (Filipino) — ☕ Malapit na.
- **Suomi** (Finnish) — ☕ Tulossa pian.
- **Français** (French) — ☕ Bientôt disponible. · ⭐ Si cette application et notre travail vous plaisent, mettez une étoile au dépôt et suivez-nous.
- **Deutsch** (German) — ☕ Bald verfügbar. · ⭐ Wenn dir diese App und unsere Arbeit gefallen, gib dem Repository einen Stern und folge uns.
- **Ελληνικά** (Greek) — ☕ Έρχεται σύντομα.
- **עברית** (Hebrew) — ☕ בקרוב.
- **Magyar** (Hungarian) — ☕ Hamarosan.
- **Bahasa Indonesia** (Indonesian) — ☕ Segera hadir. · ⭐ Jika kamu suka aplikasi ini dan karya kami, beri bintang pada repositori ini dan ikuti kami.
- **Italiano** (Italian) — ☕ In arrivo.
- **日本語** (Japanese) — ☕ 近日公開。 · ⭐ このアプリと私たちの仕事が気に入ったら、リポジトリにスターを付けてフォローしてください。
- **한국어** (Korean) — ☕ 곧 공개됩니다. · ⭐ 이 앱과 저희 작업이 마음에 드신다면 저장소에 스타를 눌러 주시고 팔로우해 주세요.
- **Bahasa Melayu** (Malay) — ☕ Akan datang.
- **Norsk** (Norwegian) — ☕ Kommer snart.
- **فارسی** (Persian) — ☕ به‌زودی.
- **Polski** (Polish) — ☕ Wkrótce. · ⭐ Jeśli podoba Ci się ta aplikacja i nasza praca, daj repozytorium gwiazdkę i obserwuj nas.
- **Português** (Portuguese) — ☕ Em breve.
- **Română** (Romanian) — ☕ În curând.
- **Русский** (Russian) — ☕ Скоро. · ⭐ Если вам нравится это приложение и наша работа, поставьте звёздочку репозиторию и подпишитесь на нас.
- **Español** (Spanish) — ☕ Muy pronto. · ⭐ Si te gusta esta app y nuestro trabajo, dale una estrella al repositorio y síguenos.
- **Kiswahili** (Swahili) — ☕ Inakuja hivi karibuni.
- **Svenska** (Swedish) — ☕ Kommer snart.
- **ไทย** (Thai) — ☕ เร็ว ๆ นี้
- **Türkçe** (Turkish) — ☕ Çok yakında.
- **Українська** (Ukrainian) — ☕ Незабаром.
- **Tiếng Việt** (Vietnamese) — ☕ Sắp ra mắt. · ⭐ Nếu bạn thích ứng dụng này và công việc của chúng tôi, hãy tặng kho lưu trữ một ngôi sao và theo…

</details>

