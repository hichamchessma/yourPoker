// ─────────────────────────────────────────────────────────────────────────────
// Lemon Squeezy webhook (Vercel serverless function). Lemon Squeezy is our Merchant
// of Record: it handles payment, EU VAT and invoicing. On every subscription event it
// POSTs here; we verify the HMAC signature, then write the user's Pro status into the
// Supabase `subscriptions` table using the SERVICE-ROLE key (never the client).
//
// This file is INERT until the env vars below are set in Vercel:
//   LEMONSQUEEZY_WEBHOOK_SECRET   (from the LS webhook you create)
//   SUPABASE_URL                  (your project URL)
//   SUPABASE_SERVICE_ROLE_KEY     (Supabase → Settings → API → service_role — SECRET)
//
// The checkout must pass the Supabase user id as custom data: checkout[custom][user_id].
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// We need the RAW body to verify the signature, so disable Vercel's body parser.
export const config = { api: { bodyParser: false } }

async function readRawBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks)
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return }

  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret || !supabaseUrl || !serviceKey) { res.status(500).json({ error: 'payments not configured' }); return }

  // 1) Verify the HMAC-SHA256 signature over the raw body.
  const raw = await readRawBody(req)
  const provided = String(req.headers['x-signature'] || '')
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const ok = provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  if (!ok) { res.status(401).json({ error: 'invalid signature' }); return }

  // 2) Parse the event.
  let event: any
  try { event = JSON.parse(raw.toString('utf8')) } catch { res.status(400).json({ error: 'bad json' }); return }

  const userId = event?.meta?.custom_data?.user_id
  const attr = event?.data?.attributes ?? {}
  const lsId = event?.data?.id
  if (!userId) { res.status(200).json({ ok: true, skipped: 'no user_id in custom_data' }); return }

  // LS statuses: active, on_trial, paused, past_due, unpaid, cancelled, expired.
  const rawStatus: string = attr.status || 'free'
  const status = (rawStatus === 'active' || rawStatus === 'on_trial') ? 'active' : rawStatus
  const plan = attr.variant_name || null
  const periodEnd = attr.renews_at || attr.ends_at || null

  // 3) Upsert the subscription with the service role (bypasses RLS — server only).
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { error } = await supabase.from('subscriptions').upsert({
    user_id: userId,
    status,
    plan,
    ls_subscription_id: lsId ? String(lsId) : null,
    current_period_end: periodEnd,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(200).json({ ok: true })
}
