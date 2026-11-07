# Apps: audit and recommendations (2026-11-07)

The founder's refinement brief asked for a product-level look at the Apps. **Nothing was deleted or
hidden in this step**: the apps, their data and their links are unchanged. What changed is how they
are reached from the chat ("/" shortcuts, "@Albert") and this list of recommendations, for the
founder to decide.

## Principle

Chat is the main interface; an app is a structured shortcut to the same engine (same conversation,
history, memory, permissions, Hide, artifacts and exports). An app earns its place when its form
gathers what a good answer needs (a client, files, criteria) or when its instructions encode a
method people would not write themselves. Anything a one-line request in the chat does as well
should stay a chat capability, reached with "/".

## The 16 apps

| App | Department | Problem it solves | Class | Recommendation |
|---|---|---|---|---|
| Préparation de rendez-vous (Meeting Prep) | Direction / Ventes | Brief from client memory, history, points and questions | **Core** | Keep prominent; reached with **@Albert** in the chat |
| Compte rendu de réunion (Meeting Minutes) | Direction | Notes, transcript or audio → minutes, decisions, actions | **Core** | Keep prominent; reached with **@Albert** |
| Proposition commerciale (Proposal Writer) | Ventes | Client + needs → commercial proposal | **Core** | Keep; its output now opens in the workspace (artifact) |
| Saisie de factures (Invoice Intake) | Comptabilité | Invoices (PDF, images) → table, CSV / Excel | **Core** | Keep: the file form and the extraction method are the value |
| Réponse aux e-mails (Email Responder) | Service client | Incoming email → reply in the company's tone | **Core** | Keep; overlaps the chat's ready-to-send email cards, but the tone and memory instructions add value |
| Relecture de contrat (Contract Review) | Juridique | Clauses, risks, missing clauses, questions for a lawyer | **Core** | Keep (with its "not legal advice" notice) |
| Relances de paiement (Payment Reminders) | Comptabilité | Unpaid invoices → reminder drafts, escalating tone | Specialized | Keep in Comptabilité |
| Prévision de trésorerie (Cash-Flow Forecast) | Finance | Bank exports → 3–12 month forecast and chart | Specialized | Keep in Finance |
| Analyse de marge (Margin Analysis) | Finance | Sales and costs → margins with commentary | Specialized | Keep in Finance; could merge with the forecast into one "Finance" entry later |
| Offre d'emploi (Job Posting Writer) | RH | Role → job posting | Specialized | Keep in RH |
| Modèles juridiques (Template Drafter) | Juridique | CGV, NDA and standard documents | **Redundant workflow** | Candidate to merge into "/document" (the chat now writes documents in the workspace); keep until usage says otherwise |
| Synthèse des retours (Feedback Synthesis) | Service client | Reviews or emails → themes, sentiment, actions | Specialized | Keep |
| Tableau de bord hebdo (Weekly Dashboard) | Direction | Data files + memory → one-page weekly summary | Specialized | Keep |
| Motion design | Marketing | Brief → animated MP4 (HyperFrames) | **Experimental** | "Bientôt" until the render worker is hosted (founder decision) |
| Montage vidéo (Video Editor) | Marketing | Clips → edited MP4 | **Experimental** | Same as Motion Design |
| Aide à la lecture de candidatures (Application Review) | RH | Applications vs employer's criteria → summaries | **Experimental** | Hidden until a lawyer has reviewed it (founder decision; EU AI Act high-risk) |

## Named assistants

Only one, **Albert** (meetings: preparation and minutes), because these two apps form a coherent
job people ask for in conversation ("prépare mon rendez-vous", "fais le compte rendu"). Other areas
keep plain names (Finance, Juridique, Rédaction…) in the directory; adding a character for each would
add names to learn without adding capability. A second assistant should come only from observed use.

## Shortcuts in the chat

- "/" lists **Créer ici** (document, présentation, tableau, image) before the apps. The first three
  put a starting sentence in the input; the answer opens in the workspace on the right.
- "@Albert" answers one message with the meeting apps' instructions.

## To decide (founder)

1. Merge Template Drafter into "/document"? (Recommended once usage data exists.)
2. A single "Finance" entry grouping forecast and margin analysis?
3. Show "Core" apps first in "Découvrir" for new companies (today: most used first)?
