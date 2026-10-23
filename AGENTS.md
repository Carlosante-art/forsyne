# Selvitas Design System (2026-04-15 refresh)

This is the verified design language from the four Downloads mockups (selvitas-1210, selvitas-kost, selvitas-traning, selvitas-stripe). **This supersedes the old Cormorant/sage/no-radius system** described in the original CLAUDE.md. All new pages follow this.

## Architecture
- **Mobile-first SPA**: `max-width: 430px`, centered on desktop with dark bg gradient filling the rest.
- **Multi-screen in one file**: screens live as sibling `<div class="screen">` nodes, one has `.active` at a time. `goTo(id)` toggles.
- **Z-stack**: bg(0) → screens(10) → chat-input(20) → bottom-nav(30) → status-bar(40)
- **No scrolling on html/body**; only `.screen.active` scrolls internally.

## Tokens (exact from selvitas-1210.html)

```css
:root{
  /* Primary */
  --iris:#67aac8;
  --iris-a:rgba(103,170,200,.14);
  --iris-b:rgba(103,170,200,.07);

  /* Surface */
  --bg:#04060a;
  --glass:rgba(4,6,10,.46);
  --glass2:rgba(4,6,10,.68);
  --glass3:rgba(4,6,10,.94);

  /* Borders */
  --b0:rgba(168,194,204,.04);
  --b1:rgba(168,194,204,.09);

  /* Text */
  --t0:#e0eaee;                       /* 100% */
  --t1:rgba(224,234,238,.6);          /* 60% */
  --t2:rgba(224,234,238,.34);         /* 34% */
  --t3:rgba(224,234,238,.14);         /* 14% */

  /* Accents (semantic) */
  --cw:#c49060;  /* warn orange */
  --cd:#c06060;  /* danger red */
  --cg:#5cb88a;  /* good green */

  /* Category colors (insight dots, per-insight) */
  --cat-sleep:#c06060;       /* sleep/red */
  --cat-glucose:#67aac8;     /* glucose/iris */
  --cat-dna:#a78bfa;         /* dna/purple */
  --cat-nutrition:#5cb88a;   /* nutrition/green */

  /* Typography */
  --sans:'Syne',sans-serif;
  --mono:'Syne Mono',monospace;
  --serif:'Instrument Serif',Georgia,serif;

  /* Layout */
  --nav-h:72px;
  --sb-h:44px;
  --app-max:430px;
}
```

## Google Fonts link

```html
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700&family=Syne+Mono&family=Instrument+Serif:ital,wght@0,300;0,400;1,300;1,400&display=swap" rel="stylesheet">
```

## Typography rules
- **Serif (Instrument Serif)** = system voice, insight headlines, statements. Italic for emotional weight.
- **Sans (Syne)** = UI text, bubble body, buttons.
- **Mono (Syne Mono)** = metadata, labels, numeric values, timestamps, eyebrows. Letter-spacing `.06em`–`.22em`, uppercase.
- Base font-size: **13px** (mobile). Don't scale up on desktop — the app stays 430px wide.

## Core layout skeleton

```html
<body>
  <div class="bg">...gradient background image / veil...</div>

  <div class="sb"> <!-- status bar, 44px -->
    <div class="sb-t">09:42</div>
    <div class="sb-r">icons</div>
  </div>

  <div class="screens">
    <div class="screen active" id="sh">...home...</div>
    <div class="screen" id="st">...training...</div>
    <div class="screen" id="sk">...nutrition...</div>
    <div class="screen" id="sj">...journal...</div>
    <div class="screen" id="sp">...profile...</div>
  </div>

  <div class="ci-wrap">...chat input...</div>   <!-- z:20 -->
  <nav class="bn">...bottom nav + FAB...</nav>  <!-- z:30 -->
</body>
```

Body CSS:
```css
html,body{height:100%;overflow:hidden;background:var(--bg)}
body{
  color:var(--t0);
  font-family:var(--sans);
  font-size:13px;
  display:flex;flex-direction:column;
  max-width:430px;margin:0 auto;
  position:relative;
}
```

## Components

### Status bar (`.sb`)
- 44px tall, flex space-between, iOS-style
- `.sb-t` time: font-family mono, 12px, bold, `--t0`
- `.sb-r` right icons: signal/wifi/battery

### Top bar with wordmark + live pip
- Wordmark "Selvitas" in mono, uppercase, `--t2` color, `.22em` letter-spacing
- Live pip: 6px iris circle with pulsing box-shadow keyframe
- Keyframe: `0%,100%{opacity:.5;box-shadow:0 0 3px var(--iris)} 50%{opacity:1;box-shadow:0 0 10px var(--iris)}`

### Rotating insight cycle (`.insight-cycle`)
- 4 items rotating every 5s via setInterval
- Each `.insight-item` has:
  - `.ins-context` row: colored dot (`#c06060|#67aac8|#a78bfa|#5cb88a`) + metadata text
  - `.ins-headline` serif italic, large, up to 40px line-height 1.15
