/**
 * Bulk FIT-file importer — bypasses the /api/garmin/fit-import endpoint
 * (which has a 60-file multer limit). Reads .fit/.FIT files from one or
 * more directories, parses + normalizes, and upserts to the integrations
 * table via Supabase service-role.
 *
 * Usage:
 *   node scripts/import-fit-bulk.js <dir> [<dir> ...]
 *
 * Reuses normalizeFitFiles logic copied verbatim from server.js — keep
 * in sync if that function changes. Operates against the user identified
 * by IMPORT_FOR_EMAIL env var (defaults to the only user if there is one).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { default: FitParser } = require('fit-file-parser');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TARGET_EMAIL = process.env.IMPORT_FOR_EMAIL || null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── PARSER (copied from server.js) ───────────────────────────────────
function parseFitBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const fp = new FitParser({ force: true, mode: 'list', elapsedRecordField: false });
    fp.parse(buffer, (err, data) => err ? reject(err) : resolve(data));
  });
}

function toDateStr(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return null;
}

async function normalizeFitFiles(fileResults) {
  const sleepByDate = {}, stressByDate = {}, activityByDate = {};

  for (const { name, buffer } of fileResults) {
    let data;
    try { data = await parseFitBuffer(buffer); } catch (e) { continue; }

    const lname = name.toLowerCase();
    const isSleep = /^g[0-9a-f]/i.test(lname) || lname.includes('sleep');
    const isMonitor = /^m[0-9a-f]/i.test(lname) || lname.includes('monitor');
    const isActivity = /^\d{4}-\d{2}-\d{2}/i.test(lname) || lname.includes('activity');

    if (isSleep) {
      const evts = data.events || [];
      const fid = (data.file_ids || [])[0];
      const startEvt = evts.find(e => e.event_type === 'start');
      const stopEvt = evts.find(e => e.event_type === 'stop_all' || e.event_type === 'stop');
      const startTs = startEvt?.timestamp;
      const endTs = stopEvt?.timestamp || fid?.time_created;
      if (!startTs || !endTs) continue;
      const dateKey = toDateStr(endTs);
      if (!dateKey) continue;
      const total_min = Math.round((new Date(endTs) - new Date(startTs)) / 60000);
      if (total_min < 60 || total_min > 900) continue;
      sleepByDate[dateKey] = {
        date: dateKey, total_min,
        deep_min: null, rem_min: null, light_min: null, awake_min: null,
        avg_hrv: null, avg_spo2: null,
      };
    }

    if (isActivity) {
      const sessions = data.sessions || [];
      for (const s of sessions) {
        const dateKey = toDateStr(s.start_time);
        if (!dateKey || !s.sport) continue;
        const startIso = s.start_time instanceof Date
          ? s.start_time.toISOString()
          : (typeof s.start_time === 'string' ? s.start_time : null);
        const entry = {
          date: dateKey,
          start_time: startIso,
          sport: s.sport || null,
          sub_sport: s.sub_sport || null,
          name: s.sport_profile_name || null,
          duration_min: s.total_elapsed_time ? Math.round(s.total_elapsed_time / 60) : null,
          calories: s.total_calories || null,
          distance_m: s.total_distance ? Math.round(s.total_distance) : null,
          avg_hr: s.avg_heart_rate || null,
          max_hr: s.max_heart_rate || null,
        };
        if (!activityByDate[dateKey]) activityByDate[dateKey] = [];
        activityByDate[dateKey].push(entry);
      }
    }

    if (isMonitor) {
      const recs = data.stress || [];
      for (const rec of recs) {
        const ts = rec.stress_level_time || rec.timestamp;
        if (!ts) continue;
        const d = toDateStr(ts);
        if (!d) continue;
        if (!stressByDate[d]) stressByDate[d] = { stress: [], bb: [], hrv: [] };
        const sv = rec.stress_level_value ?? null;
        if (sv != null && sv >= 0 && sv <= 100) stressByDate[d].stress.push(sv);
        const bb = rec.body_battery ?? null;
        if (bb != null && bb >= 0 && bb <= 100) stressByDate[d].bb.push(bb);
        const hrv = rec.field_two ?? null;
        if (hrv != null && hrv > 0 && hrv <= 250) stressByDate[d].hrv.push(hrv);
      }
    }
  }

  const stress = [], hrv = [], body_battery = [];
  for (const [date, d] of Object.entries(stressByDate)) {
    const mean = arr => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
    if (d.stress.length) {
      stress.push({
        date,
        avg_stress: mean(d.stress),
        max_stress: Math.max(...d.stress),
        high_stress_min: Math.round(d.stress.filter(v => v > 75).length),
        rest_stress_min: Math.round(d.stress.filter(v => v <= 25).length),
      });
    }
    if (d.bb.length) {
      body_battery.push({
        date,
        start_of_day: d.bb[0],
        end_of_day: d.bb[d.bb.length - 1],
        charged: Math.max(...d.bb),
        drained: Math.max(...d.bb) - Math.min(...d.bb),
      });
    }
    if (d.hrv.length) hrv.push({ date, avg_hrv: mean(d.hrv) });
  }

  const hrvMap = Object.fromEntries(hrv.map(r => [r.date, r.avg_hrv]));
  const sleep = Object.values(sleepByDate).map(r => ({ ...r, avg_hrv: r.avg_hrv || hrvMap[r.date] || null }));
  const activities = Object.values(activityByDate).flat().sort((a, b) => b.date.localeCompare(a.date));

  const last7 = arr => [...arr].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const mean7 = (arr, f) => {
    const v = arr.map(r => r[f]).filter(x => x != null);
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };

  const s7 = last7(sleep), st7 = last7(stress), h7 = last7(hrv), b7 = last7(body_battery);

  return {
    _source: 'garmin_fit',
    _type: 'wearable',
    _updated: new Date().toISOString(),
    sleep, stress, hrv, body_battery, activities,
    avg_sleep_7d: mean7(s7, 'total_min'),
    avg_deep_sleep_7d: mean7(s7, 'deep_min'),
    avg_hrv_7d: mean7(h7, 'avg_hrv'),
    avg_stress_7d: mean7(st7, 'avg_stress'),
    latest_body_battery: b7[0]?.end_of_day || b7[0]?.charged || null,
    latest_hrv: h7[0]?.avg_hrv || null,
    latest_sleep_min: s7[0]?.total_min || null,
    latest_activity: activities[0] || null,
  };
}

// ── MAIN ─────────────────────────────────────────────────────────────
async function getUserId() {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const users = data.users || [];
  if (TARGET_EMAIL) {
    const u = users.find(x => x.email?.toLowerCase() === TARGET_EMAIL.toLowerCase());
    if (!u) throw new Error(`No user with email ${TARGET_EMAIL}`);
    return u.id;
  }
  if (users.length !== 1) {
    throw new Error(`Expected exactly 1 user (or set IMPORT_FOR_EMAIL); found ${users.length}`);
  }
  return users[0].id;
}

function collectFitFiles(dirs) {
  const files = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.fit$/i.test(entry.name)) {
        files.push({ name: entry.name, buffer: fs.readFileSync(full), size: fs.statSync(full).size });
      }
    }
  };
  for (const d of dirs) walk(d);
  return files;
}

async function main() {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error('Usage: node scripts/import-fit-bulk.js <dir> [<dir> ...]');
    process.exit(1);
  }

  console.log(`Scanning: ${dirs.join(', ')}`);
  const files = collectFitFiles(dirs);
  if (!files.length) { console.error('No .fit files found.'); process.exit(1); }

  const totalSize = files.reduce((s, f) => s + f.size, 0);
  console.log(`Found ${files.length} .fit files (${(totalSize / 1024 / 1024).toFixed(1)} MB)`);

  console.log('Resolving target user...');
  const userId = await getUserId();
  console.log(`Target user_id: ${userId}`);

  console.log('Parsing + normalizing... (this may take a minute for 100+ files)');
  const t0 = Date.now();
  const normalized = await normalizeFitFiles(files.map(f => ({ name: f.name, buffer: f.buffer })));
  console.log(`Parsed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  console.log('═══ Summary ═══');
  console.log(`Sleep days:        ${normalized.sleep.length}`);
  console.log(`Stress days:       ${normalized.stress.length}`);
  console.log(`HRV days:          ${normalized.hrv.length}`);
  console.log(`Body Battery days: ${normalized.body_battery.length}`);
  console.log(`Activity sessions: ${normalized.activities.length}`);
  if (normalized.activities.length) {
    const dates = normalized.activities.map(a => a.date).sort();
    console.log(`  Date range:      ${dates[0]} → ${dates[dates.length - 1]}`);
    const sports = {};
    normalized.activities.forEach(a => sports[a.sport] = (sports[a.sport] || 0) + 1);
    console.log(`  By sport:        ${Object.entries(sports).sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s}=${c}`).join(', ')}`);
  }
  console.log(`7d sleep avg:      ${normalized.avg_sleep_7d || '—'} min`);
  console.log(`7d HRV avg:        ${normalized.avg_hrv_7d || '—'} ms`);
  console.log(`7d stress avg:     ${normalized.avg_stress_7d || '—'}`);
  console.log(`Latest body batt:  ${normalized.latest_body_battery || '—'}`);
  console.log('═══════════════\n');

  // Merge with existing
  const { data: existing } = await supabase.from('integrations').select('data')
    .eq('user_id', userId).eq('provider', 'garmin').single();
  const prev = existing?.data || {};

  const mergeByDate = (a, b) => {
    const map = {};
    (a || []).forEach(r => { if (r.date) map[r.date] = r; });
    (b || []).forEach(r => { if (r.date) map[r.date] = r; });
    return Object.values(map).sort((x, y) => y.date.localeCompare(x.date));
  };

  // Activities: dedup by start_time so multi-session days are preserved.
  // Drop legacy entries without start_time (pre-fix bug — they were
  // already deduped destructively by date and aren't recoverable).
  const mergeActivities = (a, b) => {
    const map = {};
    const key = r => r.start_time || `${r.date}_${r.sport || ''}_${r.duration_min || 0}_${r.distance_m || 0}`;
    const cleanA = (a || []).filter(r => r.start_time);
    cleanA.forEach(r => { map[key(r)] = r; });
    (b || []).forEach(r => { map[key(r)] = r; });
    return Object.values(map).sort((x, y) =>
      (y.start_time || y.date || '').localeCompare(x.start_time || x.date || '')
    );
  };

  const merged = {
    ...prev,
    ...normalized,
    sleep: mergeByDate(prev.sleep, normalized.sleep),
    stress: mergeByDate(prev.stress, normalized.stress),
    hrv: mergeByDate(prev.hrv, normalized.hrv),
    body_battery: mergeByDate(prev.body_battery, normalized.body_battery),
    activities: mergeActivities(prev.activities || [], normalized.activities || []),
  };

  console.log('Upserting to integrations table...');
  const { error } = await supabase.from('integrations').upsert({
    user_id: userId,
    provider: 'garmin',
    data: merged,
    last_synced: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' });

  if (error) {
    console.error('UPSERT ERROR:', error);
    process.exit(1);
  }
  console.log('✓ Done. Data is in Supabase, ready for agents.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
