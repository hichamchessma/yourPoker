# yourPoker — guide de contribution (humain & agent)

Application d'entraînement au poker (Texas Hold'em) : bots IA, coach d'équité/GTO, cash + tournois MTT.
**Stack** : Electron 28 + React 18 + TypeScript 5 + Vite 5, déployée en **PWA sur Vercel**. i18n FR/EN/ES.

---

## ⛔ Règle d'or — TOUJOURS valider avant de livrer

Vite **ne typecheck pas**. Lance ces trois étapes, dans l'ordre, après toute modif de logique :

```bash
npm run check          # typecheck + i18n:lint + les deux bancs  ← le raccourci
npm run build:web      # vite build — vérifie que ça bundle (à lancer à part)
```

`npm run check` enchaîne :
- **`npm run typecheck`** — `tsconfig.web.json` (le renderer) **ET** `tsconfig.tools.json` (les bancs
  dans `tools/` + la fonction serveur `api/`). Vite ne typecheck RIEN.
- **`npm run i18n:lint`** — parité stricte FR/EN/ES. ⚠️ **Ce n'est plus optionnel** : les locales sont
  chargées à la demande et il n'y a plus de fallback croisé (cf. i18n ci-dessous), donc une clé
  manquante dans UNE langue s'affiche brute à l'écran. Le linter EST la garantie.
- **`npm run bench`** — les deux bancs de non-régression.

---

## 🧪 Les bancs de non-régression — le filet de sécurité

Le moteur et le coach ont chacun un banc d'invariants. **Ils doivent rester verts.** Si tu changes une
règle exprès, mets le banc à jour dans le même commit (ne le contourne jamais).

| Banc | Fichier | Couvre | Commande |
|------|---------|--------|----------|
| **Coach** (56) | `tools/coach-bench.ts` | sizings par texture, décisions, ranges préflop, jams, lecture des tailles, exploit, **cohérence bots ⇄ estimateur** | `npm run bench:coach` |
| **Moteur** (57) | `tools/engine-bench.ts` | évaluateur de mains, side-pots, distribution des gains, résolution des mises + **règle de réouverture** | `npm run bench:engine` |

