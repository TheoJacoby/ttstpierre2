/* Page admin : préparation des journées, équipes, extras, sauvegardes. */
const { createApp } = Vue;

function nextSaturday(fromIso) {
  const d = fromIso ? new Date(fromIso + 'T12:00:00') : new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

createApp({
  data() {
    return {
      TT: window.TT,
      password: TT.getPassword(),
      role: null, loading: false, loginError: '', loadError: '',
      data: null,
      tab: 'journee',
      saving: false,
      journeeForm: { numero: 1, date: '', matchs: [] },
      afttSemaine: 1, importing: false, importInfo: '', autoImport: false, compterTournois: false,
      equipesForm: { equipesText: '', titulaires: {}, joueursText: '', vendredi_domicile: [] },
      extrasForm: { joueur_du_mois: {}, meilleures_perfs: [], annonces: [] },
      toast: { text: '', error: false },
      dialog: { open: false, text: '', input: null, okLabel: 'Confirmer', placeholder: '', resolve: () => {} },
    };
  },
  computed: {
    currentHasScores() { return this.data?.journee?.matchs.some((m) => m.score_sp !== null) || false; },
    equipesList() { return this.equipesForm.equipesText.split('\n').map((s) => s.trim()).filter(Boolean); },
    moisCourant() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; },
    moisTries() {
      const mois = this.data?.points?.mois || {};
      return Object.fromEntries(Object.keys(mois).sort().reverse().slice(0, 3).map((k) => [k, mois[k]]));
    },
  },
  async mounted() { if (this.password) await this.login(true); },
  methods: {
    async login(silent = false) {
      this.loading = true; this.loginError = '';
      try {
        const res = await TT.post('/api/login', { password: this.password });
        if (res.role !== 'admin') throw new Error('Ce mot de passe est celui des capitaines, pas de l’admin');
        this.role = res.role;
        TT.setPassword(this.password);
        await this.reload();
      } catch (e) {
        if (!silent) this.loginError = e.message;
        if (/mot de passe/i.test(e.message)) { TT.clearPassword(); this.password = ''; }
      } finally { this.loading = false; }
    },
    logout() { TT.clearPassword(); this.role = null; this.password = ''; this.data = null; },
    async reload() {
      this.loadError = '';
      try { this.setData(await TT.getData()); } catch (e) { this.loadError = e.message; }
    },
    setData(data) {
      this.data = data;
      const j = data.journee;
      const hasScores = j.matchs.some((m) => m.score_sp !== null);
      const samedi = hasScores ? nextSaturday(j.date) : (j.date || nextSaturday());
      this.autoImport = !!data.aftt?.auto_import;
      this.compterTournois = !!data.aftt?.compter_tournois;
      this.afttSemaine = hasScores ? j.numero + 1 : j.numero;
      this.journeeForm = {
        numero: hasScores ? j.numero + 1 : j.numero,
        date: samedi,
        matchs: data.equipes.map((e) => {
          const cur = j.matchs.find((m) => m.equipe === e) || {};
          const row = {
            equipe: e,
            adversaire: hasScores ? '' : (cur.adversaire || ''),
            lieu: hasScores ? (cur.lieu === 'exterieur' ? 'domicile' : 'exterieur') : (cur.lieu || 'domicile'),
            heure: cur.heure || '',
            note: hasScores ? '' : (cur.note || ''),
            jour: 'samedi', date: samedi,
          };
          if (hasScores) this.onLieuChange(row, samedi);       // nouvelle journée : applique la règle du vendredi
          else if (cur.date && cur.date !== j.date) {           // journée en cours rééditée : reprend son jour
            row.date = cur.date;
            row.jour = cur.date === TT.addDays(j.date, -1) ? 'vendredi' : 'autre';
          } else if (!cur.adversaire) this.onLieuChange(row, samedi); // ligne pas encore préparée : règle du vendredi
          return row;
        }),
      };
      this.equipesForm = {
        equipesText: data.equipes.join('\n'),
        titulaires: Object.fromEntries(data.equipes.map((e) => [e, (data.titulaires?.[e] || []).join(', ')])),
        joueursText: (data.joueurs_club || []).join('\n'),
        vendredi_domicile: [...(data.vendredi_domicile || [])],
      };
      this.extrasForm = {
        joueur_du_mois: { mode: 'auto', nom: '', victoires: 0, performances: 0, points: 0, mois: '', genre: 'H', ...(data.joueur_du_mois || {}) },
        meilleures_perfs: (data.meilleures_perfs || []).map((p) => ({ ...p })),
        annonces: (data.annonces || []).map((a) => ({ ...a })),
      };
    },
    async send(payload, okText) {
      this.saving = true;
      try {
        const res = await TT.post('/api/admin', { password: this.password, ...payload });
        this.setData(res.data);
        this.showToast(okText);
        return true;
      } catch (e) { this.showToast(e.message, true); return false; }
      finally { this.saving = false; }
    },
    /** Domicile + équipe « vendredi » → vendredi 20:00 ; sinon samedi */
    onLieuChange(row, samedi = this.journeeForm.date) {
      const vendredi = row.lieu === 'domicile' && (this.data.vendredi_domicile || []).includes(row.equipe);
      row.jour = vendredi ? 'vendredi' : 'samedi';
      if (vendredi) row.heure = '20:00';
      else if (row.heure === '20:00') row.heure = '';
      this.onJourChange(row, samedi);
    },
    onJourChange(row, samedi = this.journeeForm.date) {
      if (row.jour === 'samedi') row.date = samedi;
      else if (row.jour === 'vendredi') { row.date = TT.addDays(samedi, -1); if (!row.heure) row.heure = '20:00'; }
      else if (!row.date) row.date = samedi;
    },
    async importerAftt() {
      this.importing = true; this.importInfo = '';
      try {
        const res = await TT.post('/api/admin', { password: this.password, action: 'aftt_semaine', semaine: this.afttSemaine });
        const j = res.journee;
        this.journeeForm = {
          numero: j.numero, date: j.date,
          matchs: j.matchs.map((m) => ({ ...m, jour: m.date === j.date ? 'samedi' : (m.date === TT.addDays(j.date, -1) ? 'vendredi' : 'autre') })),
        };
        const byes = j.matchs.filter((m) => /^bye$/i.test(m.adversaire)).length;
        this.importInfo = `✔ Semaine ${j.numero} chargée (${j.matchs.length - byes} rencontres${byes ? ', ' + byes + ' bye' : ''}).`;
      } catch (e) { this.showToast(e.message, true); }
      finally { this.importing = false; }
    },
    async syncAftt() {
      this.importing = true;
      try { await this.send({ action: 'aftt_sync' }, 'Fédération synchronisée ✔'); }
      finally { this.importing = false; }
    },
    moisLabel(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' }); },
    async syncPoints() {
      this.importing = true;
      try { await this.send({ action: 'aftt_points' }, 'Points recalculés ✔'); }
      finally { this.importing = false; }
    },
    saveCompterTournois() { this.send({ action: 'aftt_config', compter_tournois: this.compterTournois }, 'Réglage enregistré · pense à recalculer'); },
    saveAutoImport() { this.send({ action: 'aftt_config', auto_import: this.autoImport }, this.autoImport ? 'Publication automatique activée' : 'Publication automatique désactivée'); },
    async publishJournee() {
      this.journeeForm.matchs.forEach((m) => { if (m.jour !== 'autre') this.onJourChange(m); });
      const empty = this.journeeForm.matchs.filter((m) => !m.adversaire).map((m) => m.equipe);
      let txt = `Publier la journée ${this.journeeForm.numero} du ${TT.dateLabel(this.journeeForm.date)} ?`;
      if (empty.length) txt += ` Sans adversaire : ${empty.join(', ')}.`;
      if (this.currentHasScores) txt += ` La journée ${this.data.journee.numero} sera archivée avec ses scores.`;
      if (!(await this.ask(txt, { okLabel: 'Publier' }))) return;
      this.send({ action: 'journee', ...this.journeeForm }, 'Journée publiée ✔');
    },
    saveEquipes() {
      const equipes = this.equipesList;
      const titulaires = Object.fromEntries(equipes.map((e) => [e, (this.equipesForm.titulaires[e] || '').split(',').map((s) => s.trim()).filter(Boolean)]));
      const joueurs_club = this.equipesForm.joueursText.split('\n').map((s) => s.trim()).filter(Boolean);
      this.send({ action: 'equipes', equipes, titulaires, joueurs_club, vendredi_domicile: this.equipesForm.vendredi_domicile }, 'Équipes enregistrées ✔');
    },
    saveExtras() { this.send({ action: 'extras', ...this.extrasForm }, 'Enregistré ✔'); },
    download() {
      const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ttstpierre-${this.data.saison}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async restore(ev) {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!(await this.ask(`Remplacer TOUTES les données actuelles par le fichier "${file.name}" ?`, { okLabel: 'Remplacer' }))) return;
        await this.send({ action: 'restore', data: parsed }, 'Sauvegarde restaurée ✔');
      } catch (e) { this.showToast('Fichier invalide : ' + e.message, true); }
      finally { ev.target.value = ''; }
    },
    async resetSeason() {
      if ((await this.ask('Tape RESET pour confirmer la remise à zéro de la saison :', { input: '', okLabel: 'Réinitialiser' })) !== 'RESET') return;
      this.send({ action: 'reset' }, 'Saison réinitialisée');
    },
    resultClass(m) {
      if (m.score_sp === null || m.score_sp + m.score_adv < 16) return '';
      return m.score_sp > m.score_adv ? 'win' : m.score_sp < m.score_adv ? 'loss' : 'draw';
    },
    /** Confirmation / saisie dans la page : renvoie une promesse (false ou null si annulé) */
    ask(text, { input = null, okLabel = 'Confirmer', placeholder = '' } = {}) {
      return new Promise((resolve) => { this.dialog = { open: true, text, input, okLabel, placeholder, resolve }; });
    },
    closeDialog(ok) {
      const d = this.dialog; this.dialog = { ...d, open: false };
      d.resolve(ok ? (d.input !== null ? d.input.trim() : true) : (d.input !== null ? null : false));
    },
    showToast(text, error = false) {
      this.toast = { text, error };
      clearTimeout(this._t);
      this._t = setTimeout(() => { this.toast.text = ''; }, error ? 5000 : 3000);
    },
  },
}).mount('#app');
