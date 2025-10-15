# Enchères — Montres (Playwright + Cheerio)

Génère `public/montres.html` à partir de **toutes les ventes** d'`encheres-domaine.gouv.fr`, filtrées sur les mots-clés `montre|montres|horlogerie`.  
Déployé sur **Netlify** chaque jour à **10:00 Europe/Paris**, avec **email** de notification.

## Prérequis

- Un site Netlify (statiquement servi depuis `public/`)
- Secrets & variables GitHub configurés :

### Secrets (Settings → Secrets and variables → Actions → New repository secret)
- `MAIL_USERNAME` → ex: `rafael.bchr@gmail.com`
- `MAIL_APP_PASSWORD` → mot de passe d'application Gmail (pas le mot de passe principal)
- `NETLIFY_AUTH_TOKEN` → Netlify → User settings → Applications → Personal access tokens
- `NETLIFY_SITE_ID` → Netlify → Site settings → Site details → Site information → **Site ID**

### Variables (Settings → Secrets and variables → Actions → **Variables**)
- `SITE_URL` → ex: `https://ton-site.netlify.app`

## Développement local

```bash
npm install
npm run scrape
# ouvre public/montres.html dans le navigateur
