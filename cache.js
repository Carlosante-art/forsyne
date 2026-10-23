// Forsyne — PCache
// Centralt cache-lager för agent-svar. Datum-invaliderat: ny dag = ny fetch.
// Bustar vid ny check-in så att insikterna alltid reflekterar senaste data.
//
// Nycklar: page_sleep, page_stress, page_training, page_nutrition, page_energy,
//          insights_dashboard, insights_profilering_opening, insights_profilering_full,
//          insights_sysmap_opening, insights_sysmap_full,
//          agent9_balance, analyze, psi_energy

const PCache = {
  _prefix: 'prc_',
  _today() { return new Date().toISOString().split('T')[0]; },

  get(key) {
    try {
      const raw = localStorage.getItem(this._prefix + key);
      if (!raw) return null;
      const item = JSON.parse(raw);
      if (!item || item.date !== this._today()) return null;
      return item.data;
    } catch { return null; }
  },

  set(key, data) {
    try {
      localStorage.setItem(this._prefix + key, JSON.stringify({ date: this._today(), data }));
    } catch {} // ignorera localStorage-quota
  },

  // Kallas efter ny check-in — invaliderar alla agent-svar
  bust() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(this._prefix))
        .forEach(k => localStorage.removeItem(k));
    } catch {}
  }
};
