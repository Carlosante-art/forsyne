// notif.js — Forsyne daglig check-in-påminnelse

const _NE = 'prv_notif_enabled';
const _NT = 'prv_notif_time';
const _NS = 'prv_notif_shown';

function notifSupported() {
  return 'Notification' in window;
}

function notifEnabled() {
  return notifSupported()
    && Notification.permission === 'granted'
    && localStorage.getItem(_NE) === '1';
}

async function enableNotif() {
  if (!notifSupported()) return false;
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    localStorage.setItem(_NE, '1');
    return true;
  }
  return false;
}

function disableNotif() {
  localStorage.removeItem(_NE);
}

function notifTime() {
  return localStorage.getItem(_NT) || '07:30';
}

function setNotifTime(t) {
  localStorage.setItem(_NT, t);
}

function checkedInToday() {
  const today = new Date().toISOString().split('T')[0];
  try {
    const cs = JSON.parse(localStorage.getItem('forsyne_checkins') || '[]');
    return cs.some(c => c.date === today);
  } catch { return false; }
}

function pastReminderTime() {
  const now = new Date();
  const [h, m] = notifTime().split(':').map(Number);
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

function shouldFireToday() {
  if (!notifEnabled()) return false;
  const today = new Date().toISOString().split('T')[0];
  if (localStorage.getItem(_NS) === today) return false;
  if (!pastReminderTime()) return false;
  if (checkedInToday()) return false;
  return true;
}

function fireReminder() {
  if (!shouldFireToday()) return;
  const today = new Date().toISOString().split('T')[0];
  localStorage.setItem(_NS, today);
  const n = new Notification('Forsyne', {
    body: 'Din dagliga check-in väntar. 60 sekunder.',
    tag: 'daily-checkin',
    requireInteraction: false
  });
  n.onclick = () => {
    window.focus();
    window.location.href = 'checkin.html';
    n.close();
  };
}

// Kör automatiskt vid sidladdning (med 1.5s fördröjning)
window.addEventListener('load', () => {
  setTimeout(fireReminder, 1500);
});

// Exponera för manuell anrop
window._notif = { enabled: notifEnabled, enable: enableNotif, disable: disableNotif, setTime: setNotifTime };
