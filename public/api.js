/* Petit client partagé par la page capitaine et la page admin. */
window.TT = {
  getPassword() { try { return localStorage.getItem('tt_password') || ''; } catch { return ''; } },
  setPassword(p) { try { localStorage.setItem('tt_password', p); } catch {} },
  clearPassword() { try { localStorage.removeItem('tt_password'); } catch {} },

  async getData() {
    const res = await fetch('/api/data?t=' + Date.now(), { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || 'Impossible de charger les données');
    return body.data;
  },

  async post(path, payload) {
    let res;
    try {
      res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch {
      throw new Error('Pas de connexion réseau');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `Erreur ${res.status}`);
    return body;
  },

  journeeLabel(journee) {
    if (!journee) return '';
    const [y, m, d] = (journee.date || '').split('-').map(Number);
    const date = y ? new Date(y, m - 1, d).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    return `Journée ${journee.numero}${date ? ' · ' + date : ''}`;
  },

  heure(iso) {
    return iso ? new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
  },
};
