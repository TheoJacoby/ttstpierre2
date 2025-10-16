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
        
        // Même en cas d'erreur, permettre la sélection d'équipe
        setupEventListeners();
    }
}

function requestGitHubToken() {
    // Vérifier si le token est déjà stocké
    const storedToken = localStorage.getItem('github_token');
    
    if (storedToken) {
        GITHUB_CONFIG.token = storedToken;
        console.log('✅ Token GitHub récupéré depuis le stockage local');
        
        // Recharger les données avec le token stocké
        loadMatchData().then(() => {
            console.log('✅ Données chargées avec le token sauvegardé');
        }).catch(error => {
            console.error('❌ Erreur avec le token stocké:', error);
            // Token invalide, le supprimer
            localStorage.removeItem('github_token');
            requestGitHubToken();
        });
        return;
    }
    
    // Demander le mot de passe capitaine
    const password = prompt('🔐 Entrez le mot de passe capitaine pour accéder au système :\n\n(Le token GitHub sera configuré automatiquement)');
    
    if (password && password.trim()) {
        // Vérifier le mot de passe et récupérer le token crypté
        const encryptedToken = validateCaptainPassword(password.trim());
        
        if (encryptedToken) {
            // Décrypter le token
            const token = decryptToken(encryptedToken);
            if (token) {
                GITHUB_CONFIG.token = token;
                localStorage.setItem('github_token', token);
                console.log('✅ Token GitHub décrypté et configuré');
                
                // Recharger les données avec le token
                loadMatchData().then(() => {
                    console.log('✅ Accès autorisé ! Données chargées.');
                }).catch(error => {
                    console.error('❌ Erreur avec le token:', error);
                    localStorage.removeItem('github_token');
                });
            } else {
                console.log('❌ Erreur de décryptage du token');
            }
        } else {
            console.log('❌ Mot de passe capitaine invalide');
        }
    } else {
        console.log('ℹ️ Pas de mot de passe saisi - mode test uniquement');
    }
}

function validateCaptainPassword(password) {
    // Liste des mots de passe capitaines avec tokens cryptés
    const captainPasswords = {
        'ping2024': 'Z2l0aHViX3BhdF8xMUJSQjRFR0EwZll3ZXc0RDY1Y3Q2X004UXFnM1NlR0k3YTZpeXBTZTNCQjRjYUVJY2tCSDJGMmpYbld4U0tjdnRQNjdJQUtSNUlMSWhDV1JY',
        'saintpierre': 'Z2l0aHViX3BhdF8xMUJSQjRFR0EwZll3ZXc0RDY1Y3Q2X004UXFnM1NlR0k3YTZpeXBTZTNCQjRjYUVJY2tCSDJGMmpYbld4U0tjdnRQNjdJQUtSNUlMSWhDV1JY',
        'tennis2024': 'Z2l0aHViX3BhdF8xMUJSQjRFR0EwZll3ZXc0RDY1Y3Q2X004UXFnM1NlR0k3YTZpeXBTZTNCQjRjYUVJY2tCSDJGMmpYbld4U0tjdnRQNjdJQUtSNUlMSWhDV1JY'
    };
    
    return captainPasswords[password] || null;
}

function decryptToken(encryptedToken) {
    try {
        // Décrypter le token (base64)
        return atob(encryptedToken);
    } catch (error) {
        console.error('❌ Erreur de décryptage:', error);
        return null;
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
        console.log('🔄 Tentative de chargement des données...');
        console.log('📍 URL:', `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.filePath}`);
        console.log('🔑 Token:', GITHUB_CONFIG.token ? 'Présent' : 'Manquant');
        
        const response = await fetch(`https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.filePath}`, {
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        console.log('📡 Réponse HTTP:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const fileData = await response.json();
        console.log('📄 Données reçues:', fileData);
        
        // Correction de l'encodage UTF-8
        const binaryString = atob(fileData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const content = new TextDecoder('utf-8').decode(bytes);
        
        allMatchesData = JSON.parse(content);
        
        console.log('✅ Données chargées depuis GitHub avec encodage UTF-8');
        console.log('📊 Matchs trouvés:', allMatchesData.matchs_du_jour?.length || 0);
        
        // Debug : afficher les premiers matchs pour vérifier l'encodage
        if (allMatchesData.matchs_du_jour && allMatchesData.matchs_du_jour.length > 0) {
            console.log('🔍 Premier match:', allMatchesData.matchs_du_jour[0]);
        }
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
    const team1Label = document.getElementById('team1Label');
    const team2Label = document.getElementById('team2Label');
    
    // Afficher le formulaire
    matchForm.style.display = 'block';
    
    // Mettre à jour le titre
    matchTitle.textContent = `Match : ${match.home} vs ${match.away}`;
    
    // Mettre à jour les labels avec les noms des équipes
    team1Label.textContent = `${match.home} :`;
    team2Label.textContent = `${match.away} :`;
    
    // Réinitialiser les scores
    document.getElementById('team1Score').value = match.score1 || 0;
    document.getElementById('team2Score').value = match.score2 || 0;
    
    // Valider le formulaire
    validateForm();
}

function showTestForm(teamName) {
    const matchForm = document.getElementById('matchForm');
    const matchTitle = document.getElementById('matchTitle');
    const team1Label = document.getElementById('team1Label');
    const team2Label = document.getElementById('team2Label');
    
    // Afficher le formulaire
    matchForm.style.display = 'block';
    
    // Mettre à jour le titre avec un message de test
    matchTitle.textContent = `Test - ${teamName} (données non chargées)`;
    
    // Mettre à jour les labels avec des noms de test
    team1Label.textContent = `${teamName} :`;
    team2Label.textContent = `Adversaire :`;
    
    // Réinitialiser les scores
    document.getElementById('team1Score').value = 0;
    document.getElementById('team2Score').value = 0;
    
    // Valider le formulaire
    validateForm();
}


function validateForm() {
    const team1Score = parseInt(document.getElementById('team1Score').value) || 0;
    const team2Score = parseInt(document.getElementById('team2Score').value) || 0;
    
    // Vérifier que les scores sont valides (positifs seulement)
    const scoresValid = team1Score >= 0 && team2Score >= 0;
    
    // Activer/désactiver le bouton
    const submitBtn = document.getElementById('submitBtn');
    const isValid = scoresValid && selectedTeam;
    
    submitBtn.disabled = !isValid;
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
        
        console.log('✅ Résultats envoyés avec succès !');
        
        // Réinitialiser le formulaire après 3 secondes
        setTimeout(() => {
            resetForm();
        }, 3000);
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'envoi:', error);
    } finally {
        // Masquer l'état de chargement
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

function collectFormData() {
    const team1Score = parseInt(document.getElementById('team1Score').value);
    const team2Score = parseInt(document.getElementById('team2Score').value);
    
    return {
        team1Score,
        team2Score
    };
}

function updateMatchData(formData) {
    // Trouver l'index du match dans les données
    const matchIndex = allMatchesData.matchs_du_jour.findIndex(match => 
        match.home === selectedTeam || match.away === selectedTeam
    );
    
    if (matchIndex !== -1) {
        // Mettre à jour les scores
        allMatchesData.matchs_du_jour[matchIndex].score1 = formData.team1Score;
        allMatchesData.matchs_du_jour[matchIndex].score2 = formData.team2Score;
        
        console.log('✅ Scores mis à jour localement');
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
        
    // Préparer le contenu avec encodage UTF-8 correct
    const content = JSON.stringify(allMatchesData, null, 2);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const encodedContent = btoa(String.fromCharCode(...bytes));
        
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
}

