# Mettre en ligne la version test

Ce guide met l'application en ligne, en Europe, pour que vous puissiez la tester vous-même dans votre navigateur.
Comptez environ 45 minutes, en trois parties : **Supabase** (la base de données), **Vercel** (le site), puis **la première connexion**.

> **Règle de sécurité.** Les clés et mots de passe se collent **uniquement** dans les réglages de Supabase, de Vercel ou de GitHub, jamais dans la conversation avec Claude.
> Gardez-les dans un gestionnaire de mots de passe.

---

## Ce qu'il faut créer

| Service | À quoi il sert | Coût pour la version test |
|---|---|---|
| **Supabase** | Base de données, comptes, fichiers, temps réel. Région **Frankfurt (UE)** | Gratuit (offre Free : le projet se met en pause après 7 jours sans visite ; fichiers de 50 Mo maximum) |
| **Vercel** | Héberge le site, région **Frankfurt** (`fra1`) | Gratuit (offre Hobby, réservée à un usage non commercial : suffisant pour tester ; l'offre Pro sera nécessaire avant de vendre) |
| **Clés d'IA** | ChatGPT, Claude, Gemini | Facturé à l'usage par chaque fournisseur. Au moins **une** clé suffit pour tester |
| **Resend** *(facultatif)* | Envoyer les e-mails (liens de connexion, invitations) à n'importe qui | Gratuit jusqu'à 3 000 e-mails par mois ; il faut un nom de domaine à vous |
| **Moteur vidéo** *(plus tard)* | Fabriquer les MP4 (Motion Design, montage) | Pas encore hébergé : voir la fin du guide |

Les prix ci-dessus viennent des pages publiques des services. Vérifiez-les sur leurs sites avant de passer à une offre payante.

---

## Partie 1 — Supabase (la base de données)

1. Créez un compte sur **supabase.com**, puis cliquez **New project**.
2. Remplissez :
   - **Name** : par exemple `workspace-test` ;
   - **Database password** : cliquez **Generate a password**, puis **copiez-le dans votre gestionnaire de mots de passe** ;
   - **Region** : **Central EU (Frankfurt)**.
3. Cliquez **Create new project** et attendez 2 minutes.
4. Notez ces informations (dans votre gestionnaire de mots de passe) :
   - **Project ref** : *Project Settings → General → Project ID* (une suite de 20 lettres) ;
   - **Project URL** : *Project Settings → Data API* (`https://<project ref>.supabase.co`). **Attention** : ce n'est pas l'adresse de la page Supabase dans votre navigateur (`supabase.com/dashboard/project/…`), qui ne marche pas ;
   - **Publishable key** : *Project Settings → API Keys* (commence par `sb_publishable_`) ;
   - **Secret key** : même page, section *Secret keys* (commence par `sb_secret_`). Si aucune n'existe, cliquez **Add new secret key** ;
   - **Access token** : cliquez votre avatar en haut à droite → **Account preferences → Access Tokens → Generate new token**.

### Brancher Supabase sur GitHub

La base est installée automatiquement depuis GitHub (cet environnement de travail ne peut pas joindre Supabase directement).

1. Sur **github.com/nayfii/projet1** : **Settings → Secrets and variables → Actions → New repository secret**.
2. Créez ces trois secrets (le nom exactement comme écrit, la valeur que vous avez notée) :

| Nom | Valeur |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | l'access token |
| `SUPABASE_PROJECT_REF` | le project ref |
| `SUPABASE_DB_PASSWORD` | le mot de passe de la base |

3. Écrivez à Claude « secrets Supabase ajoutés » : il lance l'installation de la base et vérifie qu'elle a réussi.

---

## Partie 2 — Vercel (le site)

### Préparer la clé de protection des données (Hide)

Sur votre Mac, ouvrez l'application **Terminal**, collez cette ligne et appuyez sur Entrée :

```
openssl rand -base64 32
```

Copiez le résultat dans votre gestionnaire de mots de passe : c'est votre `HIDE_ENCRYPTION_KEY`.
**Ne la perdez pas et ne la changez pas** : sans elle, les données masquées des anciennes conversations ne peuvent plus être affichées.

### Créer le site

1. Créez un compte sur **vercel.com** avec **Continue with GitHub**, et autorisez Vercel à voir le dépôt `nayfii/projet1`.
2. **Add New… → Project**, choisissez `projet1`, cliquez **Import**.
3. **Project Name** : par exemple `workspace-test` (l'adresse du site en dépendra : `https://workspace-test.vercel.app` si elle est libre).
4. Ouvrez **Environment Variables** et ajoutez :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | la Project URL, de la forme `https://<project ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | la publishable key |
| `SUPABASE_SECRET_KEY` | la secret key |
| `HIDE_ENCRYPTION_KEY` | la clé générée dans le Terminal |
| `PLATFORM_ADMIN_EMAILS` | votre adresse e-mail (vous aurez la console « Plateforme »). Une seule fois : ensuite, ajoutez les membres de notre équipe depuis **Plateforme → Équipe** |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `fr` |
| `OPENAI_API_KEY` | votre clé OpenAI *(si vous en avez une avec du crédit)* |
| `ANTHROPIC_API_KEY` | votre clé Anthropic *(si vous en avez une)* |
| `GOOGLE_GENERATIVE_AI_API_KEY` | votre clé Gemini *(d'un projet Google avec facturation activée)* |
| `EMBEDDINGS_PROVIDER` | `openai`, ou `google` si vous n'avez qu'une clé Gemini |

   Sans aucune clé d'IA, ajoutez `AI_FAKE_PROVIDER` = `true` : l'IA est alors simulée (réponses marquées « [TEST] »), utile seulement pour cliquer partout.

5. Cliquez **Deploy**. Ce premier déploiement part de la branche `main`, presque vide : **il peut échouer, c'est normal**.
6. Dites à Vercel d'utiliser la branche du projet : **Settings → Environments → Production → Branch Tracking**, remplacez `main` par `claude/amazing-davinci-5th459`, enregistrez.
7. Notez l'adresse du site (**Settings → Domains**, par exemple `https://workspace-test.vercel.app`), puis ajoutez la variable :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_APP_URL` | l'adresse du site, sans `/` à la fin |

8. **Deployments → les trois points du dernier déploiement → Redeploy**. Attendez la coche verte (3 à 5 minutes).

### Relier les e-mails de connexion au site

1. Sur GitHub, ajoutez un dernier secret : `APP_URL` = l'adresse du site.
2. *(Facultatif, pour envoyer des e-mails à d'autres personnes que vous)* créez un compte **Resend**, vérifiez votre nom de domaine, créez une clé API, puis ajoutez les secrets GitHub :
   `SMTP_HOST` = `smtp.resend.com`, `SMTP_PORT` = `587`, `SMTP_USER` = `resend`, `SMTP_PASSWORD` = la clé Resend,
   `SMTP_SENDER_EMAIL` = par exemple `no-reply@votre-domaine.fr`, `SMTP_SENDER_NAME` = le nom affiché.
3. Écrivez à Claude « APP_URL ajouté » : il applique les réglages de connexion (adresse du site, modèles d'e-mails, serveur d'e-mails).

Sans Resend, Supabase envoie lui-même **2 e-mails par heure au maximum, et seulement aux membres de votre équipe Supabase** : cela suffit pour vous connecter vous-même. Ses e-mails sont alors les siens, en anglais : « Confirm your signup » pour une première connexion (l'adresse doit être confirmée), puis « Your Magic Link ». Le lien doit être ouvert **dans le navigateur où vous l'avez demandé**. Pour un collègue, le lien d'invitation s'affiche aussi à l'écran : vous pouvez le copier et le lui envoyer.

---

## Partie 3 — Première connexion

1. Ouvrez l'adresse du site, entrez **votre** e-mail (celui de `PLATFORM_ADMIN_EMAILS`), cliquez le lien reçu.
2. Allez sur **/platform/plans** (ajoutez `/platform/plans` à la fin de l'adresse) et créez une offre :
   nom, places, crédits par mois, crédits vidéo, prix par place, et **activez « Offre attribuée aux nouvelles inscriptions »**.
3. Revenez à l'adresse du site : l'assistant de démarrage vous fait créer votre entreprise.
4. Testez : conversation, mémoire, Hide, agents, administration (**/admin**), et la console de notre équipe (**/platform**).
5. Pour donner la console à un collègue de notre équipe : **/platform/team** → son adresse → **Donner l'accès**. Il l'aura à sa première connexion avec cette adresse (rien à changer sur Vercel).

Notez ce qui va et ce qui ne va pas, avec la page et ce que vous avez cliqué : Claude corrigera.

---

### Connexion par mot de passe

Rien à faire de plus : les règles (10 caractères minimum, lettres et chiffres) partent en ligne avec la prochaine mise à
jour de la base. **Vérifiez seulement que « Confirm email » reste activé** dans Supabase (*Authentication → Sign In / Providers →
Email*) : c'est ce qui empêche quelqu'un de se connecter avec une adresse qui n'est pas la sienne.

## Partie 4 — Brancher les vraies IA (ChatGPT, Claude, Gemini)

Chaque fournisseur facture à l'usage : il faut **un compte, du crédit et une clé** chez chacun. Les clés se collent
**uniquement dans Vercel**, jamais dans la conversation.

1. **ChatGPT (OpenAI)** — sur **platform.openai.com** : *Settings → Billing → Add to credit balance* (10 à 20 $ suffisent
   pour tester). Si vous n'avez pas encore de clé dans Vercel : *API keys → Create new secret key*.
   Cette clé sert aussi à la recherche dans les documents, à la dictée et aux avatars.
2. **Claude (Anthropic)** — sur **console.anthropic.com** : *Settings → Billing → Buy credits* (5 $ minimum), puis
   *API keys → Create Key*. Pour que Claude puisse **chercher sur internet**, activez la recherche web dans les
   réglages de l'organisation de la console (*Settings → Privacy*, option « Web search »). ChatGPT et Gemini n'ont
   rien à activer.
3. **Gemini (Google)** — sur **aistudio.google.com** : *Get API key → Create API key*, puis **activez la facturation**
   (*Set up billing*, une carte bancaire). Sans facturation, Google peut utiliser les données pour améliorer ses produits.
4. **Vercel** — projet → *Settings → Environment Variables* (environnement *Production*) :

   | Nom | Valeur |
   |---|---|
   | `OPENAI_API_KEY` | la clé OpenAI |
   | `ANTHROPIC_API_KEY` | la clé Anthropic |
   | `GOOGLE_GENERATIVE_AI_API_KEY` | la clé Gemini |
   | `EMBEDDINGS_PROVIDER` | `openai` |

   **Supprimez `AI_FAKE_PROVIDER`** s'il existe (sinon l'IA reste simulée). Puis *Deployments → ⋯ → Redeploy* : les
   variables ne comptent qu'après un nouveau déploiement.
5. **Vérifier** — connecté avec votre compte de l'équipe, ouvrez **/platform/health** et cliquez **« Tester chaque modèle »** :
   chaque ligne doit être verte. Sinon, la raison est écrite en clair sur la ligne (clé absente, clé refusée, compte
   sans crédit, modèle introuvable).
6. **Dans l'entreprise** — *Administration → Modèles* : cochez les modèles autorisés, choisissez le modèle par défaut ou
   Auto. Les documents ajoutés avant l'arrivée d'une clé OpenAI avec crédit sont retrouvés par leurs mots ; ajoutez-les
   de nouveau pour qu'ils le soient aussi par le sens.

*Facultatif :* pour que Claude puisse lancer lui-même les tests avec les vraies IA, ajoutez les mêmes clés dans les
réglages de l'environnement Claude Code (menu de l'environnement dans la barre de titre de la session → *Edit*), sous les
mêmes noms. Une nouvelle session les prend en compte.

---

## Partie 5 — Versions, aperçu et Debug avec Claude Code (console de notre équipe)

Une fois fait, **rien ne part en ligne sans votre clic** sur « Lancer » (Plateforme → Versions). Comptez 15 minutes.

1. **Un jeton GitHub** — sur github.com : votre photo → *Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token*. Nom : « Console Cendr » ; *Repository access* : **Only select
   repositories** → `nayfii/projet1` ; *Permissions* → *Repository permissions* : **Actions**, **Contents**,
   **Pull requests** et **Workflows** en *Read and write*. Générez, copiez-le.
2. **Collez ce même jeton à deux endroits** :
   - Vercel → *Settings → Environment Variables* : `GITHUB_RELEASE_TOKEN` ;
   - GitHub → dépôt → *Settings → Secrets and variables → Actions → New repository secret* : `RELEASE_TOKEN`.
3. **GitHub → dépôt → *Settings → Actions → General*** : *Workflow permissions* → **Read and write permissions**, et
   cochez **Allow GitHub Actions to create and approve pull requests**. Enregistrez.
4. **Claude Code (partie Debug)** — dans les mêmes secrets GitHub, ajoutez **l'un des deux** :
   - `ANTHROPIC_API_KEY` : une clé de **console.anthropic.com** (facturée à l'usage) ;
   - `CLAUDE_CODE_OAUTH_TOKEN` : avec un abonnement Claude Pro ou Max, tapez `claude setup-token` dans un terminal
     où Claude Code est installé, et collez le jeton affiché.
5. **Vercel → *Settings → Environments → Production → Branch Tracking*** : remplacez la branche par **`production`**,
   enregistrez. Puis *Deployments → ⋯ → Redeploy* (pour que `GITHUB_RELEASE_TOKEN` soit pris en compte).
   Le site reste sur sa version actuelle jusqu'au premier lancement.
6. **Premier lancement** — **/platform/releases** → « **Lancer la v1.1** ». En quelques minutes : la base est mise à
   jour, puis le site, pour toutes les entreprises. Ensuite **/platform/preview** montre la vérification faite avec
   un gérant et une employée de démonstration (entreprise fictive « Démo — vérification »).

Ensuite, à chaque fois :
- **Debug** (**/platform/debug**) : décrivez le problème → « Envoyer à Claude Code » → quelques minutes plus tard,
  « Voir les changements », puis **Accepter** ou **Refuser**.
- **Versions** : la liste « Prochaine version » montre tout ce qui a été accepté ou ajouté depuis ; « Lancer » publie.
- **Aperçu** : « Vérifier maintenant » refait la vérification de la version en ligne.

---

## Ce qui ne marchera pas encore en ligne

- **Les vidéos** (Motion Design, montage) : l'aperçu animé fonctionne, mais le MP4 reste « En attente » tant que le moteur vidéo n'est pas hébergé (il demande un serveur à part, en Europe : décision à prendre, question 14 de `docs/STATUS.md`). La page **Plateforme → État des fournisseurs** l'indique comme « Bloqué » au bout de 3 minutes.
- **Clips vidéo de plus de 50 Mo** : refusés sur l'offre gratuite de Supabase.
- **Connexion Google** : pas encore configurée (le bouton reste caché).
- **Recherche par le sens dans les documents** : il faut une clé OpenAI avec du crédit (ou Gemini avec `EMBEDDINGS_PROVIDER=google`). Sinon les documents sont retrouvés par leurs mots.
- Les fournisseurs d'IA ne traitent **pas** forcément les données en Europe (aucune option de résidence européenne n'est configurée).

## Pour Claude (aide-mémoire technique)

- Base : workflow `.github/workflows/deploy-database.yml` (migrations `supabase db push`, puis `scripts/supabase-production-config.mjs` + `supabase config push` quand `APP_URL` est défini). Il ne fait rien, avec une notice, tant que les secrets manquent. La démo (`supabase/seed.sql`) n'est jamais envoyée.
- Site : Vercel, `vercel.json` (`fra1`), branche de production `claude/amazing-davinci-5th459`. Variables : `.env.example`.
- Image du moteur vidéo : vérifiée par `.github/workflows/worker-image.yml` (construite, non publiée).
