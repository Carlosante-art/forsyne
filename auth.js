/* ═══════════════════════════════════════════════════════════
   FORSYNE — AUTH
   Central auth module. Import on every page.
   Handles session, redirects, Supabase REST auth.
═══════════════════════════════════════════════════════════ */

const SUPABASE_URL  = 'https://xhvyrwejgikexvzssbkv.supabase.co';
const SUPABASE_ANON = 'sb_publishable_rFDGDuenHNgr5SoH1erQMQ_SXdJURD0';

// Pages that never require auth (and won't redirect away if logged in)
const PUBLIC_PAGES = ['landing.html', 'login.html', 'confirm.html', 'reset.html', 'manifesto.html'];

// ── SESSION STORAGE ──

function _setSession(access_token, refresh_token, email, uid) {
  localStorage.setItem('prv_token',   access_token);
  localStorage.setItem('prv_refresh', refresh_token || '');
  localStorage.setItem('prv_email',   email || '');
  localStorage.setItem('prv_ts',      Date.now().toString());
  if (uid) localStorage.setItem('prv_uid', uid);
}

function _clearSession() {
  ['prv_token','prv_refresh','prv_email','prv_ts','prv_uid'].forEach(k => localStorage.removeItem(k));
}

function getSession() {
  const token = localStorage.getItem('prv_token');
  if (!token) return null;
  return {
    access_token:  token,
    refresh_token: localStorage.getItem('prv_refresh') || '',
    email:         localStorage.getItem('prv_email')   || '',
  };
}

function isLoggedIn() { return !!localStorage.getItem('prv_token'); }

// ── SUPABASE REST ──

async function _sbPost(path, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
    body:    JSON.stringify(body)
  });
  return r.json();
}

async function _sbGet(path, token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` }
  });
  return r.json();
}

// ── TOKEN REFRESH ──

async function refreshSession() {
  const rt = localStorage.getItem('prv_refresh');
  if (!rt) return false;
  try {
    const d = await _sbPost('/token?grant_type=refresh_token', { refresh_token: rt });
    if (d.access_token) {
      _setSession(d.access_token, d.refresh_token || rt, d.user?.email, d.user?.id);
      return true;
    }
  } catch(e) {}
  _clearSession();
  return false;
}

// ── LOGIN ──

async function login(email, password) {
  const d = await _sbPost('/token?grant_type=password', { email, password });
  if (d.access_token) {
    _setSession(d.access_token, d.refresh_token, d.user?.email || email, d.user?.id);
    return { ok: true };
  }
  return { error: d.error_description || d.msg || 'Fel e-post eller lösenord.' };
}

// ── REGISTER ──

async function register(email, password) {
  const origin        = window.location.origin;
  const confirmRedirect = `${origin}/confirm.html`;

  const d = await _sbPost('/signup', {
    email,
    password,
    email_redirect_to: confirmRedirect
  });

  if (d.access_token) {
    // Auto-confirmed (email confirmation disabled in Supabase)
    _setSession(d.access_token, d.refresh_token, d.user?.email || email, d.user?.id);
    return { ok: true, confirmed: true };
  }
  if (d.id || d.user?.id || d.identities) {
    // Created but needs email confirmation
    return { ok: true, confirmed: false };
  }
  return { error: d.msg || d.error_description || d.message || 'Registreringen misslyckades.' };
}

// ── LOGOUT ──

async function logout() {
  const token = localStorage.getItem('prv_token');
  if (token) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': `Bearer ${token}`
        }
      });
    } catch(e) {}
  }
  _clearSession();
  window.location.href = '/login.html';
}

// ── MAGIC LINK ──

async function sendMagicLink(email) {
  const origin      = window.location.origin;
  const redirectTo  = `${origin}/confirm.html`;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/magiclink`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
    body:    JSON.stringify({ email, redirect_to: redirectTo })
  });
  return r.ok ? { ok: true } : { error: 'Kunde inte skicka länken.' };
}

