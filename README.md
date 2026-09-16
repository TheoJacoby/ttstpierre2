# TT Saint-Pierre — Dashboard TV & saisie des scores

Site du club de tennis de table Saint-Pierre : un écran TV pour la salle, une page pour que les
capitaines encodent les scores pendant la soirée, et une page admin pour préparer les journées.

| Page | URL | Pour qui |
|------|-----|----------|
| Écran TV | `/` | la TV du club (s'actualise seule toutes les 30 s) |
| Saisie des scores | `/capitaine` | les capitaines, sur leur téléphone |
| Administration | `/admin` | le responsable du site |

Hébergé sur **Cloudflare Workers** (gratuit). Les données vivent dans un stockage KV, il n'y a plus
de fichier `data.json` à modifier à la main ni de token GitHub dans le navigateur.

## Comment ça marche

- **Le samedi**, chaque capitaine ouvre `/capitaine`, choisit son équipe, met à jour les victoires
  de ses 4 joueurs et celles de l'adversaire au fil de la soirée, et appuie sur *Enregistrer*.
  Le score de l'équipe est la somme des victoires. Total plafonné à 16. Forfait possible en un bouton.
- **La TV** affiche les matchs du jour, fait tourner les résultats déjà encodés (avec les joueurs),
  calcule le joueur du mois et le top des joueurs de la saison, et fait défiler perfs / annonces.
- **Pendant la semaine**, l'admin publie la journée suivante (adversaires, lieu, heure) : la journée
  précédente part dans l'historique avec ses scores. Il peut aussi gérer les équipes, les joueurs,
  le joueur du mois (auto ou manuel), les meilleures perfs, et télécharger une sauvegarde.

## Fédération (AFTT)

Le serveur interroge l'API publique de la fédération (`api.aftt.be`, TabT) pour le club Lx108 :

- **Import d'une semaine** (admin, onglet Journée) : adversaires, lieux, dates et heures officiels pour les six équipes. L'admin vérifie puis publie.
- **Synchronisation** (admin, onglet Équipes, et automatiquement chaque nuit à 04:00 UTC) : divisions des équipes, membres du club avec leur classement (proposés aux capitaines), classement de chaque division (affiché sur la TV).
- **Publication automatique** (option, désactivée par défaut) : chaque nuit, si la journée en cours est jouée, la semaine suivante est publiée sans intervention.

**Deux sources, car l'API SOAP refuse les requêtes venant du réseau Cloudflare :**

- classements et membres : lus sur les pages de data.aftt.be depuis le serveur (chaque nuit et à la demande) ;
- calendrier (dates, heures, adversaires, lieux) : fixe pour la saison, exporté depuis un ordinateur avec
  `npm run calendrier` (fichier `data/calendrier.json`), puis `npm run deploy`. À refaire seulement si la
  fédération modifie le calendrier en cours de saison (match remis) ; une date peut aussi être corrigée à la main dans l'admin.

Si tout est indisponible, la saisie manuelle reste possible comme avant. Le code du client est dans `src/aftt.js`.

## Structure

```
public/            fichiers servis tels quels
  index.html + tv.js + tv.css        écran TV
  capitaine.html + capitaine.js      saisie des scores
  admin.html + admin.js              administration
  app.css, api.js                    partagés par capitaine & admin
  vendor/vue.global.prod.js          Vue 3 (local, pas de CDN)
src/worker.js      API (/api/data, /api/login, /api/capitaine, /api/admin) + validation + tâche planifiée
src/aftt.js        client de l'API de la fédération (TabT)
data/seed.json     données de départ d'une saison (équipes, joueurs, adversaires connus)
wrangler.toml      configuration Cloudflare
```

## Développement local

```bash
npm install
npm run dev          # http://127.0.0.1:8787
```

Les mots de passe locaux sont dans `.dev.vars` (fichier ignoré par git) : `capitaine-test` et `admin-test`.
Les données locales sont stockées dans `.wrangler/` ; au premier lancement, `data/seed.json` est utilisé.

## Déploiement (une fois)

1. Créer un compte gratuit sur https://dash.cloudflare.com puis, dans le dossier du projet :
   ```bash
   npx wrangler login
   ```
2. Créer l'espace de stockage et coller l'`id` obtenu dans `wrangler.toml` (ligne `id = ...`) :
   ```bash
   npx wrangler kv namespace create DATA
   ```
3. Définir les deux mots de passe (ils sont demandés à la saisie, jamais écrits dans le code) :
   ```bash
   npx wrangler secret put CAPTAIN_PASSWORD
   npx wrangler secret put ADMIN_PASSWORD
   ```
4. Déployer :
   ```bash
   npm run deploy
   ```
   L'URL est affichée à la fin (`https://ttstpierre.<ton-sous-domaine>.workers.dev`).
   Un nom de domaine personnalisé peut être ajouté plus tard dans le dashboard Cloudflare.

Ensuite, à chaque modification du code : `npm run deploy`. Les données ne sont pas touchées par un déploiement.

## Règles métier

- Un interclub = 16 matchs, 4 joueurs par équipe, 4 simples chacun.
- Score de Saint-Pierre = somme des victoires des joueurs ; score adverse encodé séparément ; total ≤ 16.
- Statuts : *À venir* (rien encodé), *En cours* (< 16), *Terminé* (= 16), *Forfait*, *Bye*.
- Joueur du mois automatique = le plus de victoires sur le mois en cours (ou le dernier mois joué).
- Les annonces disparaissent après leur date de fin.
