/* Page capitaine : encodage des scores de son équipe pendant la soirée. */
const { createApp } = Vue;
const MAX_SCORE = 16;

createApp({
  data() {
    return {
      TT: window.TT,
      password: TT.getPassword(),
      role: null,
      loading: false,
      loginError: '',
      loadError: '',
      data: null,
      selectedTeam: null,
      form: { joueurs: [], score_adv: 0, forfait: null },
      saving: false,
      toast: { text: '', error: false },
      dialog: { open: false, text: '', input: null, okLabel: 'Confirmer', placeholder: '', resolve: () => {} },
    };
  },
  computed: {
    journeeLabel() { return TT.journeeLabel(this.data?.journee); },
    match() { return this.data?.journee?.matchs.find((m) => m.equipe === this.selectedTeam) || null; },
    scoreSp() { return this.form.joueurs.reduce((s, j) => s + (j.nom ? j.victoires : 0), 0); },
    total() { return this.scoreSp + this.form.score_adv; },
    finished() { return this.total === MAX_SCORE; },
    validationError() {
      if (this.form.forfait) return '';
      if (this.total > MAX_SCORE) return `Total ${this.total} > 16 : vérifie les victoires`;
      const names = this.form.joueurs.map((j) => j.nom.trim().toLowerCase()).filter(Boolean);
      if (new Set(names).size !== names.length) return 'Un joueur apparaît deux fois';
      if (this.form.joueurs.some((j) => !j.nom && j.victoires > 0)) return 'Choisis le nom du joueur qui a des victoires';
      return '';
    },
  },
  watch: {
    'form.joueurs': {
      deep: true,
      async handler(rows) {
        for (const row of rows) {
          if (row.nom === '__nouveau__') {
            row.nom = '';
            const nom = await this.ask('Prénom / nom du nouveau joueur :', { input: '', okLabel: 'Ajouter', placeholder: 'ex : Jean Dupont' });
            if (nom) { row.nom = nom; if (!this.data.joueurs_club.includes(nom)) this.data.joueurs_club.push(nom); }
          }
        }
      },
    },
  },
  async mounted() {
    if (this.password) await this.login(true);
  },
  methods: {
    async login(silent = false) {
      this.loading = true; this.loginError = '';
      try {
        const res = await TT.post('/api/login', { password: this.password });
        this.role = res.role;
        TT.setPassword(this.password);
        await this.reload();
      } catch (e) {
        if (!silent) this.loginError = e.message;
        if (e.message.includes('Mot de passe')) { TT.clearPassword(); this.password = ''; }
      } finally { this.loading = false; }
    },
    logout() { TT.clearPassword(); this.role = null; this.password = ''; this.data = null; this.selectedTeam = null; },
    async reload() {
      this.loadError = '';
      try { this.data = await TT.getData(); } catch (e) { this.loadError = e.message; }
    },
    async selectTeam(name) {
      await this.reload();          // toujours repartir des dernières données (un autre capitaine a pu encoder)
      this.selectedTeam = name;
      this.initForm();
    },
    initForm() {
      const m = this.match;
      if (!m) return;
      const rows = (m.joueurs && m.joueurs.length ? m.joueurs : (this.data.titulaires?.[m.equipe] || []).map((nom) => ({ nom, victoires: 0 })))
        .map((j) => ({ nom: j.nom, victoires: j.victoires || 0 }));
      while (rows.length < 4) rows.push({ nom: '', victoires: 0 });
      this.form = { joueurs: rows.slice(0, 4), score_adv: m.score_adv || 0, forfait: m.forfait || null };
    },
    /** Noms hors liste fédération (surnoms, anciens noms) */
    autresNoms(row) {
      const officiels = new Set((this.data?.joueurs_aftt || []).map((j) => j.nom));
      const list = (this.data?.joueurs_club || []).filter((n) => !officiels.has(n));
      if (row.nom && !officiels.has(row.nom) && !list.includes(row.nom) && row.nom !== '__nouveau__') list.push(row.nom);
      return list.sort((a, b) => a.localeCompare(b, 'fr'));
    },
    inc(row) { if (row.victoires < 4 && this.total < MAX_SCORE) row.victoires++; },
    dec(row) { if (row.victoires > 0) row.victoires--; },
    async save() {
      if (this.validationError) return;
      this.saving = true;
      const avant = this.match ? { sp: this.match.score_sp, adv: this.match.score_adv } : {};
      try {
        const payload = {
          password: this.password, action: 'score', equipe: this.selectedTeam,
          forfait: this.form.forfait,
          score_adv: this.form.score_adv,
          joueurs: this.form.joueurs.filter((j) => j.nom).map((j) => ({ nom: j.nom.trim(), victoires: j.victoires })),
        };
        const res = await TT.post('/api/capitaine', payload);
        this.data = res.data;
        this.initForm();
        this.showToast(`Enregistré à ${TT.heure(this.match.maj)} ✔`);
        const m = this.match;
        const change = avant.sp !== m.score_sp || avant.adv !== m.score_adv;
        if (change && !m.forfait && m.score_sp + m.score_adv >= MAX_SCORE) {
          Fete.show({ type: Fete.typeFor(m.score_sp, m.score_adv), titre: `${m.equipe} ${m.score_sp} - ${m.score_adv} ${m.adversaire}`, sousTitre: 'Bien joué, résultat enregistré', duree: 5000 });
        }
      } catch (e) {
        this.showToast(e.message, true);
      } finally { this.saving = false; }
    },
    async declareForfait(which) {
      const txt = which === 'sp' ? `Déclarer un forfait de ${this.selectedTeam} (0 - 16) ?` : `Déclarer un forfait de ${this.match.adversaire || "l'adversaire"} (16 - 0) ?`;
      if (!(await this.ask(txt))) return;
      this.form.forfait = which;
      this.save();
    },
    async resetMatch() {
      if (!(await this.ask('Effacer les scores et les joueurs de ce match ?', { okLabel: 'Effacer' }))) return;
      this.form = { joueurs: [{ nom: '', victoires: 0 }, { nom: '', victoires: 0 }, { nom: '', victoires: 0 }, { nom: '', victoires: 0 }], score_adv: 0, forfait: null };
      this.save();
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
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { this.toast.text = ''; }, error ? 5000 : 3000);
    },
  },
}).mount('#app');
