# 🕯️ VITA — Forgotten Sector
> *A high-octane retro cyberpunk & cosmic horror survival roguelite engineered with 100% procedural Canvas graphics and synthesized WebAudio — zero external asset dependencies.*

[![Platform](https://img.shields.io/badge/Platform-Web%20(HTML5%20Canvas)-orange)](index.html)
[![Language](https://img.shields.io/badge/Language-JavaScript%20(ES6+)-blue)](js/game.js)
[![Zero External Assets](https://img.shields.io/badge/Assets-100%25%20Procedural-red)](index.html)
[![PWA Ready](https://img.shields.io/badge/PWA-Network--First%20Offline-brightgreen)](sw.js)
[![Database](https://img.shields.io/badge/Database-Supabase%20%2F%20PostgreSQL-3ECF8E)](supabase_schema.sql)
[![Tests](https://img.shields.io/badge/Tests-Passing%20(9%2F9%20QA)-success)](tests/)

---

## 📖 Project Overview

**VITA** is a web game engine showcase demonstrating cutting-edge browser game engineering without any external assets (v2.0 Web-only; Desktop Pygame retired):

1. **Web Edition ([index.html](file:///c:/Users/user/Desktop/pengenal%20web/vita/index.html) + [js/game.js](file:///c:/Users/user/Desktop/pengenal%20web/vita/js/game.js))**:
   - 15 labyrinth sectors running on a hardware-accelerated HTML5 Canvas 2D engine.
   - High-performance **Breadth-First Search (BFS) Pathfinding** with pre-allocated shared typed array buffers (zero garbage collection stuttering).
   - Real-time procedural sound synthesizer using the **WebAudio API** (`OscillatorNode`, `BiquadFilterNode`, `GainNode`).
   - Modular weapon arsenal (Tactical Knife, AP Combat Rifle, EMP Bio-Grenade, Heavy Bazooka, Kinetic Shield, Vulcan Minigun) and post-sector cybernetic augmentations.
2. **Command Operations Hub ([index.html](file:///c:/Users/user/Desktop/pengenal%20web/vita/index.html) + [js/home.js](file:///c:/Users/user/Desktop/pengenal%20web/vita/js/home.js))**:
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
- **Procedural Bestiary**: All 12 creature classes (*Slime, Bat, Crawl, Ghost, Harvester, Dark Knight, Dragon, Lich, Beholder, Mimic, Apex Stalker, and The Monolith*) feature procedural Canvas geometry, pulsating cores, dynamic wing flapping cycles, and particle emitters.
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

### Node Tooling (stdlib only, zero install)

```powershell
npm run check   # syntax + global-scope + i18n parity + secret scan
npm test        # web security & input validation audit
npm run icons   # regenerate PWA icons (pure Node, reproducible)
npm run bump -- 2.1.0  # sync version.json, sw.js, index.html, APP_VERSION
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
├── package.json            # Node scripts (dev/check/test/icons/bump, stdlib only)
├── tools/                  # Node stdlib tooling (serve, check, gen-icons, bump-version)
│   ├── serve.mjs           # Static dev server (http, no-store version.json)
│   ├── check.mjs           # Syntax + scope + i18n parity + secret scan
│   ├── gen-icons.mjs       # Reproducible PWA icon generator (fs+zlib only)
│   └── bump-version.mjs    # Single-command release version sync
├── css/
│   ├── tokens.css          # Industrial design tokens (colors, type, motion)
│   ├── home.css            # Cyberpunk hub terminal styling (scoped #homeView)
│   └── game.css            # In-game HUD, floating biometrics, and modal styling
├── js/
│   ├── home.js             # Hub logic: particle embers, operative dossiers, auth
│   ├── game.js             # Core game engine (Canvas renderer, BFS AI, WebAudio, touch)
│   ├── prologue.js         # Narrative compendium (prologue/transmissions/lore/epilogue)
│   └── supabase.js         # REST client for Supabase cloud leaderboards & dossiers
├── supabase_schema.sql     # PostgreSQL schema, check constraints, and RLS policies
├── tests/                  # Automated test suites
│   └── test_web_security_qa.js # 9-module QA audit (XSS, avatars, BFS anti-softlock, brightness, dialog a11y)
├── AGENTS.md               # Technical rules & architecture documentation for AI agents
└── README.md               # [This File] Primary portfolio documentation
```

---

## 🧪 Automated Testing & Verification

Run the automated test suites to ensure complete integrity:

```powershell
# 1. Unified check (syntax + scope + i18n + secrets)
npm run check

# 2. Run Web Security & Input Validation Audit
npm test
```

---

## 🛡️ License

Developed by [Rifky / Dev Team]. Open source and available for portfolio review and personal demonstration.
