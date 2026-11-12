# Cendr V1.1 — Rapport final

Branche de travail : `preview/audit-securite-perf-visuel`. Chaque envoi donne un aperçu Vercel. **La production n'a
pas changé** : partie J.

Hors périmètre, comme demandé (V1.2) :

- crédits et facturation ;
- Stripe ;
- tarifs ;
- marges.

Les connexions OpenAI et Anthropic existantes sont intactes.

---

## A. État initial

**Architecture trouvée** : un monolithe modulaire en Next.js 16 (App Router, TypeScript, Tailwind). La base est
Supabase, en Europe : Postgres avec des règles d'accès sur chaque table, fichiers, temps réel, pgvector. Le site
est hébergé chez Vercel, région Francfort. Les fournisseurs d'IA (OpenAI, Anthropic, Google) passent par notre propre
interface.

**Modules existants et opérationnels** :

- chat multi-modèles avec mode Auto, Confronter, recherche web et images ;
- Conscience : mémoire de l'entreprise, des clients et personnelle, avec Source Proof ;
- Hide ;
- collaboration (conversations à plusieurs, transfert, passation) ;
- applis et agents par département ;
- consoles de l'entreprise et de notre équipe ;
- Studio ;
- dictée vocale ;
- versions, aperçu, Debug.

Ils étaient testés : environ 320 tests unitaires et 240 tests d'intégration au début de la V1.1.

**Ce qui manquait** :

- connexion en deux étapes ;
- dossier de conformité ;
- mémoire d'équipe et de projet ;
- import des connaissances depuis les autres IA ;
- intégrations ;
- workflows ;
- dictée rapide ;
- supervision, alertes, préparation de la production.

**Problèmes trouvés en route (tous corrigés)** :

1. **Bloquant.** Le filtre d'entrée du site refusait l'horloge des workflows et les webhooks venus de l'extérieur.
   En production, aucun workflow planifié ni déclenché par webhook n'aurait tourné.
2. Une règle d'accès de la base cachait une ligne tout juste créée (projets, workflows). Elle a été réécrite.
3. L'avertissement de partage d'historique confondait mémoires d'équipe et de projet avec la mémoire d'entreprise.
4. Vider la zone de message pouvait faire revenir un ancien brouillon.
5. Un index manquait sur les sources (Source Proof) d'une conversation.
6. Les mises à jour en temps réel rechargeaient toute la conversation à chaque nouveau message.
7. Depuis la double authentification (lot 1), un membre de notre équipe qui possède aussi une entreprise arrivait sur
   son entreprise au lieu de notre console. Vous aviez demandé l'inverse le 9 novembre.
8. La version mise au propre d'une dictée pouvait remplacer le texte alors que la personne avait déjà tapé après.

Limite connue, non corrigée : les listes de notre console (entreprises, usage) s'arrêtent à 1 000 entreprises, à
cause de la limite de l'accès à la base. Il faudra les découper en pages avant d'atteindre ce nombre.

## B. Travaux réalisés

