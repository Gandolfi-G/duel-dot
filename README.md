# Duel Multiplications (MVP)

Site multijoueur en temps réel pour un duel de tables de multiplication (2 à 12), pensé pour des élèves de 12-13 ans.

## Stack
- `client/`: React + Vite + TypeScript
- `server/`: Node.js + Express + Socket.IO + TypeScript
- `shared/`: types partagés Socket/events/état de jeu

## Architecture monorepo

```text
math-duel/
├─ client/
│  ├─ src/
│  │  ├─ components/ (Home, Lobby, Duel)
│  │  ├─ lib/socket.ts + toasts
│  │  ├─ components/**/*.test.tsx
│  │  ├─ lib/**/*.test.tsx
│  │  ├─ App.tsx
│  │  └─ styles.css
├─ server/
│  └─ src/
│     ├─ game/engine.ts
│     ├─ game/engine.test.ts
│     └─ index.ts
├─ shared/
│  └─ src/socket.ts
├─ package.json
├─ eslint.config.mjs
└─ tsconfig.base.json
```

## Règles implémentées
- 2 joueurs par session
- code de session court (5 caractères alphanumériques)
- serveur autoritaire:
  - génère les questions
  - valide les réponses
  - attribue le point au premier qui répond correctement
- fin de partie à `15` points
- anti-triche MVP:
  - validation uniquement côté serveur
  - réponses ignorées après attribution du point
- pseudo temporaire (pas d'auth email/mot de passe)
- reconnexion basique via `playerToken` stocké en local
- revanche: redémarrage quand les 2 joueurs la demandent

## Events Socket (types partagés)
Fichier central: `shared/src/socket.ts`

Principaux events:
- client -> serveur:
  - `createSession`
  - `joinSession`
  - `reconnectPlayer`
  - `submitAnswer`
  - `requestRematch`
- serveur -> client:
  - `sessionState`
  - `answerFeedback`
  - `roundResolved`
  - `errorMessage`

## Commandes

### Prérequis
- Node.js 20+
- npm 10+

### Installation
```bash
npm install
```

### Développement (client + server + shared watch)
```bash
npm run dev
```

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`

### Build
```bash
npm run build
```

### Tests (client + serveur)
```bash
npm run test
```

### Mode test continu (pendant développement)
```bash
npm run test:watch
```

### Couverture de tests
```bash
npm run test:coverage
```

### Vérification complète avant commit
```bash
npm run check
```
Cette commande exécute `lint + tests + build` pour éviter les régressions quand tu ajoutes des features.

### Option recommandée: contrôle automatique à chaque `git push`
1. Active les hooks Git du projet:
```bash
./scripts/setup-git-hooks.sh
```
2. À chaque push, le hook `pre-push` exécutera automatiquement:
```bash
npm run check
```
Si un test casse, le push est bloqué jusqu'à correction.

### Qualité code
```bash
npm run lint
npm run format:check
```

## Si une dépendance manque
Commande standard:
```bash
npm install
```

Exemples ciblés:
```bash
npm install <nom-paquet> -w @math-duel/server
npm install <nom-paquet> -w @math-duel/client
npm install <nom-paquet> -D
```

## Accessibilité MVP
- boutons larges
- contraste lisible
- navigation clavier possible
- envoi de réponse avec `Entrée`

## Tests minimaux inclus
- Client:
  - layout duel (scores en haut, calcul central, input, session discrète)
  - barres de vie (0/15, 7/15, 15/15)
  - toasts (mapping des événements, disparition auto, limite à 3)
  - fin de partie (score final + actions + input bloqué)
- Serveur:
  - point attribué au plus rapide
  - mauvaise réponse => pas de point
  - soumission après lock de question => ignorée
  - arrêt de partie à 15 points
  - revanche => reset des scores et de l'état de match

Fichiers:
- `client/src/components/DuelPage.test.tsx`
- `client/src/lib/toasts.test.tsx`
- `server/src/game/engine.test.ts`

## Découpage Git conseillé (étapes cohérentes)
1. `chore(monorepo): init workspaces + configs`
   - avant: repo vide
   - après: structure client/server/shared + scripts racine
2. `feat(shared): add socket event contracts`
   - avant: pas de contrats d'événements
   - après: types partagés stricts utilisés partout
3. `feat(server): authoritative duel engine + sessions`
   - avant: pas de backend temps réel
   - après: création/rejoint/reconnexion/scoring/rematch
4. `feat(client): build french multiplayer UI flow`
   - avant: pas d'interface
   - après: Accueil, Lobby, Duel, Fin de partie
5. `test(server): add core duel tests`
   - avant: aucune couverture
   - après: tests scoring + premier correct gagnant
6. `docs: add setup, commands, architecture`
   - avant: pas de doc d'usage
   - après: README exécutable par l'équipe

## Améliorations phase 2
- classement (ELO léger ou points cumulés)
- avatars et personnalisation profil
- historique des matchs (victoires/défaites/temps moyen)
- spectateur (mode observateur)
- salons de niveaux (tables ciblées: 2-6, 7-9, 10-12)
