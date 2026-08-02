// Single source of truth for the table's currency. The live game uses abstract "chips"
// that are simply DENOMINATED in the currency the player picked at table creation, so a
// module-level symbol + formatter is enough (it's set once when a game mounts and never
// changes mid-session). $ and € sit before the amount, DH (Moroccan dirham) after it.
let SYMBOL = '$'
let SUFFIX = false
let LOCALE: string | undefined = undefined   // in-app language for number grouping

export function setCurrency(sym: string | undefined | null): void {
  SYMBOL = sym || '$'
  SUFFIX = SYMBOL === 'DH'   // dirham reads "100 DH", dollar/euro read "$100" / "€100"
}

// Set the grouping locale to the in-app language (fr → "8 100", en → "8,100"), instead of
// defaulting to the host/OS locale which needn't match the language the user picked.
export function setMoneyLocale(lang: string | undefined | null): void { LOCALE = lang || undefined }

export function curSymbol(): string { return SYMBOL }
export function curIsSuffix(): boolean { return SUFFIX }

// Format an amount with the active currency. Negative amounts read "-$50" / "-50 DH"
// (sign before the symbol, not "$-50").
export function money(n: number): string {
  const neg = n < 0
  const v = Math.round(Math.abs(n)).toLocaleString(LOCALE)
  const body = SUFFIX ? `${v} ${SYMBOL}` : `${SYMBOL}${v}`
  return neg ? `-${body}` : body
}
