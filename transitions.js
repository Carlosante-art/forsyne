/* ─────────────────────────────────────────────────────────────────
   FORSYNE — transitions.js
   Page transitions · Speculation Rules · Skeleton helpers
───────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     1. CAPABILITY DETECTION
     HAS_VT → Chrome 111+ (startViewTransition exists).
     When true, @view-transition CSS drives the animation in
     Chrome 126+; 111–125 gets instant nav, no flash.
     When false, manual opacity-fade is the fallback.
  ───────────────────────────────────────────────────────────── */
  var HAS_VT = 'startViewTransition' in document;

  /* ─────────────────────────────────────────────────────────────
     2. HIDE BEFORE FIRST PAINT (fallback browsers only)
     Inject blocking CSS so opacity:0 is applied before any pixel
     is painted. Removed on DOMContentLoaded before fade-in.
     Skipped when VT is available — browser handles the snapshot.
  ───────────────────────────────────────────────────────────── */
  if (!HAS_VT) {
    var _pre = document.createElement('style');
    _pre.id = '_px_pre';
    _pre.textContent = 'html{opacity:0!important}';
    document.head.appendChild(_pre);
  }

  /* ─────────────────────────────────────────────────────────────
     3. GLOBAL STYLESHEET
     • html background: prevents white FOUC flash on all browsers
     • @view-transition: auto → cross-document VT (Chrome 126+)
     • Custom VT animation: fade crossfade matching design language
     • Skeleton CSS
     • px-reveal utility class
  ───────────────────────────────────────────────────────────── */
  var sheet = document.createElement('style');
  sheet.textContent = [

    /* Dark background on html — fires before body CSS loads */
    'html{background:#0F1210}',

    /* ── Mobile layout reset ── */
    /* Kill ALL rubber-band / overscroll drag — page stays locked */
    'html,body{overscroll-behavior:none}',
    '@media(max-width:860px){',
    /* html+body: auto height (no 100vh — address bar causes jojo), vertical scroll only */
    '  html{overflow:hidden!important;}',
    '  body{height:auto!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important;touch-action:pan-y!important;}',
    /* Sidebar gone — hamburger overlay handles nav */
    '  .sidebar{display:none!important;}',
    /* Nav: only logo + hamburger on mobile — date/user push page wider than viewport */
    '  .nav-date,.nav-user,.nav-dot,.nav-center{display:none!important;}',
    /* content-wrap: remove fixed-height clip */
    '  .content-wrap{height:auto!important;min-height:0!important;overflow:visible!important;display:block!important;}',
    /* main: natural height, no inner scroll container */
    '  main,#main{height:auto!important;min-height:0!important;overflow:visible!important;width:100%!important;max-width:100vw!important;}',
    /* Prevent any element from causing horizontal overflow (the "drag sideways" bug) */
    '  *{max-width:100%;}',
    '}',

    /* ── View Transition (MPA cross-document, Chrome 126+) ── */
    '@view-transition{navigation:auto}',

    '::view-transition-old(root){',
    '  animation:180ms ease both _px-out',
    '}',
    '::view-transition-new(root){',
    '  animation:240ms ease both _px-in',
    '}',
    '@keyframes _px-out{to{opacity:0}}',
    '@keyframes _px-in{from{opacity:0}}',

    /* ── Skeleton base ── */
    '.skel-wrap{',
    '  display:flex;flex-direction:column;gap:0.75rem;padding:2rem 0;',
    '  animation:_px-skel-in 0.18s ease',
    '}',
    '@keyframes _px-skel-in{from{opacity:0}to{opacity:1}}',

    '.skel-line,.skel-block{',
    '  background:linear-gradient(',
    '    90deg,',
    '    rgba(242,240,234,0.04) 25%,',
    '    rgba(242,240,234,0.09) 50%,',
    '    rgba(242,240,234,0.04) 75%',
    '  );',
    '  background-size:200% 100%;',
    '  animation:_px-shimmer 1.6s infinite',
    '}',
    '@keyframes _px-shimmer{',
    '  0%{background-position:200% 0}',
    '  100%{background-position:-200% 0}',
    '}',

    '.skel-line{height:12px;border-radius:1px}',
    '.skel-block{border-radius:1px}',

    /* card-grid layout — matches .cg / .mg / .bio-grid */
    '.skel-card-grid{',
    '  display:grid;grid-template-columns:repeat(4,1fr);',
    '  gap:1px;background:rgba(242,240,234,0.06)',
    '}',
    '.skel-card-grid.cols-3{grid-template-columns:repeat(3,1fr)}',
    '.skel-card{',
    '  background:#131714;padding:1.3rem 1.5rem;',
    '  display:flex;flex-direction:column;gap:0.6rem',
    '}',

    /* data-rows layout — matches .dl-wrap / .dr */
    '.skel-rows{',
    '  display:flex;flex-direction:column;',
    '  gap:1px;background:rgba(242,240,234,0.06)',
    '}',
    '.skel-row{',
    '  background:#131714;padding:0.85rem 1.4rem;',
    '  display:grid;grid-template-columns:100px 1fr 70px;',
    '  gap:1.4rem;align-items:center',
    '}',

    /* hero / insight layout — matches .a1 / .ph / .ot */
    '.skel-hero{',
    '  padding:4rem 3.5rem 3rem;',
    '  display:flex;flex-direction:column;gap:1.2rem',
    '}',

    /* sidebar signal — isolated VT so it crossfades independently */
    '#nav-signal{view-transition-name:sidebar-signal}',
    '::view-transition-old(sidebar-signal){animation:180ms ease both _px-out}',
    '::view-transition-new(sidebar-signal){animation:240ms ease both _px-in}',

    /* px-reveal: apply before fetch, call PX.reveal() after */
    '.px-reveal{opacity:0;transition:opacity 0.35s ease}',
    '.px-reveal.ready{opacity:1}'

  ].join('\n');

  document.head.appendChild(sheet);

  /* ─────────────────────────────────────────────────────────────
     4. DOMCONTENTLOADED — fade-in + speculation rules
  ───────────────────────────────────────────────────────────── */
  /* ─────────────────────────────────────────────────────────────
     3b. BACKGROUND IMAGE PRELOAD
     Find .page-bg-img inline style, extract the URL, and inject
     a <link rel="preload"> so the image downloads in parallel with
     HTML/CSS instead of after — prevents the dark-then-image flash.
  ───────────────────────────────────────────────────────────── */
  (function _preloadBg() {
    // Run immediately (before DOMContentLoaded) since transitions.js
    // is the first script in <head>. The inline style on .page-bg-img
    // is part of the HTML so the parser has it by the time we run.
    // We use a MutationObserver as fallback for any late-rendered bg.
    function _injectPreload(url) {
      if (!url || document.querySelector('link[rel="preload"][data-bg]')) return;
      var l = document.createElement('link');
      l.rel = 'preload';
      l.as = 'image';
      l.setAttribute('fetchpriority', 'high');
      l.setAttribute('data-bg', '1');
      l.href = url;
      document.head.appendChild(l);
    }
    function _extractBgUrl(el) {
      var s = el && el.style && el.style.backgroundImage;
      if (!s) s = el && el.getAttribute && el.getAttribute('style');
      if (!s) return null;
      var m = s.match(/url\(['"]?([^'")\s]+)['"]?\)/);
      return m ? m[1] : null;
    }
    function _scanAndPreload() {
      var el = document.querySelector('.page-bg-img');
      if (el) { _injectPreload(_extractBgUrl(el)); return true; }
      return false;
    }
    if (!_scanAndPreload()) {
      // Fallback: observe DOM until .page-bg-img appears
      if (typeof MutationObserver !== 'undefined') {
        var mo = new MutationObserver(function() {
          if (_scanAndPreload()) mo.disconnect();
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
        // Stop trying after 2s regardless
        setTimeout(function() { mo.disconnect(); }, 2000);
      }
    }
  })();

  window.addEventListener('DOMContentLoaded', function () {

    /* Fallback fade-in (non-VT browsers) */
    if (!HAS_VT) {
      var pre = document.getElementById('_px_pre');
      if (pre) pre.parentNode.removeChild(pre);
      requestAnimationFrame(function () {
        document.documentElement.style.transition = 'opacity 0.22s ease';
        requestAnimationFrame(function () {
          document.documentElement.style.opacity = '1';
        });
      });
    }

    /* ── Speculation Rules ──────────────────────────────────────
       Collect all nav links from the sidebar (.nl[href]) and
       prerender them. Dynamic — no hardcoded URL list needed.
       Only injected when the browser supports the API.
    */
    if (
      typeof HTMLScriptElement !== 'undefined' &&
      HTMLScriptElement.supports &&
      HTMLScriptElement.supports('speculationrules')
    ) {
      var urls = Array.prototype.slice
        .call(document.querySelectorAll('.nl[href]'))
        .map(function (a) { return a.getAttribute('href'); })
        .filter(function (h) {
          return h && !h.startsWith('#') && !h.startsWith('http') && !h.startsWith('mailto');
        });

      if (urls.length) {
        var sr = document.createElement('script');
        sr.type = 'speculationrules';
        // prefetch (not prerender) — loads HTML + assets without executing JS.
        // Eagerness 'moderate' = only prefetch links that are hovered/visible,
        // not all 15+ nav links at once (would spike memory and CPU).
        sr.textContent = JSON.stringify({
          prefetch: [{
            source: 'list',
            urls: urls,
            eagerness: 'moderate'
          }]
        });
        document.head.appendChild(sr);
      }
    }
  });

  /* ─────────────────────────────────────────────────────────────
     5. CLICK HANDLER
     VT browsers: navigate immediately — CSS animation takes over.
     Fallback: manual opacity fade before location change.
  ───────────────────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('http') ||
      href.startsWith('mailto') ||
      a.target === '_blank'
    ) return;
    e.preventDefault();
    if (HAS_VT) {
      window.location.href = href;
    } else {
      document.documentElement.style.transition = 'opacity 0.18s ease';
      document.documentElement.style.opacity = '0';
      setTimeout(function () { window.location.href = href; }, 220);
    }
  });

  /* ─────────────────────────────────────────────────────────────
     6. PX HELPERS
  ───────────────────────────────────────────────────────────── */
  window.PX = window.PX || {};

  /* ── PX.showSkeleton(id, type?, opts?) ────────────────────────
     type:
       'lines'     – generic shimmer lines (default / legacy)
       'card-grid' – 4-column metric cards (matches .cg, .mg, .bio-grid)
       'data-rows' – date + bar + value rows (matches .dl-wrap)
       'hero'      – large heading block (matches .a1, .ph)
       'insight'   – italic multi-line text block (matches .ot)

     opts:
       cards  – card count for 'card-grid' (default 4)
       cols   – column count for 'card-grid' (default 4, use 3 for .mg)
       rows   – row/line count (default varies per type)

     Legacy: showSkeleton('id', 5) → type='lines', rows=5
  */
  PX.showSkeleton = function (containerId, type, opts) {
    var el = document.getElementById(containerId);
    if (!el) return;

    if (typeof type === 'number') { opts = { rows: type }; type = 'lines'; }
    type  = type  || 'lines';
    opts  = opts  || {};

    var inner = '';

    if (type === 'card-grid') {
      var count = opts.cards || 4;
      var cols  = opts.cols  || 4;
      var cards = '';
      for (var i = 0; i < count; i++) {
        cards += [
          '<div class="skel-card">',
          '  <div class="skel-block" style="height:9px;width:55%"></div>',
          '  <div class="skel-block" style="height:30px;width:42%;margin-top:0.4rem"></div>',
          '  <div class="skel-block" style="height:8px;width:68%;margin-top:0.3rem;opacity:0.6"></div>',
          '</div>'
        ].join('');
      }
      var cls = cols === 3 ? 'skel-card-grid cols-3' : 'skel-card-grid';
      inner = '<div class="' + cls + '">' + cards + '</div>';

    } else if (type === 'data-rows') {
      var rCount = opts.rows || 7;
      var widths = [65, 55, 75, 50, 70];
      var rows = '';
      for (var j = 0; j < rCount; j++) {
        rows += [
          '<div class="skel-row">',
          '  <div class="skel-block" style="height:9px;width:' + widths[j % 5] + '%"></div>',
          '  <div class="skel-block" style="height:2px;width:100%"></div>',
          '  <div class="skel-block" style="height:9px;width:38%;margin-left:auto"></div>',
          '</div>'
        ].join('');
      }
      inner = '<div class="skel-rows">' + rows + '</div>';

    } else if (type === 'hero') {
      inner = [
        '<div class="skel-hero">',
        '  <div class="skel-block" style="height:9px;width:72px"></div>',
        '  <div class="skel-block" style="height:38px;width:72%;margin-top:0.5rem"></div>',
        '  <div class="skel-block" style="height:38px;width:52%"></div>',
        '  <div class="skel-block" style="height:11px;width:58%;margin-top:1rem;opacity:0.7"></div>',
        '  <div class="skel-block" style="height:11px;width:44%;opacity:0.5"></div>',
        '</div>'
      ].join('');

    } else if (type === 'insight') {
      inner = [
        '<div class="skel-hero" style="padding:3rem 3.5rem 2.5rem">',
        '  <div class="skel-block" style="height:28px;width:86%"></div>',
        '  <div class="skel-block" style="height:28px;width:62%"></div>',
        '  <div class="skel-block" style="height:28px;width:74%"></div>',
        '  <div class="skel-block" style="height:9px;width:38%;margin-top:1rem;opacity:0.45"></div>',
        '</div>'
      ].join('');

    } else {
      /* 'lines' — legacy / generic */
      var lineCount = (typeof opts.rows === 'number') ? opts.rows : (typeof opts === 'number') ? opts : 3;
      var ws = [80, 60, 90, 70, 50];
      var lines = '';
      for (var k = 0; k < lineCount; k++) {
        lines += '<div class="skel-line" style="width:' + ws[k % 5] + '%"></div>';
      }
      inner = lines;
    }

    el.innerHTML = '<div class="skel-wrap">' + inner + '</div>';
  };

  /* ── PX.hideSkeleton(id, callback?) ───────────────────────────
     Fades out the skeleton wrapper, removes it, then fires cb.
     Calling code can pass a callback to populate content after
     the fade instead of risking a visible swap mid-animation.
  */
  PX.hideSkeleton = function (containerId, callback) {
    var el = document.getElementById(containerId);
    if (!el) { if (callback) callback(); return; }
    var wrap = el.querySelector('.skel-wrap');
    if (!wrap) { if (callback) callback(); return; }
    wrap.style.transition = 'opacity 0.2s ease';
    wrap.style.opacity = '0';
    setTimeout(function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (callback) callback();
    }, 220);
  };

  /* ── PX.reveal(el | id) ───────────────────────────────────────
     Fade in an element that has class px-reveal.
     Usage:
       someEl.classList.add('px-reveal');
       // ... update DOM with fetched data ...
       PX.reveal(someEl);
  */
  PX.reveal = function (target) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    requestAnimationFrame(function () { el.classList.add('ready'); });
  };

  /* ── PX.toast(msg, type?) ─────────────────────────────────────
     type: 'error' | 'warn' | undefined (success/neutral)
  */
  PX.toast = function (msg, type) {
    var t = document.getElementById('px-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'px-toast';
      t.style.cssText = [
        'position:fixed;bottom:2rem;right:2rem;z-index:9999;',
        'font-family:var(--sans,sans-serif);font-size:0.72rem;letter-spacing:0.06em;',
        'padding:0.75rem 1.2rem;border-radius:2px;pointer-events:none;',
        'transition:opacity 0.3s;opacity:0;max-width:320px;line-height:1.5;'
      ].join('');
      document.body.appendChild(t);
    }
    var bg     = type === 'error' ? 'rgba(168,92,92,0.95)'    : type === 'warn' ? 'rgba(196,135,90,0.95)'    : 'rgba(143,174,138,0.15)';
    var border = type === 'error' ? '1px solid rgba(168,92,92,0.4)' : type === 'warn' ? '1px solid rgba(196,135,90,0.4)' : '1px solid rgba(143,174,138,0.25)';
    var color  = type === 'error' ? '#F2F0EA'                 : type === 'warn' ? '#F2F0EA'                 : '#8FAE8A';
    t.style.background = bg;
    t.style.border     = border;
    t.style.color      = color;
    t.textContent      = msg;
    t.style.opacity    = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.style.opacity = '0'; }, 3200);
  };

  /* ── PX.emptyState(id, opts) ──────────────────────────────────
     opts: { title, body, cta, ctaHref }
  */
  PX.emptyState = function (containerId, opts) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var o = opts || {};
    el.innerHTML = [
      '<div class="px-empty" style="display:flex;flex-direction:column;align-items:flex-start;gap:1.2rem;padding:3rem 0;max-width:480px;">',
      '  <div style="width:32px;height:1px;background:rgba(143,174,138,0.4);"></div>',
      '  <div style="font-family:var(--serif,\'Georgia\',serif);font-size:clamp(1.4rem,2.5vw,2rem);font-weight:300;line-height:1.2;color:#F2F0EA;">',
      (o.title || 'Ingen data ännu.'),
      '  </div>',
      '  <div style="font-size:0.78rem;color:#8A8E89;line-height:1.75;">',
      (o.body || 'Data byggs upp från dina dagliga check-ins.'),
      '  </div>',
      o.cta
        ? '<a href="' + (o.ctaHref || 'checkin.html') + '" style="font-size:0.68rem;letter-spacing:0.18em;text-transform:uppercase;color:#8FAE8A;text-decoration:none;border:1px solid rgba(143,174,138,0.3);padding:0.6rem 1.2rem;transition:border-color 0.2s;">' + o.cta + '</a>'
        : '',
      '</div>'
    ].join('');
  };

  /* ── PX.errorState(id, msg) ───────────────────────────────────*/
  PX.errorState = function (containerId, msg) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = [
      '<div class="px-error" style="padding:2rem 0;max-width:480px;">',
      '  <div style="font-size:0.52rem;letter-spacing:0.28em;text-transform:uppercase;color:rgba(168,92,92,0.8);margin-bottom:0.8rem;">Systemfel</div>',
      '  <div style="font-size:0.82rem;color:#8A8E89;line-height:1.7;">',
      (msg || 'Något gick fel. Datan laddades inte — försök igen om ett ögonblick.'),
      '  </div>',
      '</div>'
    ].join('');
  };

})();
