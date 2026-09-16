/* Écran TV du club — lit /api/data et affiche tout en rotation. */
const { createApp } = Vue;

const REFRESH_MS = 30000;   // relecture des données
const ROTATE_MS = 10000;    // rotation des résultats
const SLIDE_MS = 12000;     // rotation du panneau du bas
const OFFLINE_AFTER_MS = 3 * 60 * 1000;
const MAX_SCORE = 16;

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
    rotation() {
      if (this.started.length) return { label: 'Résultats du jour', matchs: this.started };
      const hist = [...(this.data?.historique || [])].reverse().find((j) => j.matchs?.some(hasStarted));
      if (hist) return { label: `Journée ${hist.numero} · dernière journée jouée`, matchs: hist.matchs.filter(hasStarted) };
      return { label: 'Résultats', matchs: [] };
    },
    currentResult() {
      const list = this.rotation.matchs;
      if (!list.length) return null;
      return this.sides(list[this.resultIndex % list.length]);
    },
    matchRows() { return this.matchs.map((m) => ({ ...this.sides(m), heure: m.heure, note: m.note, status: this.status(m) })); },
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
    joueurDuMois() {
      const cfg = this.data?.joueur_du_mois || {};
      if (cfg.mode === 'manuel' && cfg.nom) return { ...cfg, auto: false };
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
    perfs() { return this.data?.meilleures_perfs || []; },
    annonces() {
      const today = this.now.toISOString().slice(0, 10);
      return (this.data?.annonces || []).filter((a) => !a.fin || a.fin >= today);
    },
    slides() {
      const s = [];
      if (this.annonces.length) s.push('annonces');
      if (this.perfs.length) s.push('perfs');
      if (this.seasonStats.length) s.push('top');
      return s.length ? s : ['vide'];
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
      if (this.rotation.matchs.length < 2) return;
      this.isFading = true;
      setTimeout(() => { this.resultIndex++; this.isFading = false; }, 700);
    },
    sides(m) {
      const home = m.lieu !== 'exterieur';
      const sp = { name: m.equipe, score: m.score_sp, isSp: true };
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
    score(v) { return v === null || v === undefined ? '–' : v; },
  },
}).mount('#app');
