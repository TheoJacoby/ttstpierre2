// Configuration GitHub
const GITHUB_CONFIG = {
    token: '', // À configurer par l'utilisateur
    owner: 'theojacoby',
    repo: 'ttstpierre2',
    filePath: 'data.json'
};

// Variables globales
let selectedTeam = null;
let currentMatchData = null;
let allMatchesData = null;

// Initialisation
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    try {
        console.log('🚀 Initialisation du dashboard...');
        
        // Configurer les événements d'abord (pour que les boutons soient cliquables)
        setupEventListeners();
        
        // Demander le token GitHub si pas configuré
        if (!GITHUB_CONFIG.token) {
            requestGitHubToken();
            return;
        }
        
        // Charger les données depuis GitHub
        await loadMatchData();
        
        console.log('✅ Dashboard capitaines initialisé');
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation:', error);
        showStatus('Erreur lors du chargement des données. Les boutons d\'équipe devraient quand même fonctionner.', 'error');
        
        // Même en cas d'erreur, permettre la sélection d'équipe
        setupEventListeners();
    }
}

function requestGitHubToken() {
    const token = prompt('🔑 Entrez votre token GitHub pour permettre la mise à jour automatique des données :\n\n(Optionnel - vous pouvez laisser vide pour tester l\'interface)');
    
    if (token && token.trim()) {
        GITHUB_CONFIG.token = token.trim();
        console.log('✅ Token GitHub configuré');
        
        // Recharger les données avec le token
        loadMatchData().then(() => {
            showStatus('✅ Token configuré et données chargées !', 'success');
        }).catch(error => {
            console.error('❌ Erreur avec le token:', error);
            showStatus('❌ Token invalide ou erreur de connexion', 'error');
        });
    } else {
        console.log('ℹ️ Pas de token configuré - mode test uniquement');
        showStatus('ℹ️ Mode test - Configurez un token GitHub pour la mise à jour automatique', 'info');
    }
}

function setupEventListeners() {
    console.log('🔧 Configuration des événements...');
    
    // Boutons d'équipe
    const teamButtons = document.querySelectorAll('.team-btn');
    console.log(`📋 ${teamButtons.length} boutons d'équipe trouvés`);
    
    teamButtons.forEach((btn, index) => {
        console.log(`Bouton ${index + 1}: ${btn.dataset.team}`);
        btn.addEventListener('click', function() {
            console.log(`🖱️ Clic sur l'équipe: ${this.dataset.team}`);
            selectTeam(this.dataset.team);
        });
    });
    
    // Bouton d'envoi
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', submitResults);
        console.log('✅ Bouton d\'envoi configuré');
    } else {
        console.log('❌ Bouton d\'envoi non trouvé');
    }
    
    // Validation en temps réel
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('input', validateForm);
    });
    
    console.log('✅ Événements configurés');
}

async function loadMatchData() {
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.filePath}`, {
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const fileData = await response.json();
        const content = atob(fileData.content);
        allMatchesData = JSON.parse(content);
        
        console.log('✅ Données chargées depuis GitHub');
    } catch (error) {
        console.error('❌ Erreur lors du chargement:', error);
        throw error;
    }
}

function selectTeam(teamName) {
    console.log(`🎯 Sélection de l'équipe: ${teamName}`);
    
    // Désélectionner tous les boutons
    document.querySelectorAll('.team-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Sélectionner le bouton cliqué
    event.target.classList.add('selected');
    
    selectedTeam = teamName;
    
    // Trouver le match de cette équipe
    const match = findTeamMatch(teamName);
    if (match) {
        console.log('✅ Match trouvé:', match);
        currentMatchData = match;
        showMatchForm(match);
    } else {
        console.log('❌ Aucun match trouvé pour', teamName);
        showStatus(`Aucun match trouvé pour ${teamName}. Vérifiez que les données sont chargées.`, 'error');
        
        // Afficher quand même un formulaire de test
        showTestForm(teamName);
    }
}

function findTeamMatch(teamName) {
    if (!allMatchesData || !allMatchesData.matchs_du_jour) {
        return null;
    }
    
    return allMatchesData.matchs_du_jour.find(match => 
        match.home === teamName || match.away === teamName
    );
}

function showMatchForm(match) {
    const matchForm = document.getElementById('matchForm');
    const matchTitle = document.getElementById('matchTitle');
    
    // Afficher le formulaire
    matchForm.style.display = 'block';
    
    // Mettre à jour le titre
    matchTitle.textContent = `Match : ${match.home} vs ${match.away}`;
    
    // Générer les joueurs
    generatePlayersForm(match);
    
    // Réinitialiser les scores
    document.getElementById('ourScore').value = match.score1 || 0;
    document.getElementById('opponentScore').value = match.score2 || 0;
    
    // Valider le formulaire
    validateForm();
}

function showTestForm(teamName) {
    const matchForm = document.getElementById('matchForm');
    const matchTitle = document.getElementById('matchTitle');
    
    // Afficher le formulaire
    matchForm.style.display = 'block';
    
    // Mettre à jour le titre avec un message de test
    matchTitle.textContent = `Test - ${teamName} (données non chargées)`;
    
    // Générer un formulaire de test avec des joueurs fictifs
    const testMatch = {
        home: teamName,
        away: "Adversaire",
        joueurs: [
            { nom: "Joueur 1" },
            { nom: "Joueur 2" },
            { nom: "Joueur 3" },
            { nom: "Joueur 4" }
        ]
    };
    
    generatePlayersForm(testMatch);
    
    // Réinitialiser les scores
    document.getElementById('ourScore').value = 0;
    document.getElementById('opponentScore').value = 0;
    
    // Valider le formulaire
    validateForm();
}