- Rotation logic: add/remove `.visible` class, opacity + translate transition
- 4 dots below as position indicator; active dot becomes 16px bar (iris), others 4px circles (`--t3`)

### Prediction block ("Selvitas förutspår · 84% · [time]")
- Vertical gradient line on the left: `linear-gradient(to bottom, var(--iris), transparent)`
- Eyebrow mono text 8px `.06em` iris
- Serif italic body, 15px, `--t0`
- Confidence mono 15px bold iris

### Raw data grid (`.cg` in mockup)
- `display: grid; grid-template-columns: 1fr 1fr; gap: 10px`
- Each card: `background:var(--glass); backdrop-filter:blur(16px); border:1px solid var(--b0); border-radius:14px; padding:14px 16px`
- Flex row: label (sans 12px bold `--t0`) + value (mono 15px bold in category color)

### Chat bubbles (`.mw`, `.bub`)
- `.mw` wrapper, `.mw.u` = user, default = AI
- Avatar `.mav`: 36px circle, iris border
- Sender label `.msg-sender`: mono 9px uppercase `.16em` iris
- Bubble `.bub`:
  - max-width 84%, padding 13px 15px, font-size 14px, line-height 1.72
  - AI: glass2 background, left-aligned, border-radius varies (editorial)
  - User: iris-a background, border 1px rgba(103,170,200,.18), border-radius `18px 4px 18px 18px`
  - `strong` → `--t0` weight 600, `em` → iris color, not italic

### Chat input (`.ci-wrap`)
- Fixed bottom above bottom-nav, glass3 background, blur 24px, top border `--b0`
- Textarea: no border, transparent, resize none, max-height 80px
- Send button: 34px iris circle, 50% radius, SVG arrow in `#04060a`

### Starter chips (`.st`)
- Small pill buttons below chat entry
- border 1px `--b1`, padding 6px 12px, mono 10px uppercase, `--t1`
- `:active` → iris-a background, `--t0` color

### Bottom navigation (`.bn`)
- 72px fixed bottom, glass3 background, blur 24px, top border `--b0`
- 5 nav buttons + 1 FAB in the middle (Selvitas avatar)
- `.nb` button: flex column, 40px width, mono 8px label, `--t2` color
- `.nb.on` active: `--t0` color, top underline bar 18×2px iris
- `.fab` Selvitas avatar: 56px, 50% radius, iris border, absolute top:-6px, box-shadow

### CTA buttons (`.cta-primary`)
- padding 14px 24px, iris-a background, border 1px rgba(103,170,200,.22) iris
- mono 11px `.12em` uppercase, `--t0` color
- border-radius 12px
- `:active` → rgba(103,170,200,.22) background

## Animations
- All `ease`, never `linear`
- Pulse durations 2–2.5s
- Rotate durations 0.4s for chat entry, 0.5–0.6s for section reveals
- Typing dot: `pd` keyframe scale 0→5px box-shadow spread

## Swedish copy snapshot (for reference)

### Home (selvitas-1210)
- Wordmark: `Selvitas`
- Insight 0 (red/sleep): context "Sömn · 4:12h" headline "Vila vinner idag — din kropp är under baseline"
- Insight 1 (iris/glucose): glucose crash prediction
- Insight 2 (purple/dna): genetic context
- Insight 3 (green/nutrition): food pattern
- Prediction: "Selvitas förutspår · 84% · Söndag kväll"
- Chat starters: "Vad ska jag äta?", "Kan jag träna?", "Hur är min dag?"

### Training (selvitas-traning)
- Header: "Vecka 14 · Cut-fas · Maraton 4 juli"
- Decision card: HRV 38ms −18%, Sleep 4h 12m → "Anpassa passet idag"
- Workout: "Överkropp · Lätt · 45 min · 60% vikter"

### Nutrition (selvitas-kost)
- Header: "Onsdag 15 april · 3 veckor till semester · Cut-fas"
- Macros: 1840 kcal loggat, 2600 mål, 760 kvar
- Meals logged: Frukost 620, Lunch 720, Mellanmål 500, Middag 760 kvar

### Stripe
- Identical to home in current mockup (no payment flow visible) — **must be rebuilt with real paradigm-selling content**

## Non-negotiable build rules
1. `ease` only, never `linear`
2. Loading = dot-pulse typing indicator, never spinner
3. Mono for numbers, labels, eyebrows
4. Serif italic for system voice
5. Glass cards use `backdrop-filter: blur(16–24px)` — must also set `-webkit-backdrop-filter` for Safari
6. Category colors (red/iris/purple/green) are SEMANTIC — red = sleep/warning, iris = glucose, purple = DNA, green = nutrition
7. Describe state, don't prescribe action (Selvitas positioning rule)
8. Never hide the 84% confidence — it's the core moat

## Migration note
The existing 40-page desktop codebase uses Cormorant/Jost/sage — the **old** design system. Pages that keep functioning in the old system: landing.html, login.html, disclaimer.html, confirm.html, email_confirm.html, reset.html (auth/marketing — don't need to match). Everything else gets ported to the new system.
