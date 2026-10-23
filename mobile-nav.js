/* ─────────────────────────────────────────────────────────────────
   FORSYNE — mobile-nav.js
   Hamburger menu overlay — fungerar på alla sidor, inga beroenden.
───────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NAV = [
    {
      label: 'Idag',
      links: [
        { text: 'Dashboard',  href: 'dashboard.html' },
        { text: 'Check-in',   href: 'checkin.html' },
      ]
    },
    {
      label: 'Mönster',
      links: [
        { text: 'Sömn',      href: 'sleep.html' },
        { text: 'Energi',    href: 'energy.html' },
        { text: 'Stress',    href: 'stress.html' },
        { text: 'Träning',   href: 'training.html' },
        { text: 'Kost',      href: 'kostlogg.html' },
        { text: 'Wearables', href: 'wearables.html' },
      ]
    },
    {
      label: 'Djupet',
      links: [
        { text: 'Biologi', href: 'biologi.html' },
        { text: 'DNA',     href: 'dna.html' },
        { text: 'Journal', href: 'journal.html' },
        { text: 'Analys',  href: 'analys.html' },
        { text: 'Coach',   href: 'coach.html' },
      ]
    },
  ];

  /* Inject styles */
  const style = document.createElement('style');
  style.textContent = `
    .hamburger {
      display: none;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 5px;
      width: 36px; height: 36px;
      cursor: pointer;
      background: none; border: none; padding: 4px;
      flex-shrink: 0;
    }
    .hamburger span {
      display: block; width: 20px; height: 1px;
      background: var(--fg3, #8A8E89);
      transition: transform 0.25s ease, opacity 0.25s ease;
    }
    .hamburger.open span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
    .hamburger.open span:nth-child(2) { opacity: 0; }
    .hamburger.open span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }

    .mob-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; width: 80vw; max-width: 320px; bottom: 0;
      z-index: 999;
      background: rgba(13,16,14,0.99);
      border-right: 1px solid rgba(242,240,234,0.06);
      padding: 5rem 2rem 3rem;
      overflow-y: auto;
      transform: translateX(-100%);
      transition: transform 0.22s cubic-bezier(0.4,0,0.2,1);
    }
    .mob-overlay.open { transform: translateX(0); }
    .mob-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 998;
      background: rgba(0,0,0,0.5);
    }
    .mob-backdrop.open { display: block; }

    .mob-group { margin-bottom: 2rem; }

    .mob-group-label {
      font-family: 'Jost', system-ui, sans-serif;
      font-size: 0.48rem;
      letter-spacing: 0.36em;
      text-transform: uppercase;
      color: rgba(242,240,234,0.22);
      margin-bottom: 0.5rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid rgba(242,240,234,0.04);
    }

    .mob-link {
      display: block;
      padding: 0.7rem 0;
      font-family: 'Jost', system-ui, sans-serif;
      font-size: 0.88rem;
      font-weight: 300;
      letter-spacing: 0.05em;
      color: rgba(242,240,234,0.5);
      text-decoration: none;
      border-bottom: 1px solid rgba(242,240,234,0.03);
      transition: color 0.18s;
    }
    .mob-link:last-child { border-bottom: none; }
    .mob-link:hover { color: rgba(242,240,234,0.85); }
    .mob-link.active { color: #F2F0EA; }

    .mob-link.signal-link {
      color: var(--danger, #A85C5C);
      display: none;
      align-items: center;
      gap: 0.5rem;
    }
    .mob-link.signal-link.show { display: flex; }
    .mob-signal-dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--danger, #A85C5C);
      flex-shrink: 0;
      animation: mob-sig 1.6s ease infinite;
    }
    @keyframes mob-sig {
      0%,100% { box-shadow: 0 0 0 0 rgba(168,92,92,0.6); }
      50%      { box-shadow: 0 0 0 4px rgba(168,92,92,0); }
    }

    @media (max-width: 860px) {
      .hamburger { display: flex; }
      .mob-overlay { display: block; }
    }
  `;
  document.head.appendChild(style);

  document.addEventListener('DOMContentLoaded', () => {
    const navMeta = document.querySelector('.nav-meta') || document.querySelector('.topbar-right');
    if (!navMeta) return;

    /* ── Hamburger button ── */
    const btn = document.createElement('button');
    btn.className = 'hamburger';
    btn.setAttribute('aria-label', 'Öppna meny');
    btn.innerHTML = '<span></span><span></span><span></span>';
    navMeta.prepend(btn);

    /* ── Current page ── */
    const currentFile = window.location.pathname.split('/').pop() || 'dashboard.html';

    /* ── Signal state — check localStorage ── */
    const hasSignal = (() => {
      try {
        const dd = JSON.parse(localStorage.getItem('forsyne_daily_data') || '{}');
        const vs = dd?.prediction?.varsel_status;
        return vs && vs !== 'ingen';
      } catch { return false; }
    })();

    /* ── Build overlay ── */
    const overlay = document.createElement('div');
    overlay.className = 'mob-overlay';
    overlay.setAttribute('aria-label', 'Navigering');

    NAV.forEach(group => {
      const grpEl = document.createElement('div');
      grpEl.className = 'mob-group';

      const lbl = document.createElement('div');
      lbl.className = 'mob-group-label';
      lbl.textContent = group.label;
      grpEl.appendChild(lbl);

      group.links.forEach(link => {
        const a = document.createElement('a');
        a.className = 'mob-link';
        a.href = link.href;
        a.textContent = link.text;

        if (link.signal) {
          a.className += ' signal-link';
          const dot = document.createElement('span');
          dot.className = 'mob-signal-dot';
          a.prepend(dot);
          if (hasSignal) a.classList.add('show');
        }

        if (link.href === currentFile) a.classList.add('active');

        grpEl.appendChild(a);
      });

      overlay.appendChild(grpEl);
    });

    const backdrop = document.createElement('div');
    backdrop.className = 'mob-backdrop';
    document.body.appendChild(overlay);
    document.body.appendChild(backdrop);

    const close = () => {
      btn.classList.remove('open');
      overlay.classList.remove('open');
      backdrop.classList.remove('open');
      document.body.style.overflow = '';
    };

    /* ── Toggle ── */
    btn.addEventListener('click', () => {
      const isOpen = btn.classList.toggle('open');
      overlay.classList.toggle('open', isOpen);
      backdrop.classList.toggle('open', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    /* ── Close on link click or backdrop ── */
    overlay.addEventListener('click', e => { if (e.target.closest('a')) close(); });
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  });
})();