// ── PASSWORD RESET ──

async function sendPasswordReset(email) {
  const origin     = window.location.origin;
  const redirectTo = `${origin}/reset.html`;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
    body:    JSON.stringify({ email, redirect_to: redirectTo })
  });
  return r.ok ? { ok: true } : { error: 'Kunde inte skicka återställningslänken.' };
}

// ── UPDATE PASSWORD (used from reset.html) ──

async function updatePassword(newPassword) {
  const token = localStorage.getItem('prv_token');
  if (!token) return { error: 'Ingen aktiv session.' };
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method:  'PUT',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ password: newPassword })
  });
  const d = await r.json();
  return d.id ? { ok: true } : { error: d.msg || d.error_description || 'Kunde inte uppdatera lösenordet.' };
}

// ── REDIRECT LOGIC ──

// En profil räknas som onboardad om någon av huvudidentitetsfälten är satta,
// om en explicit completion-flagga finns, eller om datan är substantiell
// (>10 ifyllda fält). Tidigare kontroll endast på q3_1 gjorde att användare
// som lämnat namn tomt men svarat på allt annat hamnade i onboarding-loop.
function _profileIsComplete(data) {
  if (!data || typeof data !== 'object') return false;
  const keys = Object.keys(data);
  return !!(
    data.q3_1 ||                // namn
    data.q3_2 ||                // ålder
    data.q3_3 ||                // kön
    data._onboarding_complete || // explicit flagga
    keys.length > 10             // substantial onboarding-data
  );
}

function hasCompletedOnboarding() {
  try {
    return _profileIsComplete(JSON.parse(localStorage.getItem('forsyne_onboarding') || '{}'));
  } catch(e) { return false; }
}

// Check Supabase profiles table — authoritative for cross-device state
async function checkHasProfile() {
  const token = localStorage.getItem('prv_token');
  if (!token) return false;
  try {
    const r = await fetch('/api/profile', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) return hasCompletedOnboarding(); // fallback
    const p = await r.json();
    return _profileIsComplete(p?.data) || !!p?.analysis;
  } catch(e) {
    return hasCompletedOnboarding(); // fallback to localStorage
  }
}

function _redirect(url) {
  // Short fade before redirect for smooth UX
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.25s ease';
  setTimeout(() => { window.location.href = url; }, 260);
}

// Call on every protected page — fast sync check (no profile lookup)
function requireAuth() {
  if (!isLoggedIn()) {
    _redirect('/login.html');
    return false;
  }
  return true;
}

// Sync server profile → localStorage so all pages have it without individual fetches
async function _syncProfileToLocalStorage() {
  const token = localStorage.getItem('prv_token');
  if (!token) return;
  const existing = (() => { try { return JSON.parse(localStorage.getItem('forsyne_onboarding') || 'null'); } catch(e) { return null; } })();
  // Hoppa om localStorage redan har substantiell profildata
  if (_profileIsComplete(existing)) return;
  try {
    const r = await fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) return;
    const p = await r.json();
    if (p && p.data && Object.keys(p.data).length > 0) {
      localStorage.setItem('forsyne_onboarding', JSON.stringify(p.data));
    }
  } catch(e) { /* silent */ }
}

