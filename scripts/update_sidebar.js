// update_sidebar.js — kör från self-dev-ai/:
// node scripts/update_sidebar.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const PAGES = [
  'analys.html','biologi.html','checkin.html','coach.html',
  'dashboard.html','dna.html','energy.html','journal.html',
  'kostlogg.html','kostracking.html','nutrition.html','profile.html','profilering.html',
  'signal.html','sleep.html','stress.html','systemkarta.html',
  'training.html','wearables.html'
];

// ── Ny sidebar HTML ──
const NEW_SIDEBAR = `<aside class="sidebar">
  <div class="ng">
    <div class="ngl">Idag</div>
    <a class="nl" href="dashboard.html">Dashboard</a>
    <a class="nl" href="checkin.html">Check-in</a>
    <a class="nl signal-link" id="nav-signal" href="signal.html">Signalen</a>
  </div>
  <div class="ng">
    <div class="ngl">Mönster</div>
    <a class="nl" href="sleep.html">Sömn</a>
    <a class="nl" href="energy.html">Energi</a>
    <a class="nl" href="stress.html">Stress</a>
    <a class="nl" href="training.html">Träning</a>
    <a class="nl" href="kostlogg.html">Måltidslogg</a>
    <a class="nl" href="nutrition.html">Kost</a>
    <a class="nl" href="wearables.html">Wearables</a>
  </div>
  <div class="ng">
    <div class="ngl">Biologi</div>
    <a class="nl" href="biologi.html">Biomarkörer</a>
    <a class="nl" href="dna.html">DNA</a>
    <a class="nl" href="journal.html">Journal</a>
  </div>
  <div class="ng">
    <div class="ngl">Helhet</div>
    <a class="nl" href="profilering.html">Profilering</a>
    <a class="nl" href="systemkarta.html">Systemkarta</a>
    <a class="nl" href="analys.html">Analys</a>
  </div>
  <div class="selvitas-wrap">
    <a class="selvitas-nav" href="selvitas.html">Selvitas</a>
    <div class="ng" style="margin-bottom:0;">
      <div class="ngl">Coach</div>
      <a class="nl" href="coach.html">Coach-portal</a>
    </div>
  </div>
</aside>`;

// ── Ny CSS för sidebar-komponenter ──
const CSS_REPLACEMENTS = [
  // Inga gaps mellan grupper — all rytm via label-padding
  [/\.ng\{margin-bottom:[^}]+\}/, '.ng{margin-bottom:0;}'],
  // Label: top-padding skapar rytm, ingen margin
  [/\.ngl\{font-size:0\.5rem;letter-spacing:0\.32em;text-transform:uppercase;color:var\(--fg4\);padding:0 1\.8rem;margin-bottom:0\.4rem;\}/,
   '.ngl{font-size:0.44rem;letter-spacing:0.32em;text-transform:uppercase;color:var(--fg4);padding:0.7rem 1.8rem 0.2rem;}'],
  // Tätare länkpadding
  [/(\.nl\{[^}]*?)padding:[0-9.]+rem 1\.8rem/, '$1padding:0.22rem 1.8rem'],
  // Active: subtil bakgrundston
  [/\.nl\.active\{color:var\(--fg\);border-left-color:var\(--accent\);\}/,
   '.nl.active{color:var(--fg);border-left-color:var(--accent);background:rgba(143,174,138,0.04);}'],
  // Selvitas-wrap + nav — tätare, lite ljusare nav-färg
  [/\.selvitas-wrap\{margin-top:auto;padding-top:0\.8rem;border-top:1px solid var\(--border\);\}\.selvitas-nav\{display:block;padding:0\.8rem 1\.8rem 0\.4rem;font-family:var\(--serif\);font-style:italic;font-size:0\.76rem;letter-spacing:0\.1em;color:var\(--fg4\);text-decoration:none;transition:color 0\.2s;\}\.selvitas-nav:hover\{color:var\(--fg2\);\}/,
   '.selvitas-wrap{margin-top:auto;padding-top:0.5rem;border-top:1px solid var(--border);}' +
   '.selvitas-nav{display:block;padding:0.6rem 1.8rem 0.3rem;font-family:var(--serif);font-style:italic;font-size:0.78rem;letter-spacing:0.08em;color:var(--fg3);text-decoration:none;transition:color 0.2s;}' +
   '.selvitas-nav:hover{color:var(--fg2);}'],
];

// ── Auto-active JS (ersätter hårdkodad active-class) ──
const AUTO_ACTIVE_SNIPPET = `
// ── Sidebar: auto-active baserat på URL ──
(function(){
  const page = location.pathname.split('/').pop() || 'dashboard.html';
  document.querySelectorAll('.sidebar a.nl').forEach(a => {
    if (a.getAttribute('href') === page) a.classList.add('active');
  });
})();`;

let updated = 0, skipped = 0;

for (const filename of PAGES) {
  const filepath = path.join(ROOT, filename);
  if (!fs.existsSync(filepath)) { console.log(`⚠ saknas: ${filename}`); skipped++; continue; }

  let html = fs.readFileSync(filepath, 'utf8');
  const original = html;

  // 1. Ersätt sidebar HTML
  html = html.replace(/<aside class="sidebar">[\s\S]*?<\/aside>/, NEW_SIDEBAR);

  // 2. Ersätt CSS
  for (const [pattern, replacement] of CSS_REPLACEMENTS) {
    html = html.replace(pattern, replacement);
  }

  // 3. Ta bort hårdkodad active-class i sidebar (nu JS-driven)
  html = html.replace(/(<a class="nl) active"/g, '$1"');

  // 4. Lägg till auto-active snippet om det inte redan finns
  if (!html.includes('auto-active baserat på URL')) {
    // Injicera precis innan </aside> ... nej, efter sidebar, i befintlig <script>
    // Sök första <script> utan src
    html = html.replace(/(<script>)(\s*\/\/\s*[━━═]{3,}|\s*const |\s*let |\s*function |\s*async function )/,
      `$1${AUTO_ACTIVE_SNIPPET}\n$2`);
  }

  if (html !== original) {
    fs.writeFileSync(filepath, html, 'utf8');
    console.log(`✓ ${filename}`);
    updated++;
  } else {
    console.log(`— oförändrad: ${filename}`);
    skipped++;
  }
}

console.log(`\n${updated} uppdaterade, ${skipped} skippade`);
