# 🎵 Blind Test Spotify — Guide de déploiement

## Structure du projet
```
blind-test/
├── backend/       ← Serveur Node.js (Railway)
│   ├── server.js
│   ├── package.json
│   └── .env.example
└── frontend/      ← Site statique (Netlify)
    ├── index.html
    ├── game.html
    └── style.css
```

---

## Étape 1 — Créer une app Spotify

1. Va sur https://developer.spotify.com/dashboard
2. Clique **"Create app"**
3. Nom : `Blind Test` — Description : ce que tu veux
4. Redirect URI : `https://TON-APP.up.railway.app/auth/callback` *(tu reviendras compléter ça après l'étape 3)*
5. Coche **Web API** → Sauvegarde
6. Copie le **Client ID** et le **Client Secret**

---

## Étape 2 — Déployer le backend sur Railway

1. Va sur https://railway.app → crée un compte (GitHub recommandé)
2. Clique **"New Project"** → **"Deploy from GitHub repo"**
   - Pousse ton dossier `backend/` sur GitHub d'abord, OU
   - Utilise **"Empty project"** puis uploade les fichiers manuellement
3. Dans Railway, va dans **Variables** et ajoute :
   ```
   SPOTIFY_CLIENT_ID=xxx
   SPOTIFY_CLIENT_SECRET=xxx
   FRONTEND_URL=https://ton-site.netlify.app
   PORT=4000
   ```
4. Railway te donne une URL du type : `https://blind-test-xxx.up.railway.app`
5. **Retourne dans le dashboard Spotify** et mets cette URL dans Redirect URI :
   `https://blind-test-xxx.up.railway.app/auth/callback`

---

## Étape 3 — Déployer le frontend sur Netlify

1. Va sur https://netlify.com → crée un compte
2. Glisse-dépose ton dossier `frontend/` sur la page d'accueil de Netlify
3. Netlify te donne une URL du type : `https://amazing-name-123.netlify.app`
4. **Mets cette URL dans `FRONTEND_URL`** dans les variables Railway

### Important : mettre l'URL du backend dans le frontend

Dans `frontend/index.html` et `frontend/game.html`, trouve et remplace :
```js
'https://TON-APP.up.railway.app'
```
par ton URL Railway réelle. Fais-le dans les deux fichiers, puis re-dépose sur Netlify.

---

## Étape 4 — Tester en local (optionnel)

```bash
# Terminal 1 — backend
cd backend
cp .env.example .env    # remplis les vraies valeurs
npm install
npm run dev

# Terminal 2 — frontend (n'importe quel serveur statique)
cd frontend
npx serve .
# ou ouvre index.html directement dans le navigateur
```

---

## Comment jouer

1. **L'hôte** crée une salle → partage le code 5 lettres à ses amis
2. **Chaque joueur** rejoint avec le code et charge ses morceaux :
   - Via un **lien de playlist publique** Spotify
   - Via **connexion Spotify** (titres likés ou playlists perso)
3. L'hôte **lance la partie**
4. Chaque manche : un extrait audio joue → tout le monde vote
5. Le score s'affiche après chaque manche → podium final !

---

## Notes importantes

- Les extraits audio viennent de l'API Spotify (30 secondes max)
- Seuls les titres **avec preview audio** sont utilisés (environ 60-70% des morceaux)
- La connexion OAuth Spotify est nécessaire pour accéder aux **titres likés** et playlists privées
- Railway gratuit = 5$/mois de crédit offert → largement suffisant pour jouer entre amis

---

## En cas de problème

- **"Salle introuvable"** → vérifie que le backend est bien lancé et l'URL correcte
- **Pas de son** → Spotify exige HTTPS en production (Netlify et Railway le font automatiquement)
- **Erreur Spotify** → vérifie le Client ID/Secret et le Redirect URI exact
