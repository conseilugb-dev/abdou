# Gestion des Membres et des Présences

Application React + TypeScript + Supabase pour Moustarchidine Junior.

## Installation

```bash
npm install
copy .env.example .env
npm run dev
```

Sous macOS/Linux :

```bash
cp .env.example .env
```

Remplir `.env` avec l'URL et la clé publique de ton projet Supabase.

## Base Supabase

1. Ouvre Supabase > SQL Editor.
2. Copie tout le contenu de `supabase/schema.sql`.
3. Exécute le script.
4. Crée au moins un utilisateur dans Authentication > Users.
5. Ajoute son profil dans `profiles` avec le rôle `admin` si nécessaire.

## Déploiement Netlify

Build command:
`npm run build`

Publish directory:
`dist`

Variables Netlify:
`VITE_SUPABASE_URL`
`VITE_SUPABASE_PUBLISHABLE_KEY`

Ne mets jamais une clé `service_role` dans le frontend.


## Récupération d'un mot de passe oublié

La page de connexion comporte le lien **« Mot de passe oublié ? »**. L'utilisateur saisit son adresse e-mail puis reçoit un lien de récupération Supabase. Ce lien ouvre `/reset-password`, où il peut définir et confirmer un nouveau mot de passe.

### Configuration Supabase indispensable

1. Dans Supabase, ouvre **Authentication → URL Configuration**.
2. Configure **Site URL** avec l'adresse principale du site déployé (par exemple l'URL Netlify).
3. Dans **Redirect URLs**, ajoute l'URL exacte du site suivie de `/reset-password` (par exemple `https://ton-site.netlify.app/reset-password`). Pour le développement local, ajoute aussi `http://localhost:5173/reset-password`.
4. Dans **Authentication → Email / SMTP**, vérifie que l'envoi des e-mails fonctionne. Le service e-mail par défaut peut avoir des limites.
5. Crée le fichier `.env` à partir de `.env.example` et renseigne l'URL racine de ton projet Supabase et sa clé publishable/anon. Ne mets jamais une clé `service_role` dans le navigateur.
6. Après le déploiement, ajoute les mêmes variables dans les variables d'environnement de Netlify puis relance un déploiement.

### Lancer le projet

```bash
npm install
npm run dev
```

Vérifie la compilation avant de publier :

```bash
npm run build
```

**Important :** la récupération dépend aussi de la configuration e-mail et des URL autorisées dans Supabase. Le code seul ne peut pas envoyer le lien si ces paramètres ne sont pas configurés.


## Accès public (sans connexion)

- **Sans connexion** : tableau de bord (totaux), activités (voir, créer, modifier), présences (marquer présent/absent/excusé) et statistiques par activité.
- **Avec identifiant + mot de passe** : fiches des membres, exports, utilisateurs, journal d'activité, paramètres, suppression d'activités.

**À faire une seule fois :** dans Supabase > SQL Editor, exécuter `supabase/public_access.sql`
(déjà inclus à la fin de `schema.sql`). La table `members` reste privée : le public ne voit que prénom + nom des membres actifs, via la fonction `public_member_names()`.

⚠️ Tout visiteur disposant du lien peut créer des activités et modifier les présences. Ne diffuse le lien qu'aux personnes de confiance.


## Connexion par identifiant

On se connecte avec un **identifiant** (ex. `admin143`) et un mot de passe. En interne, l'identifiant devient `admin143@mj-membres.app` (domaine modifiable avec `VITE_LOGIN_DOMAIN`).
Création du compte : suivre `supabase/admin_identifiant.sql`. Le mot de passe n'est **jamais** écrit dans le code : il est défini dans Supabase.


## Types d'activités, rapports, absences, import

- Exécuter `supabase/activity_types.sql` (inclus dans `schema.sql`) : crée GOUDI ALJUMAH, KHADARA, SPORT, CELLULE FÉMININ, TOUR MJ, AUTRE.
- **Statistiques** : filtre par type, graphique, tableau par type, export Excel/PDF.
- **Absences Goudi** : membres absents N (3 par défaut) GOUDI ALJUMAH consécutifs, export Excel/PDF.
- **Membres > Importer** : fichier Excel/CSV (modèle téléchargeable), doublons ignorés.
# Gestion-membres-presences-abdou
# gestion-presences-membres-abdou
# gestion-presences-membres-abdou-diop
# gestion-presences-membres-abdou-diop
# gestion-presences-membres-abdou-diop
# gestion-presences-membres-abdou-diop
# gestion-presences-membres-abdou-diop
# gestion-presence-ca-conseil-ugb
# gestion-presence-ca-conseil-ugb