// Full auth check: session + profile — call on every protected page
// Redirects: no session → login.html, session but no profile → onboarding.html
async function checkAuth() {
  // On View Transition browsers the browser handles the page crossfade —
  // manually hiding/showing body.opacity fights the animation and causes stutters.
  // Only use opacity trick on non-VT browsers as a fallback.
  const hasVT = 'startViewTransition' in document;
  if (!hasVT) {
    document.body.style.opacity = '0';
  }

  if (!isLoggedIn()) {
    _redirect('/login.html');
    return false;
  }

  // Fast path: if localStorage already has profile data, skip the network call.
  // checkHasProfile() hits /api/profile on every page load — too slow for nav.
  if (hasCompletedOnboarding()) {
    renderNavUser();
    if (!hasVT) {
      document.body.style.transition = 'opacity 0.25s ease';
      document.body.style.opacity = '1';
    }
    return true;
  }

  // Slow path: no local profile yet — check server once, then sync to localStorage.
  const hasProfile = await checkHasProfile();
  if (!hasProfile) {
    const path = window.location.pathname;
    const onOnboarding = path.endsWith('onboarding.html') || path.endsWith('onboarding-basic.html');
    if (!onOnboarding) {
      _redirect('/onboarding-basic.html');
      return false;
    }
  } else {
    _syncProfileToLocalStorage(); // fire-and-forget — populates cache for future visits
  }

  renderNavUser();
  if (!hasVT) {
    document.body.style.transition = 'opacity 0.25s ease';
    document.body.style.opacity = '1';
  }
  return true;
}

// Returns { name, email, userId } from current session
function getUser() {
  const email  = localStorage.getItem('prv_email') || '';
  const name   = email ? email.split('@')[0] : '';
  const userId = localStorage.getItem('prv_uid') || '';
  return { name, email, userId };
}

// Call on login.html — redirects away if already logged in
async function redirectIfLoggedIn() {
  if (!isLoggedIn()) return false;
  const hasProfile = await checkHasProfile();
  // Use replace() so login.html never enters the browser history —
  // pressing Back from dashboard goes straight to wherever the user came from.
  window.location.replace(hasProfile ? '/dashboard.html' : '/onboarding-basic.html');
  return true;
}

// After successful login/confirm — go to the right place
async function redirectAfterLogin() {
  const hasProfile = await checkHasProfile();
  _redirect(hasProfile ? '/dashboard.html' : '/onboarding-basic.html');
}

// ── HASH FRAGMENT PARSER ──
// Supabase puts tokens in the URL fragment after email confirm / magic link / reset
// e.g. #access_token=...&refresh_token=...&type=signup

function parseAuthFragment() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const p = Object.fromEntries(new URLSearchParams(hash));
  if (!p.access_token) return null;
  return p; // { access_token, refresh_token, type, ... }
}

// ── SESSION INIT ──
// Auto-refresh on load if token exists but may be stale

(function _initSession() {
  const ts    = parseInt(localStorage.getItem('prv_ts') || '0', 10);
  const age   = Date.now() - ts;
  // Refresh if token is older than 55 minutes (JWT expires in 60)
  if (isLoggedIn() && age > 55 * 60 * 1000) {
    refreshSession(); // fire-and-forget
  }
})();

// ── LEGACY COMPATIBILITY ──
// Keep the API object for any code that still calls API.login() etc.

const API = {
  token()        { return localStorage.getItem('prv_token'); },
  user()         { return { email: localStorage.getItem('prv_email') || '' }; },
  isLoggedIn,
  login,
  register,
  logout,
  clearAuth:     _clearSession,
  setAuth:       _setSession,
  getProfile()   { return _apiReq('GET', '/api/profile'); },
  saveProfile(d) { return _apiReq('POST', '/api/profile', d); },
  getCheckins()  { return _apiReq('GET', '/api/checkins'); },
  saveCheckin(d) { return _apiReq('POST', '/api/checkin', d); },
  post(path, d)  { return _apiReq('POST', path, d); },
  get(path)      { return _apiReq('GET', path); },
};

async function _apiReq(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const token = localStorage.getItem('prv_token');
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);

  let r = await fetch(path, opts);

  if (r.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      opts.headers['Authorization'] = 'Bearer ' + localStorage.getItem('prv_token');
      r = await fetch(path, opts);
    }
  }

  if (r.status === 401) {
    _clearSession();
    window.location.href = '/login.html';
    return;
  }

  return r.json();
}

function renderNavUser() {
  const email = localStorage.getItem('prv_email') || '';
  const el = document.getElementById('nav-user');
  if (el && email) el.textContent = email.split('@')[0];
}
