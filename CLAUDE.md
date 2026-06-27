# yourPoker — guide de contribution (humain & agent)

Application d'entraînement au poker (Texas Hold'em) : bots IA, coach d'équité/GTO, cash + tournois MTT.
**Stack** : Electron 28 + React 18 + TypeScript 5 + Vite 5, déployée en **PWA sur Vercel**. i18n FR/EN/ES.

---

## ⛔ Règle d'or — TOUJOURS valider avant de livrer

Vite **ne typecheck pas**. Lance ces trois étapes, dans l'ordre, après toute modif de logique :

```bash
npm run typecheck      # tsc --noEmit -p tsconfig.web.json   (Vite ne le fait PAS)
npm run build:web      # vite build — vérifie que ça bundle
npm run bench          # bancs de non-régression (coach + moteur)
```

Raccourci : **`npm run check`** = typecheck + les deux bancs. Le build web reste à lancer à part.

Si tu touches aux traductions : **`npm run i18n:lint`** (parité stricte FR/EN/ES — même clés partout).

---

## 🧪 Les bancs de non-régression — le filet de sécurité

Le moteur et le coach ont chacun un banc d'invariants. **Ils doivent rester verts.** Si tu changes une
règle exprès, mets le banc à jour dans le même commit (ne le contourne jamais).

| Banc | Fichier | Couvre | Commande |
|------|---------|--------|----------|
| **Coach** | `tools/coach-bench.ts` | sizings par texture, décisions, ranges préflop, jams, lecture des tailles, exploit | `npm run bench:coach` |
| **Moteur** | `tools/engine-bench.ts` | évaluateur de mains, side-pots, résolution des mises + **règle de réouverture** | `npm run bench:engine` |

Un banc échoué **sort en code 1** et liste les invariants cassés. Les assertions utilisent des mains
franches (pas d'équités au ras du rasoir) pour ne pas flotter sur le bruit Monte-Carlo.

> Pourquoi un banc plutôt que tester en jouant : avant lui, les bugs (ex. la relance incomplète) étaient
> repérés en partie → 2e tour. Le banc les attrape **avant** de livrer.

---

## 🏗️ Architecture — où vit la logique

- **`src/renderer/src/lib/pokerEngine.ts`** — cœur PUR du moteur live : `bestHandScore` (évaluateur),
  `computeSidePots`, `resolveAction` (mise/relance + règle de réouverture). **Zéro dépendance React/i18n**
  → testable directement. `GamePage` **délègue** à ces fonctions : le banc teste donc le vrai code.
- **`src/renderer/src/pages/GamePage.tsx`** — orchestration du jeu live (état React, file d'action,
  transitions de street, showdown, sandbox « Revive »). La logique pure en a été **extraite** vers
  `pokerEngine.ts` ; n'y ré-inline pas de math de mise — passe par `resolveAction`.
- **`src/renderer/src/lib/postflopAdvisor.ts`** — coach postflop (`getPostflopAdvice`), narration
  « Dans la tête d'un pro » (`buildPostflopStory`/`buildPreflopStory`), équité Monte-Carlo. Source de
  `Card`, `handCatLabel`.
- **`src/renderer/src/lib/preflopRanges.ts`** — ranges préflop (RFI/vs-open/squeeze/jams).
- **`src/renderer/src/lib/rangeEstimator.ts`** — Range Vision (estimation de la range adverse, lecture
  des tailles).
- **`src/renderer/src/lib/simEngine.ts`** — moteur de SIMULATION séparé (Monte-Carlo équité/tournois),
  pur lui aussi. À ne pas confondre avec le moteur live (GamePage/pokerEngine).
- **`src/renderer/src/components/RangeAssistant.tsx`** — le panneau coach (onglets Range / 🧠 histoire).

⚠️ **Deux moteurs distincts** : le moteur LIVE (`GamePage` + `pokerEngine`) joue les mains réelles ;
`simEngine` ne sert qu'aux probas. Un bug de jeu live se corrige dans `pokerEngine`/`GamePage`.

---

## 🌍 i18n — parité obligatoire

Trois locales : `src/renderer/src/i18n/locales/{fr,en,es}.json`. **Toute** clé ajoutée doit exister dans
les **trois**. Vérifie avec `npm run i18n:lint`. Garde le moteur (`pokerEngine`, `simEngine`) **sans i18n** :
la traduction se fait dans les composants/coach (ex. `bestHandScore` rend une catégorie, `GamePage` la
traduit via `handCatLabel`).

---

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

- [ ] `npm run typecheck` vert
- [ ] `npm run build:web` vert
- [ ] `npm run bench` vert (coach + moteur)
- [ ] clés i18n dans les 3 locales (`npm run i18n:lint`) si tu as touché au texte
- [ ] banc mis à jour si tu as changé une règle exprès
- [ ] commit `type(scope):` + `Co-Authored-By`
