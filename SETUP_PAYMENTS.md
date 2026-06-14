# Activer les paiements (Lemon Squeezy) — guide

Tout le code est déjà là et **inerte**. Pour encaisser, il suffit de créer les comptes,
coller quelques clés et lancer un SQL. ~30-45 min. Aucune ligne de code à écrire.

## 1) Base de données (Supabase) — 2 min
1. Supabase → ton projet → **SQL Editor** → **New query**.
2. Colle le contenu de [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   (Crée la table `subscriptions` + la sécurité RLS : chaque user ne lit que sa ligne,
   seul le serveur écrit.)

## 2) Lemon Squeezy — créer le produit — ~15 min
1. Crée un compte sur **lemonsqueezy.com** (c'est le *Merchant of Record* : il gère
   paiement + TVA UE + factures à ta place).
2. **Store** → crée ta boutique.
3. **Products → New product** « Poker Elite Coach — Pro ». Ajoute **2 variantes** :
   - **Pro mensuel** (abonnement, 9,99 €/mois)
   - **Pro annuel** (abonnement, 79 €/an)
4. Pour chaque variante → **Share / Get checkout URL** → copie les **2 URLs de checkout**.

## 3) Webhook Lemon Squeezy — ~5 min
1. LS → **Settings → Webhooks → +** .
2. **Callback URL** : `https://your-poker.vercel.app/api/lemonsqueezy-webhook`
3. **Signing secret** : invente une chaîne secrète (garde-la).
4. **Events** : coche `subscription_created`, `subscription_updated`,
   `subscription_cancelled`, `subscription_expired`, `subscription_resumed`.

## 4) Clés dans Vercel — ~5 min
Vercel → projet `your-poker` → **Settings → Environment Variables**. Ajoute :

| Name | Value |
|---|---|
| `VITE_LS_CHECKOUT_MONTHLY` | l'URL de checkout **mensuel** (étape 2) |
| `VITE_LS_CHECKOUT_YEARLY` | l'URL de checkout **annuel** (étape 2) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | le secret du webhook (étape 3) |
| `SUPABASE_URL` | même valeur que `VITE_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** (⚠️ SECRET) |

Puis **Redeploy** (Vercel → Deployments → … → Redeploy).

## 5) Tester — 2 min
1. Va sur le site, **Passer Pro** → tu es redirigé vers le checkout Lemon Squeezy.
2. Paie en **mode test** (LS fournit des cartes de test).
3. Le webhook écrit `status=active` dans Supabase → au rechargement, tu es **Pro**
   (couronne dorée). 🎉

---

### Comment ça marche (pour info)
- Le bouton « Passer Pro » ouvre le checkout LS avec ton **id utilisateur** en custom data.
- LS encaisse → POST le webhook → la fonction `api/lemonsqueezy-webhook.ts` vérifie la
  signature et écrit le statut dans `subscriptions` (clé **service_role**, jamais le client).
- L'app lit ce statut au login (`refreshProFromServer`) → `isPro` vient du **serveur**
  (impossible à falsifier depuis le navigateur). Renouvellements/annulations gérés.
- Tant que les variables ne sont pas mises : « Passer Pro » débloque gratuitement (bêta).