| Lot | Contenu | Fichiers principaux |
|---|---|---|
| 1 | Connexion en deux étapes (application d'authentification), obligatoire pour notre équipe et imposée par la base ; dossier de conformité | `supabase/migrations/20261113000001_mfa.sql`, `docs/COMPLIANCE.md` |
| 2 | Mémoire d'équipe et de projet, mesurée avec et sans | `…20261114*`, `src/modules/memory`, `docs/CONSCIOUSNESS.md` |
| 3 | Import des connaissances depuis ChatGPT, Claude, Gemini et Perplexity, avec filtre de confidentialité | `src/modules/knowledge-import`, `…20261115000001` |
| 4 | Couche d'intégrations (Google, Microsoft, Slack, Notion, Canva) | `src/modules/integrations`, `docs/INTEGRATIONS.md` |
| 5–6 | Workflows : moteur, éditeur à nœuds, copilote IA, Play/Pause, mode test, modèles | `src/modules/workflows`, `docs/WORKFLOWS.md` |
| 7 | Dictée plus rapide, mesurée | `src/modules/dictation`, `docs/DICTATION.md` |
| 8 | Performance, supervision, préparation du déploiement | `docs/OBSERVABILITY.md`, `docs/DEPLOY.md` partie 6, `.github/workflows/ci.yml`, `uptime.yml` |

**Décisions techniques principales** :

- Tout ce qui touche aux droits est vérifié dans la base (règles d'accès) **et** sur le serveur.
- Les jetons des applications connectées sont chiffrés (AES-256-GCM) dans une table que personne ne peut lire.
- Un workflow tourne avec les droits de son auteur, revérifiés à chaque exécution.
- Une action qui écrit à l'extérieur n'est jamais rejouée deux fois.
- Les archives importées sont lues dans le navigateur et jamais conservées.
- La dictée découpe aux pauses et transcrit les morceaux en parallèle.
- Les journaux ne contiennent jamais de contenu.

**Réutilisation de l'existant** :

- Hide masque aussi les étapes IA des workflows et l'import.
- Les crédits et quotas existants s'appliquent aux workflows et à la dictée.
- Le journal d'activité et le système de design sont communs à tout le produit.
- Les fournisseurs d'IA passent par la même interface.
- La page Santé de notre console a été enrichie, pas refaite.

## C. Sécurité

**Vulnérabilités ou défauts détectés pendant la V1.1** :

- le filtre d'entrée qui bloquait l'horloge et les webhooks ;
- des règles d'accès qui relisaient leur propre table ;
- une mauvaise étiquette dans l'avertissement d'historique ;
- deux dépendances signalées « modérées » :
  - `fflate` : version corrigée appliquée ;
  - `uuid`, utilisé par la bibliothèque Excel : les fonctions touchées ne sont pas appelées.

Aucune faille élevée ni critique connue dans les dépendances de production.

**Corrections** : toutes celles ci-dessus.

**Tests de sécurité** :

- isolation entre entreprises et entre clients ;
- intersection des droits dans les conversations à plusieurs ;
- absence d'accès au contenu pour notre équipe (y compris dans les nouveaux indicateurs) ;
- rejeu et vol de l'« état » OAuth refusés ;
- révocation effective d'une connexion ;
- secrets des webhooks ;
- workflows d'un collègue invisibles ;
- rien de privé envoyé au modèle pendant l'import ;
- double authentification imposée.

**Contrôles automatiques à chaque envoi** (`ci.yml`) :

- types ;
- lint ;
- tests unitaires ;
- audit des dépendances.

**Risques résiduels** :

- pas de test d'intrusion externe ;
- pas de service de suivi d'erreurs ;
- pas de détection de secrets dans le code (offre payante ou outil à choisir) ;
- la voix dictée part chez OpenAI sans masquage (documenté) ;
- les fournisseurs d'IA ne traitent pas forcément les données en Europe ;
- le filtre de confidentialité de l'import repose sur des listes de mots et ne peut pas tout attraper (dit à
  l'écran).

## D. Consciousness

**Vérifié, pas reconstruit** :

- mémoires d'entreprise, de client et personnelle ;
- Source Proof ;
- filtrage des droits **avant** que quoi que ce soit n'atteigne un modèle ;
- intersection des droits à plusieurs.

**Ajouté** : la mémoire d'équipe et la mémoire de projet.

**Résultats mesurés** (index simulé, `docs/CONSCIOUSNESS.md` §8c) :

- 17 faits sur 17 ont atteint le modèle, sur 4 niveaux de mémoire ;
- **0 fuite** sur 24 questions, dont 7 tentatives de contournement ;
- environ 90 « tokens » ajoutés en moyenne ;
- 130 ms au 95e centile ;
- les faits remplacés ou supprimés sont bien pris en compte.

13 tests dédiés couvrent les équipes et les projets.

**Problèmes restants** :

- l'apprentissage automatique ne nourrit encore que la mémoire client ;
- la comparaison avec un vrai modèle n'a pas pu être faite : la clé OpenAI de cet environnement n'a plus de
  crédit.

## E. Migration (import des connaissances)

**Sources reconnues** :

- ChatGPT : `conversations*.json`, la branche de conversation affichée en dernier ;
- Claude : `conversations.json` dans ses deux variantes, plus la description et les consignes des projets ;
- Gemini : activité Google Takeout, en JSON ou HTML, regroupée par jour ;
- Perplexity : fils exportés en Markdown ou PDF ;
- fichiers isolés : Markdown, texte, HTML, CSV, PDF, Word.

**Tests** :

- 17 tests unitaires : formats, archives piégées, « bombe zip », filtre ;
- 10 tests d'intégration :
  - rien de privé n'atteint le modèle ;
  - noms de clients masqués ;
  - chacun ne voit que ses imports ;
  - droits d'enregistrement ;
  - doublons ;
  - reprise ;
  - suppression ;
- 4 tests navigateur.

**Confidentialité** :

- l'archive ne quitte pas le navigateur ;
- seuls les mots de la personne partent, par lots de 5 ;
- les sujets privés et les secrets sont écartés sans IA ;
- les identifiants sont masqués ;
- chaque proposition est revérifiée ;
- la personne coche, modifie et range chaque élément ;
- les éléments personnels sont cochés par défaut, les partagés et les douteux ne le sont pas ;
- les propositions en attente sont supprimées au bout de 30 jours.

**Limites** :

- les formats d'export ne sont pas documentés par les fournisseurs (construits sur des exports observés) ;
- les imports pour toute une organisation ne sont pas faits ;
- la vidéo d'aide n'existe pas encore : son emplacement est prêt.

## F. Workflows

**Éditeur** :

- bibliothèque par famille ;
- glisser-déposer, liens, zoom, ajustement, sélection multiple, rangement automatique ;
- dupliquer, supprimer, annuler et rétablir ;
- problèmes affichés sur les étapes ;
- réglages avec variables ;
- enregistrement automatique sans écraser.

**Copilote** :

- il modifie réellement le graphe : ajouter, changer, supprimer, relier ;
- chaque modification est vérifiée par notre serveur, puis appliquée avec possibilité d'annuler ;
- il demande confirmation pour toute action qui écrit à l'extérieur.

**Déclencheurs** : manuel, planifié, nouvel e-mail (Gmail ou Outlook), webhook authentifié.

**Actions** :

- IA : générer, résumer, classer, extraire, décider ;
- Conscience ;
- e-mails ;
- Slack, Teams, Notion, agenda, Canva ;
- logique : condition, filtre, boucle, attente, sous-workflow.

Au total, 37 types d'étapes (dont 6 « Bientôt ») et 10 modèles.

**Play / Pause** :

- Play vérifie tout, puis avertit une fois de ce que le workflow pourra faire à l'extérieur ;
- une version figée est créée à chaque Play ;
- Pause arrête les nouvelles exécutions et annule celles en attente.

**Mode test** : les étapes IA et les lectures sont réelles ; les actions sont **montrées, jamais envoyées**.

**Tests** : 13 unitaires, 12 d'intégration, 4 navigateur. S'y ajoute la vérification que l'horloge et les webhooks
passent bien le filtre d'entrée (lot 8).

**Il faut** : l'horloge toutes les 5 minutes, avec `CRON_SECRET` dans Vercel et GitHub, et `APP_URL` dans GitHub.

## G. Intégrations

Pour toutes : OAuth 2.0 côté serveur, avec un « état » à usage unique lié à la personne. PKCE pour Google,
Microsoft et Canva. Jetons chiffrés, renouvellement automatique, « Vérifier », « Reconnecter », « Révoquer »
(demande d'annulation chez le service quand il le permet). Connexions personnelles ou d'entreprise, interrupteur par
service pour l'entreprise. Écritures journalisées sans contenu.

| Application | Capacités | Résultat des tests | Limite externe |
|---|---|---|---|
| Google Workspace | Gmail : chercher, brouillon, envoyer ; Agenda : lire, créer ; Drive, Docs, Sheets : chercher, lire | Parcours OAuth complet testé avec Google simulé ; forme de chaque requête testée | Application Google à enregistrer et à faire vérifier (scopes sensibles) |
| Microsoft 365 | Outlook : chercher, brouillon, envoyer ; agenda : lire, créer ; OneDrive et SharePoint : chercher, lire ; Teams : canaux, publier | Forme des requêtes testée | Application Entra à enregistrer ; consentement de l'administrateur du client pour certains droits |
| Slack | Canaux, lire, publier | Forme des requêtes testée | Application Slack à créer |
| Notion | Chercher, lire, créer une page | Forme des requêtes testée | Intégration publique Notion à créer |
| Canva | Designs, créer, exporter | Forme des requêtes testée | Application Canva à enregistrer et à faire valider |
| HubSpot (CRM) | « Bientôt » | — | — |

**Bloqué tant que** :

- aucun service n'est enregistré ;
- `INTEGRATIONS_ENCRYPTION_KEY` n'est pas défini.

Le catalogue le dit à l'écran et rien ne se connecte. Aucune intégration n'a été testée avec un vrai compte.

## H. Performance

**Mesures avant / après** :

- en vrai navigateur, sur cette machine ;
- conversation, console et pages : médianes de 3 chargements ;
- dictée : 8 enregistrements par scénario.

| Cas | Avant | Après |
|---|---|---|
| Conversation de 600 messages, utilisable | 2,97 s | **0,65 s** |
| Même conversation, blocage de la page | 1,69 s | 0,06 s |
| Liste des 895 entreprises (notre console) | 2,49 s | **0,47 s** |
| Interrupteur « Inscription libre » | 8,0 s | **0,9 s** |
| Dictée : arrêt → texte dans la zone (modèle simulé à 800 ms) | 1,70 s | **0,85 s** |
| Dictée : premiers mots, personne qui marque une pause tôt | 5,32 s | **2,72 s** |
| Dictée : contrôles serveur par morceau | 29–31 ms | 19–20 ms |

**Optimisations** :

- longues conversations ouvertes sur les 40 derniers messages ;
- liste de la console par 50, avec une recherche sur toutes les entreprises ;
- temps réel limité aux nouveaux messages ;
- index ajouté ;
- dictée en parallèle, mise au propre en arrière-plan.

Déjà rapides, inchangés :

- accueil du chat : 0,2 s ;
- Conscience : 0,2 s ;
- workflow de 50 étapes : 0,3 s.

**Points de friction restants** :

- le poids du code JavaScript de la page de chat (environ 1,6 Mo décompressé) n'a pas été réduit ;
- la vitesse réelle de la dictée avec le vrai modèle n'a pas été mesurée (clé sans crédit) ;
- aucune mesure chez de vrais visiteurs.

## I. Conformité

**Rien n'est certifié ni déclaré conforme** : c'est une préparation.

- **ISO 27001:2022 et SOC 2 Type II** :
  - inventaire des actifs et des sous-traitants ;
  - flux de données ;
  - registre des risques ;
  - matrice des contrôles ;
  - correspondance avec l'annexe A et les critères SOC 2 ;
  - procédure d'incident (brouillon) ;
  - preuves techniques : migrations, tests, journaux, versions, intégration continue.

  Voir `docs/COMPLIANCE.md`.
- **RGPD (vue technique)** :
  - minimisation : Hide, rien gardé de la voix ni des archives ;
  - privé par défaut ;
  - droits d'accès dans la base ;
  - suppression des entrées de mémoire ;
  - flux vers les fournisseurs documentés dans `docs/SECURITY.md`.

**Preuves produites** :

- tests automatisés : 396 unitaires, 302 d'intégration, 178 navigateur (partie K) ;
- dossier de conformité ;
- journaux sans contenu ;
- surveillance de disponibilité ;
- audit des dépendances à chaque envoi.

**Manque** :

- sauvegardes, avec un test de restauration enregistré ;
- durées de conservation décidées, puis les purges correspondantes ;
- export et suppression du compte d'une personne ;
- suivi des erreurs ;
- détection de secrets dans le code.

**Démarches organisationnelles (vous, avec un juriste)** :

- contrats de sous-traitance (DPA) avec chaque fournisseur, et un modèle pour vos clients ;
- registre des traitements ;
- analyse d'impact (IA et données de salariés) ;
- transferts hors UE ;
- politiques écrites ;
- double authentification sur tous vos comptes (GitHub, Vercel, Supabase, fournisseurs) ;
- test d'intrusion avant la commercialisation ;
- pour l'agent de tri des candidatures (« haut risque » selon l'AI Act) : il reste caché.

## J. Déploiement

**État réel** :

- la V1.1 n'est **pas** en production ;
- elle tourne en **aperçu Vercel** à chaque envoi sur la branche de travail ;
- l'aperçu utilise la base de production **sans** les migrations V1.1 : les nouveautés qui en ont besoin
  affichent « Bientôt disponible » ;
- dernier aperçu vérifié : le lot 7, réussi chez Vercel.

**Environnement** : Vercel, région Francfort ; Supabase, région Francfort.

**Tests de production** : aucun, puisque rien n'est en production. La vérification automatique avec le gérant et
l'employée de démonstration se lancera après « Lancer ».

**Surveillance prête** :

- `/api/health` ;
- alerte GitHub toutes les 10 minutes ;
- panneau « Opérations » dans notre console ;
- journaux structurés.

**Retour arrière** :

- le site : « Instant Rollback » de Vercel ;
- la base : les migrations n'ont fait qu'ajouter (vérifié par un test), donc l'ancien site fonctionne avec la
  nouvelle base ;
- sauvegarde **avant** le lancement.

**Bloquant pour la mise en production** :

1. **Sauvegardes** : offre Pro de Supabase (payante, votre décision).
2. Réglages :
   - `CRON_SECRET` dans Vercel et GitHub ;
   - `APP_URL` dans GitHub ;
   - `INTEGRATIONS_ENCRYPTION_KEY` dans Vercel.
3. Fusion de la branche, puis « Lancer » depuis notre console.
4. Pour les intégrations : enregistrer les applications chez Google, Microsoft, Slack, Notion et Canva.
5. Une clé OpenAI avec du crédit, pour mesurer la dictée et la Conscience avec les vrais modèles.

Le guide pas à pas est dans `docs/DEPLOY.md`, partie 6.

## K. Bilan final

| Objectif | Classement |
|---|---|
| Sécurité, isolation, permissions (existant préservé, défauts V1.1 corrigés) | Terminé et testé |
| Connexion en deux étapes | Terminé et testé |
| Conformité ISO 27001 / SOC 2 / RGPD | Partiellement terminé (préparation technique faite ; démarches juridiques et organisationnelles à mener) |
| Consciousness : audit, mémoires d'équipe et de projet | Terminé et testé (index simulé) ; validation avec un vrai modèle nécessaire |
| Import des connaissances (onboarding et paramètres) | Terminé et testé ; à valider sur de vrais exports récents |
| Intégrations Google, Microsoft, Slack, Notion, Canva | Terminé mais validation supplémentaire nécessaire (aucun service enregistré : bloqué en production tant que ce n'est pas fait) |
| CRM (HubSpot) | Non commencé (« Bientôt ») |
| Moteur de workflows, éditeur, copilote, Play/Pause, mode test, modèles | Terminé et testé (avec IA simulée) |
| Workflows planifiés et e-mails en production | Bloqué (horloge : `CRON_SECRET` et `APP_URL` à renseigner) |
| Dictée rapide | Terminé et testé (modèle simulé) ; vitesse et précision réelles à mesurer |
| UX (parcours, mobile, états d'erreur) | Terminé et testé sur les parcours touchés |
| Performance | Terminé et testé (mesures avant/après) ; poids JavaScript non réduit |
| Supervision et fiabilité | Terminé et testé ; suivi d'erreurs externe non commencé (service payant) |
| Préparation du déploiement Vercel | Terminé (guide, réglages, sécurité des migrations, retour arrière) |
| Déploiement en production | Bloqué (sauvegardes et réglages : décision et accès du fondateur) |

**Campagne de tests** :

- 396 tests unitaires ;
- 302 tests d'intégration ;
- 178 tests navigateur : la campagne complète, puis la relance des fichiers corrigés, dont le scénario de lancement
  en 15 étapes avec le moteur vidéo local ;
- 8 tests navigateur volontairement ignorés : les mesures lancées à la demande et ceux qui demandent une vraie IA.
