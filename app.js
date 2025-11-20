const { createApp } = Vue;

createApp({
    data() {
        return {
            data: {
                equipes: [],
                equipes_data: {},
                joueur_du_mois: { nom: '', victoires: 0, performances: 0, points: 0, mois: '', genre: 'H' },
                matchs_du_jour: [],
                meilleures_perfs: []
            },
            dataLoaded: false,
            currentEquipeIndex: 0,
            isFading: false
        };
    },
    computed: {
        currentResult() {
            if (!this.data.equipes || !this.data.equipes.length) {
                return { leftTeam: '', rightTeam: '', leftScore: 0, rightScore: 0, joueurs: [] };
            }
            const equipeName = this.data.equipes[this.currentEquipeIndex];
            const equipeData = this.data.equipes_data[equipeName] || {};
            
            const isAway = equipeData.lieu === 'exterieur';
            const leftTeam = isAway ? equipeData.equipe2 : equipeData.equipe1;
            const rightTeam = isAway ? equipeData.equipe1 : equipeData.equipe2;
            const leftScore = isAway ? equipeData.score2 : equipeData.score1;
            const rightScore = isAway ? equipeData.score1 : equipeData.score2;
            
            return {
                leftTeam: leftTeam || '',
                rightTeam: rightTeam || '',
                leftScore: leftScore || 0,
                rightScore: rightScore || 0,
                joueurs: (equipeData.joueurs || []).slice(0, 4)
            };
        },
        matchesWithScores() {
            return (this.data.matchs_du_jour || []).filter(m => 
                m.score1 !== null && m.score2 !== null && 
                isFinite(m.score1) && isFinite(m.score2)
            );
        }
    },
    async mounted() {
        await this.loadData();
        if (this.dataLoaded) {
            this.startRotation();
            this.startAutoRefresh();
        }
    },
    methods: {
        async loadData() {
            try {
                const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
                if (res.ok) {
                    this.data = await res.json();
                    this.dataLoaded = true;
                }
            } catch (e) {
                console.error('Erreur chargement JSON:', e);
            }
        },
        startRotation() {
            if (!this.data.equipes || !this.data.equipes.length) return;
            
            setInterval(() => {
                this.isFading = true;
                setTimeout(() => {
                    this.currentEquipeIndex = (this.currentEquipeIndex + 1) % this.data.equipes.length;
                    this.isFading = false;
                }, 800);
            }, 10000);
        },
        async startAutoRefresh() {
            setInterval(async () => {
                const oldData = JSON.stringify(this.data);
                await this.loadData();
                const newData = JSON.stringify(this.data);
                if (oldData !== newData) {
                    console.log('Données mises à jour depuis le JSON');
                }
            }, 60000); // Refresh toutes les 60 secondes
        },
        getMatchStatus(score1, score2) {
            const total = score1 + score2;
            if (total === 0) {
                return 'Non commencé';
            } else if (total === 16) {
                return 'Terminé';
            } else {
                return 'En cours';
            }
        },
        getStatusClass(score1, score2) {
            const total = score1 + score2;
            if (total === 0) {
                return 'status-not-started';
            } else if (total === 16) {
                return 'status-finished';
            } else {
                return 'status-ongoing';
            }
        },
        getTeamColorClass(teamName, teamScore, opponentScore) {
            // Vérifier si c'est une équipe Saint-Pierre et si le match est terminé
            if (teamName.includes('Saint-Pierre') && (teamScore + opponentScore) === 16) {
                return teamScore > opponentScore ? 'team-winner' : 'team-loser';
            }
            return '';
        }
    }
}).mount('#app');


