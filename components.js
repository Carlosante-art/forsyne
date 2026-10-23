// ── FORSYNE COMPONENTS — Valideringsloop ──

// Enda sanningskälla för onboarding-frågornas etiketter.
// Uppdatera här om frågorna i onboarding.html ändras — profil-sidan läser härifrån.
const OB_LABELS = {
  q1_1: 'Varför du är här',
  q2_1: 'Energitopp på dagen',
  q2_2: 'Energitapp under dagen',
  q4_1: 'Arbetstyp',
  q4_2: 'Arbetstimmar per vecka',
  q5_1: 'Morgonljus',
  q6_1: 'Sömnlängd',
  q6_2: 'Vaknar utvilad',
  q7_1: 'Träningsfrekvens',
  q8_1: 'Måltider per dag',
};

async function laddaPaastående(kategori) {
  try {
    const checkins = await API.getCheckins() || [];
    const profile  = JSON.parse(localStorage.getItem('forsyne_onboarding') || '{}');

    const res = await API.post('/api/agent/insights/generate', {
      checkins: checkins.slice(-14),
      profile,
      context: kategori + '_paastående'
    });

    const load    = document.getElementById('val-load-'    + kategori);
    const content = document.getElementById('val-content-' + kategori);
    const pEl     = document.getElementById('val-p-'       + kategori);

    if (load)    load.style.display    = 'none';
    if (content) content.style.display = 'block';
    if (pEl && res.paastående) {
      pEl.textContent = '\u201C' + res.paastående + '\u201D';
    } else if (pEl) {
      // Inga tillräckliga data
      const akt4 = document.getElementById('akt4-' + kategori);
      if (akt4) akt4.style.display = 'none';
      return;
    }

    window['_paastående_' + kategori] = res.paastående;
    window['_checkins_'   + kategori] = checkins.slice(-14);

  } catch(e) {
    const load = document.getElementById('val-load-' + kategori);
    const akt4 = document.getElementById('akt4-'     + kategori);
    if (load) load.style.display = 'none';
    if (akt4) akt4.style.display = 'none';
  }
}

async function svaraValidering(kategori, svar) {
  const btns = document.getElementById('val-btns-' + kategori);
  if (btns) btns.style.display = 'none';

  if (svar === 'delvis' || svar === 'stammer_inte') {
    const fritext = document.getElementById('val-fritext-' + kategori);
    if (fritext) fritext.style.display = 'block';
    window['_svar_' + kategori] = svar;
    return;
  }

  await _skickaValidering(kategori, svar, null);
}

async function skickaKommentar(kategori) {
  const textEl   = document.getElementById('val-text-' + kategori);
  const kommentar = textEl ? textEl.value.trim() : null;
  const svar      = window['_svar_' + kategori] || 'delvis';
  await _skickaValidering(kategori, svar, kommentar || null);
}

async function _skickaValidering(kategori, svar, kommentar) {
  try {
    const res = await API.post('/api/agent/validate', {
      kategori,
      paastående:  window['_paastående_' + kategori] || '',
      svar,
      kommentar,
      datapunkter: window['_checkins_'   + kategori] || []
    });

    const content = document.getElementById('val-content-' + kategori);
    const fritext = document.getElementById('val-fritext-' + kategori);
    const tack    = document.getElementById('val-tack-'    + kategori);
    const tackText = document.getElementById('val-tack-text-' + kategori);

    if (content) content.style.display = 'none';
    if (fritext) fritext.style.display = 'none';
    if (tack)    tack.style.display    = 'block';

    const notering = res.larda_notering || 'Systemet har noterat ditt svar.';
    if (tackText) tackText.textContent = notering;

  } catch(e) {
    console.error('Validering misslyckades:', e);
  }
}