Un banc échoué **sort en code 1** et liste les invariants cassés. Les assertions utilisent des mains
franches (pas d'équités au ras du rasoir) pour ne pas flotter sur le bruit Monte-Carlo.

> Pourquoi un banc plutôt que tester en jouant : avant lui, les bugs (ex. la relance incomplète) étaient
> repérés en partie → 2e tour. Le banc les attrape **avant** de livrer.

---

## 🏗️ Architecture — où vit la logique

- **`src/renderer/src/lib/pokerEngine.ts`** — cœur PUR du moteur live : `bestHandScore` (évaluateur),
  `computeSidePots`, `resolveAction` (mise/relance + règle de réouverture). **Zéro dépendance React/i18n**
  → testable directement. `GamePage` **délègue** à ces fonctions : le banc teste donc le vrai code.
- **`src/renderer/src/pages/GamePage.tsx`** — orchestration du jeu **LIVE uniquement** (état React, file
  d'action, transitions de street, showdown, bots, sandbox « Revive »). La logique pure en a été
  **extraite** ; n'y ré-inline RIEN : ni math de mise (→ `resolveAction`), ni lecture de main
  (→ `madeStrength`), ni rejeu d'historique (→ `handCritique`).
- **`src/renderer/src/lib/handTypes.ts`** — vocabulaire partagé de l'historique (`Card`, `Phase`,
  `HandHistoryRecord`, `SessionEval`, `LeakKind`…). **Types purs** : les stores et les pages importent
  d'ici, jamais de `GamePage`.
- **`src/renderer/src/lib/handCritique.ts`** — rejeu PUR d'une main enregistrée : `computeStepState`,
  `reconstructRanges`, `critiqueHeroMove` (le verdict « 👁 Juge mon coup ») et `evaluateSession`
  (le rapport de perf). Utilise le MÊME `getPostflopAdvice` que le coach live → les deux ne peuvent
  pas se contredire.
- **`src/renderer/src/components/HandHistoryModal.tsx`** — l'UI de replay, partagée par la table live,
  la page Historique et le rapport de simulation.
- **`src/renderer/src/lib/tableGeometry.ts`** — `betOffset`/`POT_POS`, partagés table live ⇄ replay.
- **`src/renderer/src/lib/postflopAdvisor.ts`** — coach postflop (`getPostflopAdvice`), narration
  « Dans la tête d'un pro » (`buildPostflopStory`/`buildPreflopStory`), équité Monte-Carlo. Source de
  `Card`, `handCatLabel`.
- **`src/renderer/src/lib/preflopRanges.ts`** — ranges préflop (RFI/vs-open/squeeze/jams).
- **`src/renderer/src/lib/rangeEstimator.ts`** — Range Vision (estimation de la range adverse, lecture
  des tailles) **ET la lecture de main canonique** : `madeStrength` (avec la démotion « main 100 % board »,
  mémoïsée par board), `hasStrongDraw`, `preflopProbs`, `POS_BONUS`. Les bots live, les bots de
  simulation et les ranges affichées importent TOUS d'ici — ces fonctions ont déjà divergé une fois
  (tirage couleur fantôme, brelan du board compté comme value) : **ne les redéfinis jamais ailleurs**.
- **`src/renderer/src/lib/simEngine.ts`** — moteur de SIMULATION séparé (Monte-Carlo équité/tournois),
  pur lui aussi. À ne pas confondre avec le moteur live (GamePage/pokerEngine).
- **`src/renderer/src/components/RangeAssistant.tsx`** — le panneau coach (onglets Range / 🧠 histoire).

⚠️ **Deux moteurs distincts** : le moteur LIVE (`GamePage` + `pokerEngine`) joue les mains réelles ;
`simEngine` ne sert qu'aux probas. Un bug de jeu live se corrige dans `pokerEngine`/`GamePage`.

---

## 🌍 i18n — parité obligatoire (et locales à la demande)

Trois locales : `src/renderer/src/i18n/locales/{fr,en,es}.json`. **Toute** clé ajoutée doit exister dans
les **trois**. Vérifie avec `npm run i18n:lint` (inclus dans `npm run check`).

⚠️ **Chargement à la demande** : seule la locale du visiteur est téléchargée (les 3 pesaient 236 Ko dans
le chemin critique), et `fallbackLng` = la locale détectée elle-même. **Il n'y a donc plus de repli vers
l'anglais** : une clé absente s'affiche brute. Pour changer de langue, utilise `setLanguage(code)`
exporté par `i18n/index.ts` (il charge le bundle AVANT de basculer) — jamais `i18n.changeLanguage`
directement. `main.tsx` attend `i18nReady` avant de monter React. Garde le moteur (`pokerEngine`, `simEngine`) **sans i18n** :
la traduction se fait dans les composants/coach (ex. `bestHandScore` rend une catégorie, `GamePage` la
traduit via `handCatLabel`).

---

## ☁️ Persistance — local d'abord, cloud en miroir

`localStorage` reste la source de vérité (instantané, hors-ligne, déconnecté) ; Supabase est un **miroir**
pour rendre le COMPTE portable (changer de téléphone sans perdre sa progression). Tables dans
`supabase/schema.sql` (`subscriptions` en écriture serveur seule, `sessions` + `perf_scores` écrites par
le client sous RLS `auth.uid() = user_id`). **Après toute modif du schéma : relancer le SQL dans Supabase**
(il est idempotent). Tout appel cloud est fire-and-forget et no-op si Supabase n'est pas configuré ou si
personne n'est connecté → l'app doit se comporter à l'identique hors-ligne.

Les replays sont plafonnés dans le cloud (20 mains/session, 30 sessions/joueur) : c'est le gros morceau
et le moins coûteux à perdre. Les scores de perf, minuscules, sont synchronisés intégralement.

## 📱 Web ⇄ Electron ⇄ mobile

- **Router** : `BrowserRouter` sur le web (URLs propres, partageables, indexables — `vercel.json` réécrit
  tout vers `index.html`), `HashRouter` sur Electron (`file://`). Voir `main.tsx`.
- **Code-splitting** : seules landing/auth/lobby sont eager ; tout le reste est en `React.lazy`. Ne
  ré-importe pas statiquement une page lourde dans le shell, ça annulerait le découpage.
- **Mobile** : la table se joue en **paysage forcé** (`RotateGate`). `compactTable` pilote le scaling.
  `globals.css` neutralise `backdrop-filter` sur pointeur grossier, fige `text-size-adjust` (iOS
  gonfle le texte en paysage) et gère les safe-areas (`.safe-pb` / `.safe-px`).

## 🚀 Rituel de déploiement (vers la PWA Vercel)

Le travail se fait sur la branche `feat/poker-game-engine`. `main` est déployée par Vercel.

```bash
# 1. valider (cf. règle d'or)
npm run check && npm run build:web
# 2. commit sur la branche de feature
git add -A && git commit -m "..."
# 3. fast-forward main + push (déclenche le déploiement)
git checkout main && git merge --ff-only feat/poker-game-engine && git push origin main
git checkout feat/poker-game-engine
```

**Format de commit** : `type(scope): résumé` (ex. `fix(game): ...`, `feat(coach): ...`). Corps explicatif
si non trivial. Terminer par :

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

Ne commit/push **que** si demandé. Ne jamais `--no-verify`.

---

## ✅ Checklist avant de livrer

- [ ] `npm run check` vert (typecheck + i18n + les 2 bancs)
- [ ] `npm run build:web` vert
- [ ] si tu as touché au démarrage (i18n, router, auth) : **smoke test navigateur** — la landing doit
      s'afficher, le sélecteur de langue basculer, et une partie reprendre après un rechargement
- [ ] banc mis à jour si tu as changé une règle exprès
- [ ] commit `type(scope):` + `Co-Authored-By`
