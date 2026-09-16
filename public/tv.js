/* Écran TV du club — lit /api/data et affiche tout en rotation. */
const { createApp } = Vue;

const REFRESH_MS = 15000;   // relecture des données
const ROTATE_MS = 10000;    // rotation des résultats
const SLIDE_MS = 12000;     // rotation du panneau du bas
const OFFLINE_AFTER_MS = 3 * 60 * 1000;
const MAX_SCORE = 16;
const LIVE_BEFORE_MS = 15 * 60 * 1000;      // surbrillance 15 min avant le début
const LIVE_MAX_MS = 4 * 60 * 60 * 1000;     // ... et au plus 4 h après, si le score n'est jamais encodé

function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isBye(m) { return /^bye$/i.test((m.adversaire || '').trim()); }
function isFinished(m) { return m.forfait || (m.score_sp !== null && m.score_sp + m.score_adv >= MAX_SCORE); }
function hasStarted(m) { return m.score_sp !== null && m.score_adv !== null; }

createApp({
  data() {
    return {
      data: null,
      lastOk: null,
      now: new Date(),
      resultIndex: 0,
      isFading: false,
      slideIndex: 0,
    };
  },
  computed: {
    loaded() { return !!this.data; },
    journee() { return this.data?.journee || { numero: 0, date: '', matchs: [] }; },
    matchs() { return this.journee.matchs || []; },
    journeeLabel() {
      const d = parseDate(this.journee.date);
      const date = d ? d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
      return `Journée ${this.journee.numero}${date ? ' · ' + date : ''}`;
    },
    started() { return this.matchs.filter(hasStarted); },
    currentClassement() {
      const list = this.classements;
      return list.length ? list[this.resultIndex % list.length] : null;
    },
    todayIso() {
      const d = this.now;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    matchRows() {
      const ref = this.journee.date;
      return this.matchs.map((m) => {
        const date = m.date || ref;
        return {
          ...this.sides(m), heure: m.heure, note: m.note, status: this.status(m),
          date,
          live: this.isLive(m, date),
          jour: date !== ref ? parseDate(date).toLocaleDateString('fr-BE', { weekday: 'short' }).replace('.', '') : '',
        };
      });
    },
    seasonStats() {
      const all = [...(this.data?.historique || []), this.journee];
      const acc = new Map();
      for (const j of all) for (const m of j.matchs || []) {
        if (!hasStarted(m) || m.forfait) continue;
        for (const p of m.joueurs || []) {
          const s = acc.get(p.nom) || { nom: p.nom, victoires: 0, matchs: 0 };
          s.victoires += p.victoires; s.matchs += 1; acc.set(p.nom, s);
        }
      }
      return [...acc.values()]
        .map((s) => ({ ...s, pct: s.matchs ? Math.round((s.victoires / (s.matchs * 4)) * 100) : 0 }))
        .sort((a, b) => b.victoires - a.victoires || b.pct - a.pct || a.nom.localeCompare(b.nom, 'fr'))
        .slice(0, 8);
    },
    /** Mois de référence pour les points fédération : le mois précédent s'il a des données, sinon le mois en cours */
    moisPoints() {
      const mois = this.data?.points?.mois || {};
      const d = this.now;
      const cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
      if (mois[prevKey]?.joueurs?.length) return { key: prevKey, data: mois[prevKey], enCours: false };
      if (mois[cur]?.joueurs?.length) return { key: cur, data: mois[cur], enCours: true };
      const keys = Object.keys(mois).filter((k) => mois[k].joueurs?.length).sort();
      return keys.length ? { key: keys.pop(), data: mois[keys[keys.length - 1]] || mois[keys.pop()], enCours: false } : null;
    },
    moisLabel() {
      if (!this.moisPoints) return '';
      const [y, m] = this.moisPoints.key.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('fr-BE', { month: 'long' }) + (this.moisPoints.enCours ? ' · en cours' : '');
    },
    joueurDuMois() {
      const cfg = this.data?.joueur_du_mois || {};
      if (cfg.mode === 'manuel' && cfg.nom) return { ...cfg, auto: false };
      // Mode auto : points du classement numérique de la fédération (fiches joueurs)
      if (this.moisPoints) {
        const best = this.moisPoints.data.joueurs[0];
        return { auto: true, federation: true, nom: best.nom, classement: best.classement, points: best.points, victoires: best.victoires, matchs: best.matchs, mois: this.moisLabel, genre: cfg.genre || 'H' };
      }
      // Mode auto : le joueur avec le plus de victoires sur le mois en cours (sinon le dernier mois joué)
      const all = [...(this.data?.historique || []), this.journee].filter((j) => j.date && j.matchs?.some(hasStarted));
      if (!all.length) return null;
      const byMonth = new Map();
      for (const j of all) {
        const d = parseDate(j.date); const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!byMonth.has(key)) byMonth.set(key, { d, matchs: [] });
        byMonth.get(key).matchs.push(...j.matchs.filter((m) => hasStarted(m) && !m.forfait));
      }
      const nowKey = `${this.now.getFullYear()}-${this.now.getMonth()}`;
      const month = byMonth.get(nowKey) || [...byMonth.values()].sort((a, b) => b.d - a.d)[0];
      const acc = new Map();
      for (const m of month.matchs) for (const p of m.joueurs || []) {
        const s = acc.get(p.nom) || { nom: p.nom, victoires: 0, matchs: 0 };
        s.victoires += p.victoires; s.matchs += 1; acc.set(p.nom, s);
      }
      const best = [...acc.values()].sort((a, b) => b.victoires - a.victoires || a.matchs - b.matchs)[0];
      if (!best) return null;
      return {
        auto: true, nom: best.nom, victoires: best.victoires, matchs: best.matchs,
        pct: Math.round((best.victoires / (best.matchs * 4)) * 100),
        mois: month.d.toLocaleDateString('fr-BE', { month: 'long' }), genre: cfg.genre || 'H',
      };
    },
    perfs() {
      const manuelles = this.data?.meilleures_perfs || [];
      if (manuelles.length) return manuelles;
      // Sinon : meilleures perfs du mois d'après les points fédération
      return (this.moisPoints?.data.perfs || []).slice(0, 3).map((p) => ({ nom: p.nom, points: Math.round(p.delta), detail: `${p.adversaire} (${p.classement})` }));
    },
    moisTop() { return (this.moisPoints?.data.joueurs || []).slice(0, 8); },
    annonces() {
      const today = this.now.toISOString().slice(0, 10);
      return (this.data?.annonces || []).filter((a) => !a.fin || a.fin >= today);
    },
    classements() { return (this.data?.classements?.divisions || []).filter((d) => d.rows && d.rows.length); },
    rankOf() {
      const map = new Map();
      (this.data?.joueurs_aftt || []).forEach((j) => map.set(j.nom, j.classement));
      return (nom) => map.get(nom) || '';
    },
    slides() {
      const s = [];
      if (this.annonces.length) s.push({ type: 'annonces' });
      if (this.perfs.length) s.push({ type: 'perfs' });
      if (this.moisTop.length) s.push({ type: 'mois' });
      if (this.seasonStats.length) s.push({ type: 'top' });
      return s.length ? s : [{ type: 'vide' }];
    },
    currentSlide() { return this.slides[this.slideIndex % this.slides.length]; },
    clockTime() { return this.now.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }); },
    clockSeconds() { return ':' + String(this.now.getSeconds()).padStart(2, '0'); },
    clockDate() { return this.now.toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long' }); },
    offline() { return this.lastOk && this.now - this.lastOk > OFFLINE_AFTER_MS; },
  },
  async mounted() {
    await this.load();
    setInterval(() => this.load(), REFRESH_MS);
    setInterval(() => { this.now = new Date(); }, 1000);
    setInterval(() => this.nextResult(), ROTATE_MS);
    setInterval(() => { this.slideIndex++; }, SLIDE_MS);
  },
  methods: {
    async load() {
      try {
        const res = await fetch('/api/data?t=' + Date.now(), { cache: 'no-store' });
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body.error || res.statusText);
        this.data = body.data;
        this.lastOk = new Date();
      } catch (e) {
        console.error('Chargement impossible :', e);
        if (!this.data) setTimeout(() => this.load(), 5000);
      }
    },
    nextResult() {
      if (this.classements.length < 2) return;
      this.isFading = true;
      setTimeout(() => { this.resultIndex++; this.isFading = false; }, 700);
    },
    sides(m) {
      const home = m.lieu !== 'exterieur';
      const parts = /^(.*?)\s+([A-Z])$/.exec(m.equipe || '');     // "Saint-Pierre C" -> base + lettre
      const sp = { name: m.equipe, base: parts ? parts[1] : m.equipe, letter: parts ? parts[2] : '', score: m.score_sp, isSp: true };
      const adv = { name: m.adversaire || '—', score: m.score_adv, isSp: false };
      return {
        left: home ? sp : adv, right: home ? adv : sp, home,
        joueurs: m.joueurs || [], forfait: m.forfait, finished: isFinished(m), bye: isBye(m),
        spClass: this.spClass(m),
      };
    },
    spClass(m) {
      if (!isFinished(m)) return '';
      if (m.score_sp > m.score_adv) return 'team-winner';
      if (m.score_sp < m.score_adv) return 'team-loser';
      return 'team-draw';
    },
    status(m) {
      if (isBye(m)) return { text: 'Bye', cls: 'status-not-started' };
      if (m.forfait) return { text: m.forfait === 'sp' ? 'Forfait' : 'Forfait adv.', cls: 'status-finished' };
      if (!hasStarted(m)) return { text: 'À venir', cls: 'status-not-started' };
      if (isFinished(m)) return { text: 'Terminé', cls: 'status-finished' };
      return { text: `En cours · ${m.score_sp + m.score_adv}/${MAX_SCORE}`, cls: 'status-ongoing' };
    },
    /** Match à domicile en surbrillance : de 15 min avant l'heure jusqu'à la fin (ou 4 h après le début). */
    isLive(m, date) {
      if (m.lieu === 'exterieur' || isBye(m) || isFinished(m) || !m.heure) return false;
      const [h, min] = m.heure.split(':').map(Number);
      const start = parseDate(date);
      if (!start || isNaN(h)) return false;
      start.setHours(h, min || 0, 0, 0);
      const diff = this.now - start;
      return diff >= -LIVE_BEFORE_MS && diff <= LIVE_MAX_MS;
    },
    score(v) { return v === null || v === undefined ? '–' : v; },
    isOurTeam(row) { return row.club === (this.data?.aftt?.club || 'Lx108'); },
    shortTeam(name) { return name.replace(/^(TT|CTT|Asbl TT|Palette|GTT|RTT)\s+/i, '').replace(/\s+Asbl\b/i, ''); },
  },
}).mount('#app');
