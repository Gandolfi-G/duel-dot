# Guide complet de mise en production - Math Duel

## 1. Objectif
Ce document explique comment deployer le projet `math-duel` sur un serveur Linux (Ubuntu), avec:
- backend Node.js (Socket.IO) en service permanent,
- frontend Vite servi par Nginx,
- HTTPS (Let's Encrypt),
- redemarrage automatique,
- procedure de mise a jour.

## 2. Architecture recommandee
Option conseillee (simple et robuste):
- Domaine public: `https://duel.example.com`
- Nginx sert le frontend (`client/dist`)
- Nginx reverse proxy `\/socket.io\/` et `\/health` vers Node (`127.0.0.1:3001`)
- Process Node gere par PM2

### Pourquoi cette option
- Un seul domaine a gerer
- Pas de probleme CORS inter-domaines
- Certificat TLS unique

## 3. Prerequis
- Un serveur Ubuntu 22.04 ou 24.04
- Un nom de domaine pointant vers l'IP du serveur
- Un acces SSH
- Ports ouverts:
  - 22 (SSH)
  - 80 (HTTP)
  - 443 (HTTPS)

## 4. Preparation du serveur

### 4.1 Mettre a jour le systeme
```bash
sudo apt update && sudo apt upgrade -y
```

### 4.2 Installer les outils
```bash
sudo apt install -y git nginx ufw curl
```

### 4.3 Installer Node.js 22 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 4.4 Installer PM2
```bash
sudo npm install -g pm2
pm2 -v
```

### 4.5 Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 5. Recuperer le projet

### 5.1 Cloner le repo
```bash
cd /opt
sudo git clone <URL_DU_REPO> math-duel
sudo chown -R $USER:$USER /opt/math-duel
cd /opt/math-duel
```

### 5.2 Installer les dependances
```bash
npm ci
```

## 6. Variables d'environnement importantes

Le backend lit:
- `PORT` (defaut: `3001`)
- `CLIENT_ORIGIN` (defaut: `http://localhost:5173`)

Le frontend lit a la compilation:
- `VITE_SERVER_URL` (URL publique du serveur Socket.IO)

Pour une install sur un seul domaine, utiliser:
- `CLIENT_ORIGIN=https://duel.example.com`
- `VITE_SERVER_URL=https://duel.example.com`

## 7. Build production

Depuis `/opt/math-duel`:
```bash
VITE_SERVER_URL=https://duel.example.com npm run build
```

A la fin:
- backend compile dans `server/dist`
- frontend compile dans `client/dist`

## 8. Demarrer le backend avec PM2

### 8.1 Creer un fichier PM2
Creer `/opt/math-duel/ecosystem.config.cjs`:
```js
module.exports = {
  apps: [
    {
      name: "math-duel-api",
      script: "server/dist/index.js",
      cwd: "/opt/math-duel",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        CLIENT_ORIGIN: "https://duel.example.com"
      }
    }
  ]
};
```

### 8.2 Lancer et persister
```bash
cd /opt/math-duel
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Executer la commande affichee par `pm2 startup` (une seule fois).

### 8.3 Verifier
```bash
pm2 status
pm2 logs math-duel-api --lines 100
curl -i http://127.0.0.1:3001/health
```

## 9. Configurer Nginx

Creer `/etc/nginx/sites-available/math-duel`:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name duel.example.com;

    root /opt/math-duel/client/dist;
    index index.html;

    # Socket.IO (WebSocket + fallback)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Endpoint de sante backend
    location = /health {
        proxy_pass http://127.0.0.1:3001/health;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend SPA
    location / {
        try_files $uri /index.html;
    }
}
```

Activer la conf:
```bash
sudo ln -s /etc/nginx/sites-available/math-duel /etc/nginx/sites-enabled/math-duel
sudo nginx -t
sudo systemctl reload nginx
```

## 10. Activer HTTPS (Let's Encrypt)

Installer Certbot:
```bash
sudo apt install -y certbot python3-certbot-nginx
```

Demander le certificat:
```bash
sudo certbot --nginx -d duel.example.com
```

Verifier le renouvellement automatique:
```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

## 11. Procedure de mise a jour

A chaque nouvelle version:
```bash
cd /opt/math-duel
git pull
npm ci
VITE_SERVER_URL=https://duel.example.com npm run build
pm2 restart math-duel-api --update-env
sudo systemctl reload nginx
```

## 12. Tests post-deploiement

### 12.1 Sanity checks
- Ouvrir `https://duel.example.com`
- Verifier creation de session
- Verifier connexion du 2e joueur
- Verifier duel en temps reel
- Verifier comportement en deconnexion/reconnexion

### 12.2 Verification API locale
```bash
curl -i http://127.0.0.1:3001/health
```
Doit repondre `200` et `{\"ok\":true}`.

### 12.3 Verification publique
```bash
curl -I https://duel.example.com
```
Doit repondre `200`.

## 13. Monitoring et logs

### PM2
```bash
pm2 status
pm2 logs math-duel-api
pm2 monit
```

### Nginx
```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## 14. Sauvegarde minimale

A sauvegarder regulierement:
- code source (`/opt/math-duel`)
- fichier PM2 (`ecosystem.config.cjs`)
- config Nginx (`/etc/nginx/sites-available/math-duel`)

## 15. Depannage rapide

### Le site s'affiche mais impossible de jouer
- verifier `VITE_SERVER_URL` utilise au build
- verifier la conf Nginx de `\/socket.io\/`
- verifier que PM2 tourne

### Erreur CORS
- verifier `CLIENT_ORIGIN` cote backend
- verifier protocole exact (`https://`) et domaine exact

### Le backend ne demarre pas
```bash
pm2 logs math-duel-api --lines 200
node -v
ls -la /opt/math-duel/server/dist
```

### 502 Bad Gateway
- backend down ou mauvais `proxy_pass`
- tester `curl http://127.0.0.1:3001/health`

## 16. Variante avec sous-domaine API (optionnel)

Si tu preferes:
- Front: `https://duel.example.com`
- API: `https://api.duel.example.com`

Alors:
- build frontend avec `VITE_SERVER_URL=https://api.duel.example.com`
- backend avec `CLIENT_ORIGIN=https://duel.example.com`
- ajouter une seconde conf Nginx pour `api.duel.example.com` qui proxy tout vers `127.0.0.1:3001`

## 17. Checklist finale

- [ ] DNS pointe vers le serveur
- [ ] `npm ci` OK
- [ ] build prod OK
- [ ] PM2 actif et persistant
- [ ] Nginx actif (`nginx -t` OK)
- [ ] HTTPS actif
- [ ] create/join/duel/reconnexion verifies

---

Document genere pour le projet `math-duel`.
