<h1 align="center">LiquidGlass</h1>

<p align="center"><b>Liquid Glass for every stack, measured against iOS.</b><br>
Apple's iOS 26 glass for Android, desktop, web, React Native, Flutter and .NET: real refraction of
whatever is behind it, the tab bar whose selection becomes a lens you can drag and throw, and glass
versions of every Material 3 component.</p>

<p align="center">
  <a href="https://central.sonatype.com/artifact/dev.shayxo.liquidglass/liquidglass"><img alt="Maven Central" src="https://img.shields.io/maven-central/v/dev.shayxo.liquidglass/liquidglass?label=Maven%20Central"></a>
  <a href="https://www.npmjs.com/package/@shayxo.dev/liquidglass"><img alt="npm" src="https://img.shields.io/npm/v/@shayxo.dev/liquidglass?label=npm"></a>
  <a href="https://www.nuget.org/packages/LiquidGlass"><img alt="NuGet" src="https://img.shields.io/nuget/v/LiquidGlass?label=NuGet"></a>
  <a href="https://github.com/shayann07/liquidglass/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/shayann07/liquidglass/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://liquidglass.shayxo.dev/"><img alt="Docs" src="https://img.shields.io/badge/docs-liquidglass.shayxo.dev-0a84ff"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
</p>

<p align="center">
  <img src="docs/assets/navigation.gif" width="780" alt="The tab bar: a tapped selector travels as glass, a held selector lifts into a lens, a thrown lens lands against the end of the bar">
</p>
<p align="center"><sub>Rendered by the library (desktop Skia, a deterministic 60 fps replay of a tap, a hold and a throw; shown at 30 fps).</sub></p>

<p align="center"><b><a href="https://liquidglass.shayxo.dev/demo/">Try the live demo in your browser</a></b> ·
<a href="https://liquidglass.shayxo.dev/">Documentation</a> ·
<a href="docs/getting-started.md">Getting started</a></p>

## Pick your stack

| Stack | Install | Guide |
| :-- | :-- | :-- |
| **Compose Multiplatform** (Android, desktop, web) | `plugins { id("dev.shayxo.liquidglass") version "1.0.0" }` | [Getting started](docs/getting-started.md) |
| **Material 3** (Compose) | change the imports, or `./gradlew liquidGlassAdopt` | [Material 3](docs/material3.md) |
| **Web**, any framework | `npm install @shayxo.dev/liquidglass` | [`<liquid-glass>`](docs/web-component.md) |
| **React Native** (Android, web) | `npm install @shayxo.dev/liquidglass-react-native` | [React Native](docs/react-native.md) |
| **Flutter** (Android) | `flutter pub add liquiglass` (first pub.dev upload pending) | [Flutter](docs/flutter.md) |
| **.NET** (WinForms, WPF, Avalonia, MAUI) | `dotnet add package LiquidGlass` + `LiquidGlass.Maui` / `.Wpf` / `.Avalonia` / `.WinForms` | [.NET](docs/native-dotnet.md) |
| **Qt Quick** (QML, C++, PySide6) | `import LiquidGlass` from [`ports/qt`](ports/qt/README.md) | [Qt](docs/qt.md) |
| **Unity** (Built-in, URP) | Package Manager → git URL `…/liquidglass.git?path=/ports/unity/com.shayxo.liquidglass` (not yet run in Unity) | [Unity](docs/unity.md) |

iOS is not a target on any stack: iOS 26 draws Liquid Glass natively.

### Compose: one modifier, SwiftUI's names

```kotlin
LiquidGlassTheme {                       // once, around the app, as MaterialTheme is
    App()
}

Icon(Icons.Default.Edit, null,
    Modifier.size(44.dp).glassEffect(Glass.Regular.interactive(), CircleShape))

GlassEffectContainer(spacing = 20.dp) {  // close pieces melt into one
    Row { /* glassEffect pieces */ }
}

GlassTabBar(itemCount = 3, selectedIndex = selected, onSelected = { selected = it }) { index, isSelected ->
    Tab(index, tint = if (isSelected) Accent else Ink)
}
```

### Material 3: change the imports

```kotlin
import com.wexpa.liquidglass.material3.Scaffold          // was androidx.compose.material3.Scaffold
import com.wexpa.liquidglass.material3.NavigationBar
import com.wexpa.liquidglass.material3.NavigationBarItem
```

<p align="center">
  <img src="review/atlas/showcase-2026-10-19/showcase-scrolled-light.png" width="300" alt="A Material 3 music app in glass, light scheme: glass top bar, segmented control, buttons, chips, a frosted mini player and the floating tab bar over album art">
  <img src="review/atlas/showcase-2026-10-19/showcase-scrolled-dark.png" width="300" alt="The same app, dark scheme">
</p>

### Web, React Native, Flutter, .NET

```html
<!-- after `import '@shayxo.dev/liquidglass'` in your bundle, which registers the element -->
<liquid-glass interactive><button>Back</button><button>Share</button></liquid-glass>
```

```jsx
<Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
  <GlassSurface source={backdrop} x={16} y={height - 100} width={width - 32} height={84} radius={28} dark />
</Canvas>
```

```dart
GlassSurface(radius: 36, dark: true, child: Row(children: icons))   // over a ListView, refracted live
```

```csharp
var bar = new GlassSurface { Backdrop = new GlassBackdrop(rows), Dark = true, Radius = 36, Content = tabs };
```