function generatePlayersForm(match) {
    const playersGrid = document.getElementById('playersGrid');
    playersGrid.innerHTML = '';
    
    const players = match.joueurs || [];
    
    players.forEach((player, index) => {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';
        playerCard.innerHTML = `
            <h4>${player.nom}</h4>
            <label>Victoires :</label>
            <input type="number" 
                   id="player-${index}" 
                   min="0" 
                   max="4" 
                   value="${player.victoires || 0}"
                   placeholder="0">
        `;
        playersGrid.appendChild(playerCard);
    });
    
    // Ajouter les événements de validation
    const playerInputs = playersGrid.querySelectorAll('input');
    playerInputs.forEach(input => {
        input.addEventListener('input', validateForm);
    });
}

function validateForm() {
    const ourScore = parseInt(document.getElementById('ourScore').value) || 0;
    const opponentScore = parseInt(document.getElementById('opponentScore').value) || 0;
    
    // Vérifier que les scores sont valides
    const scoresValid = ourScore >= 0 && opponentScore >= 0 && (ourScore + opponentScore) <= 32;
    
    // Vérifier que la somme des victoires des joueurs correspond au score
    const playerInputs = document.querySelectorAll('#playersGrid input');
    let totalVictories = 0;
    
    playerInputs.forEach(input => {
        totalVictories += parseInt(input.value) || 0;
    });
    
    const victoriesValid = totalVictories === ourScore;
    
    // Activer/désactiver le bouton
    const submitBtn = document.getElementById('submitBtn');
    const isValid = scoresValid && victoriesValid && selectedTeam;
    
    submitBtn.disabled = !isValid;
    
    // Afficher les messages d'erreur
    if (ourScore > 0 || opponentScore > 0) {
        if (!scoresValid) {
            showStatus('Les scores doivent être valides (max 16 chacun)', 'error');
        } else if (!victoriesValid) {
            showStatus(`La somme des victoires (${totalVictories}) doit correspondre au score de votre équipe (${ourScore})`, 'error');
        } else {
            showStatus('Formulaire valide', 'success');
        }
    }
}

async function submitResults() {
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');
    
    // Afficher l'état de chargement
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    
    try {
        // Collecter les données du formulaire
        const formData = collectFormData();
        
        // Mettre à jour les données
        updateMatchData(formData);
        
        // Envoyer vers GitHub
        await sendToGitHub();
        
        showStatus('✅ Résultats envoyés avec succès !', 'success');
        
        // Réinitialiser le formulaire après 3 secondes
        setTimeout(() => {
            resetForm();
        }, 3000);
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'envoi:', error);
        showStatus(`❌ Erreur lors de l'envoi: ${error.message}`, 'error');
    } finally {
        // Masquer l'état de chargement
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

function collectFormData() {
    const ourScore = parseInt(document.getElementById('ourScore').value);
    const opponentScore = parseInt(document.getElementById('opponentScore').value);
    
    const players = [];
    const playerInputs = document.querySelectorAll('#playersGrid input');
    
    playerInputs.forEach((input, index) => {
        const playerName = currentMatchData.joueurs[index].nom;
        players.push({
            nom: playerName,
            victoires: parseInt(input.value) || 0
        });
    });
    
    return {
        ourScore,
        opponentScore,
        players
    };
}

function updateMatchData(formData) {
    // Trouver l'index du match dans les données
    const matchIndex = allMatchesData.matchs_du_jour.findIndex(match => 
        match.home === selectedTeam || match.away === selectedTeam
    );
    
    if (matchIndex !== -1) {
        // Mettre à jour les scores
        allMatchesData.matchs_du_jour[matchIndex].score1 = formData.ourScore;
        allMatchesData.matchs_du_jour[matchIndex].score2 = formData.opponentScore;
        
        // Mettre à jour les joueurs
        allMatchesData.matchs_du_jour[matchIndex].joueurs = formData.players;
        
        console.log('✅ Données mises à jour localement');
    }
}

async function sendToGitHub() {
    try {
        // Récupérer le SHA du fichier existant
        const getResponse = await fetch(`https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.filePath}`, {
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!getResponse.ok) {
            throw new Error(`Erreur lors de la récupération du fichier: ${getResponse.status}`);
        }
        
        const fileData = await getResponse.json();
        const sha = fileData.sha;
        
        // Préparer le contenu
        const content = JSON.stringify(allMatchesData, null, 2);
        const encodedContent = btoa(unescape(encodeURIComponent(content)));
        
        // Envoyer la mise à jour
        const updateResponse = await fetch(`https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.filePath}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Update match results - ${selectedTeam} vs ${currentMatchData.home === selectedTeam ? currentMatchData.away : currentMatchData.home}`,
                content: encodedContent,
                sha: sha
            })
        });
        
        if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            throw new Error(`Erreur GitHub: ${errorData.message || updateResponse.statusText}`);
        }
        
        console.log('✅ Données envoyées vers GitHub avec succès');
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'envoi vers GitHub:', error);
        throw error;
    }
}

function showStatus(message, type) {
    const statusMessage = document.getElementById('statusMessage');
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    
    // Masquer le message après 5 secondes
    setTimeout(() => {
        statusMessage.textContent = '';
        statusMessage.className = 'status-message';
    }, 5000);
}

function resetForm() {
    // Réinitialiser la sélection d'équipe
    document.querySelectorAll('.team-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Masquer le formulaire
    document.getElementById('matchForm').style.display = 'none';
    
    // Réinitialiser les variables
    selectedTeam = null;
    currentMatchData = null;
    
    // Masquer le message de statut
    showStatus('', '');
}
