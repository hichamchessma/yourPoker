import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// ─────────────────────────────────────────────────────────────────────────────
// i18n with ON-DEMAND locales. The three bundles weigh ~236 KB together, and a
// given visitor needs exactly ONE of them — statically importing all three put
// ~160 KB of dead weight in the critical path of every first paint.
//
// So: detect the language, dynamically import only that bundle, and resolve
// `i18nReady` once i18next is initialised. main.tsx awaits it BEFORE mounting
// React, so no component ever renders against an empty resource set.
//
// `fallbackLng` is the detected language itself (not a hardcoded 'en'): key
// parity across fr/en/es is guaranteed by `npm run i18n:lint`, which is part of
// `npm run check` — so a cross-language fallback can never be needed, and we
// avoid shipping a second bundle "just in case".
// ─────────────────────────────────────────────────────────────────────────────

export const LANGS = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
] as const

export type LangCode = (typeof LANGS)[number]['code']

const LS_KEY = 'yourpoker_lang'

// Vite turns each of these into its own lazily-fetched chunk.
const LOADERS: Record<LangCode, () => Promise<{ default: Record<string, unknown> }>> = {
  fr: () => import('./locales/fr.json'),
  en: () => import('./locales/en.json'),
  es: () => import('./locales/es.json'),
}

function isLang(x: string): x is LangCode {
  return x === 'fr' || x === 'en' || x === 'es'
}

// Same resolution order the language-detector plugin used: saved choice first,
// then the browser/OS locale (fr-FR → fr), else English.
function detect(): LangCode {
  try {
    const saved = localStorage.getItem(LS_KEY) ?? ''
    if (isLang(saved.slice(0, 2))) return saved.slice(0, 2) as LangCode
  } catch { /* storage blocked (private mode) → fall through */ }
  const nav = typeof navigator !== 'undefined' ? (navigator.language || '') : ''
  const code = nav.slice(0, 2).toLowerCase()
  return isLang(code) ? code : 'en'
}

const loaded = new Set<LangCode>()

async function loadBundle(lng: LangCode): Promise<void> {
  if (loaded.has(lng)) return
  const mod = await LOADERS[lng]()
  i18n.addResourceBundle(lng, 'translation', mod.default, true, true)
  loaded.add(lng)
}

const initial = detect()

/** Resolves when i18next is initialised with the visitor's locale. Awaited in main.tsx. */
export const i18nReady: Promise<void> = (async () => {
  const mod = await LOADERS[initial]()
  loaded.add(initial)
  await i18n.use(initReactI18next).init({
    resources: { [initial]: { translation: mod.default } },
    lng: initial,
    fallbackLng: initial,
    supportedLngs: ['fr', 'en', 'es'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
  })
})()

/**
 * Switch language: fetch its bundle FIRST, then flip — otherwise the UI would
 * flash raw translation keys while the chunk is in flight. Use this instead of
 * calling i18n.changeLanguage directly.
 */
export async function setLanguage(code: LangCode): Promise<void> {
  if (code === i18n.resolvedLanguage) return
  await loadBundle(code)
  try { localStorage.setItem(LS_KEY, code) } catch { /* ignore */ }
  await i18n.changeLanguage(code)
}

export default i18n