<p align="center">
  <img src="review/atlas/flutter-2026-10-19/flutter-pixel7-bar-crop.png" width="380" alt="Flutter on a Pixel 7: the dark glass bar refracting a list row">
  <img src="review/atlas/maui-2026-10-20/maui-bar-crop.png" width="380" alt=".NET MAUI on a Pixel 7: the dark glass bar refracting a row of native views">
</p>
<p align="center"><sub>The same material from Flutter (left) and .NET MAUI (right), both on a Pixel 7.</sub></p>

## Why this one

**Measured, not styled.** The material's levels, rim, refraction and the tab bar's motion are fitted
to iOS 26 screen recordings and scored against them, frame by frame, through the real renderer.
Every number says whether it was measured, inherited or authored: [the research
record](docs/research/README.md), [the latest comparison](review/atlas/reference-replay-2026-10-13/README.md).
The motion is close to iOS but **not yet identical**, and the [remaining
differences](review/atlas/reference-replay-2026-10-13/README.md#remaining-differences) are listed.

**One material, every stack.** Compose, the web component, React Native, Flutter and .NET all run the
same production shader, generated from one source and checked against each other in CI.

There are excellent libraries for single stacks, and they may suit you better:

| Library | Stack | What it states |
| :-- | :-- | :-- |
| [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) | Compose Multiplatform | "Compose Multiplatform Liquid Glass effect" |
| [chrisbanes/haze](https://github.com/chrisbanes/haze) | Compose Multiplatform | background blurring |
| [skydoves/Cloudy](https://github.com/skydoves/Cloudy) | Compose Multiplatform | blur and liquid glass, with a CPU fallback |
| [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) | React (web) | "Apple's Liquid Glass effect for React" |
| [callstack/liquid-glass](https://github.com/callstack/liquid-glass) | React Native | iOS 26's native glass, on iOS |
| [liquid_glass_widgets](https://github.com/sdegenaar/liquid_glass_widgets), [liquid_glass_renderer](https://github.com/whynotmake-it/flutter_liquid_glass) | Flutter | shader-based glass widgets |

Their descriptions are quoted from their own repositories (checked 20 October 2026); none of them
is claimed here to lack anything.

## Platforms

| Platform | Status |
| :-- | :-- |
| Android 13+ | Full shader (AGSL). Checked on a Pixel 7 |
| Android below 13 | Tinted fallback with rim lighting; no refraction |
| Desktop JVM | Full shader (Skia). Windows and Linux tested; macOS untested ([help wanted](https://github.com/shayann07/liquidglass/issues/63)) |
| Web, Compose (Wasm) | Full shader (Skia), the same code as desktop ([live demo](https://liquidglass.shayxo.dev/demo/)) |
| Web, any framework | [`<liquid-glass>`](ports/npm/README.md): refracts live HTML in Chromium, frosts elsewhere, or draws the production shaders over a source ([evidence](review/web-component-2026-10-18/README.md)); [CanvasKit port](ports/skia/README.md) |
| React Native | [`GlassSurface`, `GlassLens`](ports/react-native/README.md) on React Native Skia, Android and web ([evidence](review/atlas/react-native-2026-10-19/README.md)) |
| Flutter | [`GlassSurface`](ports/flutter/README.md) over the live backdrop on Impeller, Android ([evidence](review/atlas/flutter-2026-10-19/README.md)) |
| .NET | [SkiaSharp painter and tab bar; WinForms, WPF, Avalonia and MAUI adapters](ports/dotnet/README.md) ([MAUI evidence](review/atlas/maui-2026-10-20/README.md)) |
| Qt Quick | [`GlassSurface`](ports/qt/README.md), a `ShaderEffect` over the live item behind it; rendered offscreen in CI ([evidence](review/atlas/qt-2026-10-20/README.md)) |
| Unity | [Built-in and URP shaders, `GlassSurface`](ports/unity/README.md); shader compiled with FXC and rendered on D3D11 WARP in CI, not yet run in Unity ([evidence](review/atlas/unity-2026-10-20/README.md)) |
| iOS | Not a target: iOS 26 draws Liquid Glass natively |

## Atlas Studio

![Atlas Studio: a magnifier, a top bar, a card and the tab bar over a moving night sky](docs/assets/atlas-sky.jpg)

The demo app, on desktop, Android and [in your browser](https://liquidglass.shayxo.dev/demo/): a
scene that keeps moving under every piece of glass. `./gradlew :desktop:run`.

## Help wanted

The maintainer has one Windows machine and one Android phone. If you have a Mac, a Samsung, Safari, or
a Linux desktop with a real GPU, a ten-minute check helps a lot: see the
[`needs-device` issues](https://github.com/shayann07/liquidglass/issues?q=is%3Aopen+label%3Aneeds-device).
Questions and show-and-tell go in [Discussions](https://github.com/shayann07/liquidglass/discussions).
[Contributing](CONTRIBUTING.md) explains the evidence a change needs.

## License

Apache-2.0: see [LICENSE](LICENSE) and [NOTICE](NOTICE). Not affiliated with or endorsed by Apple.
"Liquid Glass" names the design this resembles. No Apple code, shaders or assets are used; reference
recordings are research material and are not distributed. [Security](SECURITY.md) ·
[Changelog](CHANGELOG.md) · [Limitations](docs/limitations.md)
