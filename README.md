# Dashboard Tennis de Table - Vue.js

## Description
Dashboard dynamique pour club de tennis de table, construit avec Vue.js 3. Toutes les données proviennent d'un unique fichier JSON.

## Fonctionnalités
- ✅ Rotation automatique des résultats des équipes A→G toutes les 10 secondes
- ✅ Affichage domicile/extérieur adaptatif
- ✅ Matchs du jour (n'affiche que les matchs avec score)
- ✅ Joueur/Joueuse du mois avec avatar adapté au genre
- ✅ Meilleures performances du mois
- ✅ Mise à jour automatique toutes les 60 secondes depuis le JSON
- ✅ Optimisé pour TV 43 pouces (1920px)

## Structure
```
ping2/
├── index.html          # Template Vue.js
├── app.js              # Application Vue.js
├── styles.css          # Styles CSS
├── data.json           # SOURCE DE DONNÉES UNIQUE
└── README.md
```

## Utilisation

### En local
Pour tester en local, vous devez utiliser un serveur HTTP (pas file://):

```bash
cd /Users/theojacoby/Desktop/ping2
python3 -m http.server 8080
```

Puis ouvrir: `http://localhost:8080`

### Sur GitHub Pages

1. **Push initial** :
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```

2. **Activer GitHub Pages** :
   - Repository Settings > Pages
   - Source: Deploy from branch `main` / root

3. **Mises à jour hebdomadaires** :
   - Modifiez uniquement `data.json`
   - Commit & push:
     ```bash
     git add data.json
     git commit -m "Update week XX"
     git push
     ```
   - Le site se met à jour automatiquement (1-2 min)

## Format du fichier data.json

```json
{
  "equipes": ["Saint-Pierre A", "Saint-Pierre B", ..., "Saint-Pierre G"],
  "equipes_data": {
    "Saint-Pierre A": {
      "equipe1": "Saint-Pierre A",
      "equipe2": "Adversaire",
      "lieu": "domicile",
      "score1": 12,
      "score2": 4,
      "joueurs": [
        { "nom": "Joueur 1", "victoires": 3 },
        { "nom": "Joueur 2", "victoires": 4 },
        { "nom": "Joueur 3", "victoires": 3 },
        { "nom": "Joueur 4", "victoires": 2 }
      ]
    }
  },
  "joueur_du_mois": {
    "nom": "Nom Prénom",
    "victoires": 12,
    "performances": 5,
    "points": 64,
    "mois": "octobre",
    "genre": "H"
  },
  "matchs_du_jour": [
    { "home": "Équipe A", "away": "Équipe B", "score1": 12, "score2": 4 }
  ],
  "meilleures_perfs": [
    { "nom": "Joueur", "points": 36 }
  ]
}
```

## Notes importantes
- **Règle des scores** : score1 + score2 = 16
- **4 joueurs par équipe** obligatoire
- **Genre** : "H" (Homme) ou "F" (Femme) pour le joueur du mois
- **Lieu** : "domicile" ou "exterieur" pour chaque équipe
- **Matchs sans score** : mettre `score1: null, score2: null` pour ne pas afficher

## Technologies
- Vue.js 3 (CDN)
- Vanilla CSS
- Fetch API pour charger le JSON
- GitHub Pages pour l'hébergement

## Support
Compatible avec tous les navigateurs modernes et optimisé pour affichage TV full HD.


