/* Écran TV du club — lit /api/data et affiche tout en rotation. */
const { createApp } = Vue;

const REFRESH_MS = 10000;   // relecture des données
const ROTATE_MS = 10000;    // rotation des résultats
const SLIDE_MS = 12000;     // rotation du panneau du bas
const OFFLINE_AFTER_MS = 3 * 60 * 1000;
const WATCHDOG_MS = 5 * 60 * 1000;           // sans données depuis ce délai : on recharge la page
const MAX_UPTIME_MS = 6 * 60 * 60 * 1000;    // rechargement préventif après une longue journée
const MAX_SCORE = 16;
const LIVE_BEFORE_MS = 15 * 60 * 1000;      // surbrillance 15 min avant le début
const LIVE_MAX_MS = 4 * 60 * 60 * 1000;     // ... et au plus 4 h après, si le score n'est jamais encodé

function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function nomMois(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-BE', { month: 'long' });
}
function isBye(m) { return /^bye$/i.test((m.adversaire || '').trim()); }
function isFinished(m) { return m.forfait || (m.score_sp !== null && m.score_sp + m.score_adv >= MAX_SCORE); }
function hasStarted(m) { return m.score_sp !== null && m.score_adv !== null; }

createApp({
  data() {
    return {
      data: null,
      lastOk: null,
      startedAt: Date.now(),
      now: new Date(),        // secondes : uniquement pour l'horloge
      nowSlow: new Date(),    // pas de 30 s : tout le reste, pour ne pas tout recalculer chaque seconde
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
      const d = this.nowSlow;
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
    classements() { return (this.data?.classements?.divisions || []).filter((d) => d.rows && d.rows.length); },
    fiches() {
      const map = new Map();
      (this.data?.joueurs_aftt || []).forEach((j) => map.set(j.nom, j));
      return map;
    },
    rankOf() { return (nom) => this.fiches.get(nom)?.classement || ''; },
    moisCourant() {
      const d = this.nowSlow;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    },
    /** Mois affiché : le mois en cours dès qu'il a des points, sinon le dernier mois terminé */
    moisPoints() {
      const mois = this.data?.points?.mois || {};
      const cur = this.moisCourant;
      if (mois[cur]?.joueurs?.length) return { key: cur, data: mois[cur], enCours: true };
      const keys = Object.keys(mois).filter((k) => k < cur && mois[k].joueurs?.length).sort();
      if (!keys.length) return null;
      const key = keys[keys.length - 1];
      return { key, data: mois[key], enCours: false };
    },
    moisLabel() { return this.moisPoints ? nomMois(this.moisPoints.key) : ''; },
    /** Nombre de journées déjà comptabilisées ce mois */
    moisJournees() { return (this.moisPoints?.data.joueurs || []).reduce((n, j) => Math.max(n, j.journees || 0), 0); },
    /** Champions des mois terminés, hors mois actuellement mis en avant */
    palmares() {
      const mois = this.data?.points?.mois || {};
      const cur = this.moisCourant;
      const affiche = this.moisPoints?.key;
      return Object.keys(mois)
        .filter((k) => k < cur && k !== affiche && mois[k].joueurs?.length)
        .sort().reverse()
        .map((k) => ({ key: k, mois: nomMois(k), champion: mois[k].joueurs[0] }));
    },
    joueurDuMoment() {
      const cfg = this.data?.joueur_du_mois || {};
      if (cfg.mode === 'manuel' && cfg.nom) return { ...cfg, auto: false };
      // Mode auto : points du classement numérique de la fédération
      if (!this.moisPoints) return null;
      const best = this.moisPoints.data.joueurs[0];
      const femme = this.fiches.get(best.nom)?.femme;   // donné par la fédération, sinon réglage manuel
      return {
        auto: true, federation: true, enCours: this.moisPoints.enCours,
        nom: best.nom, classement: best.classement, points: best.points,
        victoires: best.victoires, matchs: best.matchs, mois: this.moisLabel,
        genre: femme === undefined ? (cfg.genre || 'H') : (femme ? 'F' : 'H'),
      };
    },
    perfs() {
      const manuelles = this.data?.meilleures_perfs || [];
      if (manuelles.length) return manuelles;
      // Sinon : meilleures perfs du mois d'après les points fédération
      return (this.moisPoints?.data.perfs || []).slice(0, 3).map((p) => ({ nom: p.nom, points: Math.round(p.delta), detail: `${p.adversaire} (${p.classement})` }));
    },
    podium() { return (this.moisPoints?.data.joueurs || []).slice(0, 3); },
    slides() {
      const s = [];
      if (this.perfs.length) s.push({ type: 'perfs' });
      if (this.podium.length) s.push({ type: 'podium' });
      if (this.palmares.length) s.push({ type: 'palmares' });
      return s.length ? s : [{ type: 'vide' }];
    },
    currentSlide() { const s = this.slides; return s[((this.slideIndex % s.length) + s.length) % s.length]; },
    clockTime() { return this.now.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }); },
    clockSeconds() { return ':' + String(this.now.getSeconds()).padStart(2, '0'); },
    clockDate() { return this.now.toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long' }); },
    offline() { return this.lastOk && this.nowSlow - this.lastOk > OFFLINE_AFTER_MS; },
  },
  async mounted() {
    await this.load();
    setInterval(() => this.load(), REFRESH_MS);
    setInterval(() => { this.now = new Date(); }, 1000);
    setInterval(() => { this.nowSlow = new Date(); }, 30000);
    setInterval(() => this.nextResult(), ROTATE_MS);
    setInterval(() => { this.slideIndex++; }, SLIDE_MS);
    setInterval(() => this.chienDeGarde(), 60000);
  },
  methods: {
    async load() {
      try {
        const res = await fetch('/api/data?t=' + Date.now(), { cache: 'no-store' });
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body.error || res.statusText);
        const prev = this.data;
        this.data = body.data;
        this.lastOk = new Date();
        this.detectFins(prev, body.data);
      } catch (e) {
        console.error('Chargement impossible :', e);
        if (!this.data) setTimeout(() => this.load(), 5000);
      }
    },
    /**
     * Filet de sécurité pour la TV du club : elle tourne des heures sans personne devant.
     * Si les données ne rentrent plus, ou après une très longue journée, on recharge la page.
     */
    chienDeGarde() {
      const maintenant = Date.now();
      if (this.lastOk && maintenant - this.lastOk > WATCHDOG_MS) { location.reload(); return; }
      const calme = !document.querySelector('.fete-overlay') && !this.matchRows.some((m) => m.live);
      if (maintenant - this.startedAt > MAX_UPTIME_MS && calme) location.reload();
    },
    /** Un résultat final vient d'arriver ou de changer (hors forfait) : petite animation avec le score */
    detectFins(prev, next) {
      if (!prev || !next?.journee || prev.journee?.numero !== next.journee.numero) return;
      const fins = next.journee.matchs.filter((m) => {
        const avant = prev.journee.matchs.find((x) => x.equipe === m.equipe);
        if (!avant || !isFinished(m) || m.forfait) return false;
        return !isFinished(avant) || avant.score_sp !== m.score_sp || avant.score_adv !== m.score_adv;
      });
      fins.forEach((m, i) => setTimeout(() => Fete.show({
        type: Fete.typeFor(m.score_sp, m.score_adv),
        titre: `${m.equipe}  ${m.score_sp} - ${m.score_adv}  ${m.adversaire}`,
        sousTitre: m.lieu === 'exterieur' ? 'À l’extérieur' : 'À domicile',
        duree: 8000,
      }), i * 9000));
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
      const diff = this.nowSlow - start;
      return diff >= -LIVE_BEFORE_MS && diff <= LIVE_MAX_MS;
    },
    score(v) { return v === null || v === undefined ? '–' : v; },
    isOurTeam(row) { return row.club === (this.data?.aftt?.club || 'Lx108'); },
    shortTeam(name) { return name.replace(/^(TT|CTT|Asbl TT|Palette|GTT|RTT)\s+/i, '').replace(/\s+Asbl\b/i, ''); },
  },
}).mount('#app');
