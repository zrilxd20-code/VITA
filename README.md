# 🕯️ VITA — Forgotten Sector
> *A high-octane retro cyberpunk & cosmic horror survival roguelite engineered with 100% procedural Canvas graphics and synthesized WebAudio — zero external asset dependencies.*

[![Platform](https://img.shields.io/badge/Platform-Web%20(HTML5%20Canvas)-orange)](index.html)
[![Language](https://img.shields.io/badge/Language-JavaScript%20(ES6+)-blue)](js/game.js)
[![Zero External Assets](https://img.shields.io/badge/Assets-100%25%20Procedural-red)](index.html)
[![PWA Ready](https://img.shields.io/badge/PWA-Network--First%20Offline-brightgreen)](sw.js)
[![Database](https://img.shields.io/badge/Database-Supabase%20%2F%20PostgreSQL-3ECF8E)](supabase_schema.sql)
[![Tests](https://img.shields.io/badge/Tests-Passing%20(29%2F29%20QA)-success)](tests/)
[![Android](https://img.shields.io/badge/Android-APK%20via%20GitHub%20Actions-3DDC84)](.github/workflows/android.yml)

---

## 📖 Project Overview

**VITA** is a web game engine showcase demonstrating cutting-edge browser game engineering without any external assets (v2.0 Web-only; Desktop Pygame retired):

1. **Web Edition** ([index.html](index.html) + [js/game.js](js/game.js) + [css/game.css](css/game.css)):
   - 15 labyrinth sectors running on a hardware-accelerated HTML5 Canvas 2D engine.
   - High-performance **Breadth-First Search (BFS) Pathfinding** with pre-allocated shared typed array buffers (zero garbage collection stuttering).
   - Real-time procedural sound synthesizer using the **WebAudio API** (`OscillatorNode`, `BiquadFilterNode`, `GainNode`).
   - Modular weapon arsenal (Tactical Knife, AP Combat Rifle, EMP Bio-Grenade, Heavy Bazooka, Kinetic Shield, Vulcan Minigun) and post-sector cybernetic augmentations.
2. **Command Operations Hub** ([index.html](index.html) + [js/home.js](js/home.js) + [css/home.css](css/home.css)):
   - Single-Page Application (SPA) CRT terminal hub featuring floating ember particle physics, scanlines, responsive 3D tilt cards, operative dossier registration, and live cloud telemetry.

---

## 🎮 Controls & Field Protocol

| Action | Keyboard / Mouse | Mobile Touch Controls |
| :--- | :--- | :--- |
| **Movement** | `W`, `A`, `S`, `D` or Arrow Keys (`↑`, `←`, `↓`, `→`) | Virtual Left Thumbstick |
| **Attack** | `Spacebar` or `Left Mouse Click` (aims toward crosshair) | On-screen Fire Button (auto-targets nearest foe) |
| **Phase Dash** | `Shift` (invulnerable burst through traps & projectiles) | On-screen Dash Button |
| **Switch Weapons** | Number Keys `1`–`6`, `Q`, `E`, or Mouse Scroll Wheel | Weapon Selector Bar |
| **Pause Mission** | `Escape` | Pause Button |
| **Objective** | Salvage all luminous biomass artifacts, then extract via the green **SECTOR AIRLOCK**. | — |

---

## 🌟 Technical Highlights & Engineering Feats

### 1. 100% Zero External Asset Dependencies
Every visual element and sound effect is synthesized at runtime:
- **Procedural Bestiary**: All 12 creature classes (*Slime, Bat, Crawl, Ghost, Harvester, Dark Knight, Dragon, Lich, Beholder, Mimic, Final Boss, and The Monolith*) — plus the Sektor 10 apex boss *Mother Harvester* — feature procedural Canvas geometry, pulsating cores, dynamic wing flapping cycles, and particle emitters.
- **Synthesized Audio**: Sound effects (footsteps, knife slashes, rifle recoils, bazooka detonations, kinetic shield hums, monster shrieks, heartbeat alerts) are programmatically generated via mathematical sine/sawtooth frequency modulation in the WebAudio API (`OscillatorNode`, `BiquadFilterNode`, `GainNode`).

### 2. High-Performance BFS AI & Boids Separation
- Monsters pathfind towards the operative across complex labyrinth grids using Breadth-First Search.
- Avoids runtime garbage collector stalls by pre-allocating static buffer arrays (`bfsPrev`, `bfsQueue`).
- Integrates separation repulsion vectors to prevent enemy sprite stacking in corridors.

### 3. Alternating Tactical Lighting Protocols
- **☀️ Light Protocol (Odd Sectors)**: Full facility visibility; higher monster speed and heightened enemy aggression.
- **🌙 Dark Protocol (Even Sectors)**: Constrained vision cone with dynamic torchlight radial falloff and real-time Fog of War, rewarding tactical stealth.

### 4. Global Cloud Telemetry & Offline PWA
- **Supabase Cloud REST API**: Global cross-platform leaderboard and operative dossier synchronization protected with PostgreSQL Row Level Security (RLS).
- **Offline Progressive Web App (PWA)**: Registered Service Worker (`sw.js`) provides instant offline gameplay with network-first runtime updates.
- **In-App Auto-Update Pipeline**: Automatically notifies operatives of new engine builds via `version.json` polling.

### 5. Bilingual System (i18n)
- Native bilingual support for **English** and **Bahasa Indonesia** with real-time switching across the web hub, in-game HUD, and operational modals.
- Enforced at build-check time: `tools/check.mjs` asserts **two-way key parity** between the `id`/`en` dictionaries and verifies every `tt()` / `data-i18n` token resolves, so a missing translation fails CI before it can ship.

### 6. Performance-First HUD (60 Hz Frame Budget)
- The render loop treats DOM work as the expensive operation it is: a memoized element cache (`hudEl()` — validated via `isConnected`) removes repeated `getElementById` lookups from `gameLoop()` / `updateUI()` / `renderWeaponHUD()`.
- `setHudText()` elides redundant text writes, and HP-bar tiers, boss-bar widths, and weapon-cooldown fills are **change-detected**, keeping layout/style recalculation off the per-frame critical path.
- Hot AI counters use simple count loops instead of allocating a fresh array every frame, complementing the shared BFS buffers.

### 7. Accessibility & Keyboard Operability
- Operational dialogs (device mode, lore, codex, settings) expose **ARIA** `role="dialog"` / `aria-modal` semantics, a Tab focus trap, and focus restoration on close.
- Non-native interactive controls (device cards, start-screen blocks) are keyboard-reachable via `role="button"` + `tabindex="0"` (with `aria-pressed` state) and activate on **Enter/Space**.
- Visible `:focus-visible` rings are provided for both the hub (orange) and in-game HUD (cyan) themes.

---

## 🚀 Quickstart & How to Run

### Web Edition (Instant Play)
Serve over **http** (required for Service Worker + PWA):

```powershell
npm run dev
# → http://localhost:8000
```

Or any static server (`npx serve .`, `python -m http.server 8000`).
`version.json` is served `no-store` so in-app update polling never sees stale cache.

### Online Co-op (Host-Authoritative, up to 4 Players)

The campaign supports online co-op over a relay. The relay is a **zero-dependency Node
stdlib WebSocket server** (`tools/relay.mjs`, RFC 6455 handshake + frame codec) — no
`ws` package, no install. Peer 0 (the host) is authoritative: it owns the simulation and
streams 20 Hz snapshots; joiners send inputs and reconcile with client prediction.

```powershell
# Terminal 1 — static game server
npm run dev      # → http://localhost:8000

# Terminal 2 — co-op relay (default ws://localhost:8080)
npm run relay    # or: npm run relay -- --port 8080
```

Then, with the game open in **two or more browser tabs/devices**:

1. **Host:** open the Co-op lobby → **Host Room** → note the generated 4-character code → wait for peers → **Start Mission**.
2. **Joiner(s):** open the Co-op lobby → **Join** tab → type the code (e.g. `7X49`) → **Connect to Squad**.

Notes & troubleshooting:

- The relay URL is set in the Co-op lobby's **Relay address** field (persisted to
  `localStorage['vita_relay_url']`). Precedence: lobby field → stored override → default
  `ws://localhost:8080`. You can also set it directly:
  `localStorage.setItem('vita_relay_url', 'wss://<host>')`.
- **Invite links:** the host lobby shows a shareable link (`…/?coop=CODE&relay=…`). Opening it
  auto-fills the code (and relay, when non-local) and jumps straight to the **Join** tab.
- Browsers block `ws://` from an `https://` page (mixed content). Serve both the game and
  relay over `http://` for local play, or put the relay behind TLS (`wss://`) for production
  (the client auto-upgrades `ws://` → `wss://` on an `https://` page).
- Co-op **requires the relay process to be running** — without it the lobby shows a
  connection error and no peers can join.

### Deploying the Relay Online (`wss://`)

The relay is deploy-ready with **zero build step and zero dependencies**:

```powershell
# Option A — Docker (any host)
docker build -t vita-relay .
docker run --rm -p 8080:8080 -e PORT=8080 vita-relay

# Option B — Render Blueprint (render.yaml in this repo)
#   Render Dashboard → New → Blueprint → select repo → Apply
#   → yields wss://<service>.onrender.com, paste it into the lobby's Relay address field.

# Option C — any Node host
PORT=8080 node tools/relay.mjs
```

Host the static front-end anywhere (e.g. `vercel.json` is included for Vercel). Because the
game is served over `https://` in production, the relay must be reachable over `wss://`
(Render/`render.yaml` and the bundled `Dockerfile` both give you that automatically).

### Android APK (Capacitor, built in GitHub Actions)

The same HTML5 build ships as a native Android app via **Capacitor**. The `android/` project is
committed with the app identity (`com.zrilxd20.vita`, label **VITA**) and procedurally generated
launcher icons/splash already in place, so CI only has to compile.

- **No local toolchain needed.** `.github/workflows/android.yml` runs on `ubuntu-latest` with
  Node 22 + JDK 21 + the Android SDK, then uploads the debug APK as the **`vita-debug-apk`**
  artifact (Actions → *VITA Android APK* → newest run → Artifacts). The job fails instead of
  passing silently if no APK is produced.
- **Preview:** Actions → *VITA Android APK* → **Run workflow**.
- **Locally (only if you have JDK 21 + Android SDK):** `npm run apk:debug` → APK at
  `android/app/build/outputs/apk/debug/app-debug.apk`.

**Co-op from the APK:** the WebView origin is `https://localhost`, so the client upgrades every
`ws://` address to `wss://` — use the **Cloudflare tunnel** (or any TLS relay), not a plain LAN
`ws://` address. Invite links (`?coop=…`) are not usable inside the APK (they resolve to
`https://localhost`); type the 4-character room code instead.

Capacitor is a **devDependency only** — it is never bundled into the web app, so the shipped
game keeps its zero-runtime-dependency guarantee (`npm test` enforces this).

### Node Tooling (stdlib only, zero install)

```powershell
npm run check   # syntax + global-scope + i18n parity & coverage + secret scan + manifest & HTML checks
npm test        # 29-module web security, QA & packaging audit
npm run relay   # zero-dependency WebSocket co-op relay server
npm run icons   # regenerate PWA icons (pure Node, reproducible)
npm run icons:android  # regenerate Android launcher icons + splash (same procedural art)
npm run build:www      # build dist/ web bundle (explicit runtime whitelist)
npm run cap:sync       # copy dist/ into the Capacitor Android project
npm run apk:debug      # local debug APK (requires JDK 21 + Android SDK)
npm run bump -- 2.5.0  # sync version.json, sw.js, index.html, APP_VERSION
```

---

## 📁 Repository Map

```
vita/
├── index.html              # Unified SPA: Terminal Command Hub + Game Engine Canvas
├── manifest.webmanifest    # Progressive Web App (PWA) manifest configuration
├── sw.js                   # Service Worker (network-first with offline cache fallback)
├── icon.svg                # Procedural SVG vector icon
├── version.json            # Release version (PWA update polling)
├── package.json            # Node scripts (dev/relay/check/test/icons/bump, stdlib only)
├── tools/                  # Node stdlib tooling (serve, relay, check, gen-icons, bump-version)
│   ├── serve.mjs           # Static dev server (http, no-store version.json)
│   ├── relay.mjs           # Zero-dependency WebSocket co-op relay (RFC 6455 handshake + frame codec)
│   ├── check.mjs           # Syntax + scope + i18n parity & coverage + secret scan
│   ├── check_html.cjs      # HTML well-formedness (unclosed-tag) verification
│   ├── gen-icons.mjs       # Reproducible PWA icon generator (fs+zlib only)
│   ├── gen-android-icons.mjs # Android launcher icons + dark splash (reuses gen-icons art)
│   ├── gen-desktop-icons.mjs # Desktop launcher icons (.ico, multi-dim PNGs, reuses gen-icons art)
│   ├── build-www.mjs       # dist/ builder — explicit runtime whitelist, no repo metadata
│   └── bump-version.mjs    # Single-command release version sync
├── .github/workflows/
│   ├── ci.yml              # CI pipeline: npm run check + npm test on push/PR
│   ├── android.yml         # Cloud APK build (JDK 21 + Android SDK) → artifact vita-debug-apk
│   └── desktop.yml         # Cloud Windows Desktop build (Tauri + Rust) → artifact vita-windows-x64
├── capacitor.config.json   # Capacitor shell config (appId, webDir=dist, androidScheme=https)
├── android/                # Committed Capacitor Android studio project (icons/splash themed)
├── src-tauri/              # Committed Tauri Windows desktop project (native WebView2 runtime)
├── Dockerfile              # Minimal relay image (node:20-alpine, COPY relay only, USER node)
├── .dockerignore           # Whitelist: only tools/relay.mjs enters the build context
├── render.yaml             # Render Blueprint: free-tier Node relay (auto-deploy + health check)
├── vercel.json             # Vercel front-end deploy config (security headers)
├── LICENSE                 # MIT license
├── css/
│   ├── tokens.css          # Industrial design tokens (colors, type, motion)
│   ├── home.css            # Cyberpunk hub terminal styling (scoped #homeView)
│   └── game.css            # In-game HUD, floating biometrics, and modal styling
├── js/
│   ├── home.js             # Hub logic: particle embers, operative dossiers, auth
│   ├── game.js             # Core game engine (Canvas renderer, BFS AI, WebAudio, touch)
│   ├── prologue.js         # Narrative compendium (prologue/transmissions/lore/epilogue)
│   ├── supabase.js         # REST client for Supabase cloud leaderboards & dossiers
│   └── modules/            # [Experimental/Roadmap] Standalone TypeScript modules (refactor prep)
├── script.md               # Narrative script, characters, and dialogue canon
├── supabase_schema.sql     # PostgreSQL schema, check constraints, and RLS policies
├── tests/                  # Automated test suites
│   └── test_web_security_qa.js # 29-module QA audit (XSS, avatar, callsign, corrupt-data recovery, level bounds, Supabase schema, BFS anti-softlock, Hub brightness, dialog & keyboard a11y, i18n coverage, hub loop perf & reduced-motion, async status live regions, game loop error boundary, robot memory modal interaction, seeded deterministic world for online co-op, simulation vs render decoupling for host-authoritative architecture, multi-player abstraction via players[] & host index 0, snapshot state serialization & reconciliation for host-authoritative relay, co-op lobby UI & native WebSocket transport relay, procedural Hub logo lockup with consistent in-game menu titles (start/pause/death/win) & reduced-motion guard, zero-dependency relay protocol contract & client wiring, co-op relay address normalization & invite-link parsing/building, relay deploy artifacts (Docker/Render) & MIT license contract, Android/Capacitor packaging contract, PC Desktop/Tauri Windows packaging contract)
├── AGENTS.md               # Technical rules & architecture documentation for AI agents
└── README.md               # [This File] Primary portfolio documentation
```

---

## 🧪 Automated Testing & Verification

Run the automated test suites to ensure complete integrity:

```powershell
# 1. Unified check (syntax + scope + i18n + secrets)
npm run check

# 2. Run the 29-module Web Security, QA & Packaging Audit
npm test
```

---

## 🛡️ License

Released under the **MIT License** — see [LICENSE](LICENSE).

Developed by [Rifky / Dev Team]. Open source and available for portfolio review and personal demonstration.

---

## 📌 Catatan Rilis, Alur Navigasi, Desain Logo, & Kompilasi Cloud Otomatis

1. **Alur Masuk Game Konsisten (Hub ➔ Layar Mulai / Tactical Archives)**:
   - Menekan tombol **ENTER THE LABYRINTH** pada Hub utama (`#homeView`) **selalu** membawa pemain ke Menu Layar Mulai (`#startScreen`) terlebih dahulu.
   - Di layar ini pemain dapat memilih direktif: **PLAY NOW**, **OPERASI CO-OP**, **CONTINUE**, **LOGIN / PROFILE**, **SETTINGS**, **CODEX**, atau **ADMIN & CHAPTER SELECT**. Game tidak akan langsung meluncur ke kanvas tanpa persetujuan pemain.
   - Pilihan mode game (*Kampanye 15 Sektor* vs *Arena Survival Horde*) yang dipilih di Hub akan otomatis dijalankan saat tombol **PLAY NOW** ditekan di Layar Mulai.

2. **Identitas Visual Logo VITA Konsisten di Seluruh Menu**:
   - Seluruh menu utama (Hub, Layar Mulai, Jeda In-Game, Gugur/Game Over, & Kemenangan) menggunakan lockup logo resmi VITA:
     - **Emblem Heksagonal Isometrik**: Cincin heksagon kontainmen dengan monogram "V" berpendar merah neon serta titik inti anomali putih menyala.
     - **Wordmark VITA 3D**: Tipografi tebal merah tua dengan ekstrusi rim light bertingkat dan bayangan jatuh atmosferik.
     - **Subtitle FORGOTTEN SECTOR**: Spasi huruf tegas (*letter-spacing 12px*) dengan pendar merah penahan anomali.

3. **Kompilasi Otomatis Cloud Dual-Platform (GitHub Actions)**:
   - Setiap kali terjadi `git push` ke branch `main`, GitHub Actions langsung mengompilasi biner native secara otomatis tanpa memerlukan SDK lokal:
     - **Android APK (`vita-debug-apk`)**: Menggunakan Capacitor + JDK 21 + Gradle (waktu build ~1,5 menit).
     - **Windows Desktop PC (`vita-windows-x64`)**: Menggunakan Tauri 1.5 + Rust stable + WebView2 runtime menghasilkan installer `.msi` dan `.exe` mandiri (waktu build ~3–5 menit karena kompilasi native biner Rust).
   - Artifact yang dihasilkan siap diunduh langsung dari tab **Actions** di repositori GitHub.

4. **Sistem Notifikasi & Pengecekan Update Otomatis (In-App)**:
   - Aplikasi yang terpasang (PWA Web, Windows PC, APK Android) otomatis membaca versi terbaru dari cloud endpoint / GitHub `version.json`.
   - Tersedia tombol **[ ↻ CEK PEMBARUAN ]** di menu *Facility Settings* (`checkVitaUpdateManual()`) untuk memeriksa ketersediaan pembaruan kapan saja secara instan.
   - Header CORS telah dipasang di `vercel.json` sehingga WebView native tidak lagi terhalang oleh security browser saat memeriksa rilis baru.

5. **Kontrol Sentuh Murni di HP (Pure Virtual Joystick & Action Buttons)**:
   - Saat mode kontrol HP (`touch-on`) aktif, crosshair bidikan mouse otomatis dinonaktifkan.
   - Ketukan acak di kanvas tidak akan memicu serangan klik sintetis. Arah dan penyerangan murni dikendalikan oleh analog virtual joystick dan tombol aksi taktis di layar.
