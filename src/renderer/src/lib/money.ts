// Single source of truth for the table's currency. The live game uses abstract "chips"
// that are simply DENOMINATED in the currency the player picked at table creation, so a
// module-level symbol + formatter is enough (it's set once when a game mounts and never
// changes mid-session). $ and € sit before the amount, DH (Moroccan dirham) after it.
let SYMBOL = '$'
let SUFFIX = false

export function setCurrency(sym: string | undefined | null): void {
  SYMBOL = sym || '$'
  SUFFIX = SYMBOL === 'DH'   // dirham reads "100 DH", dollar/euro read "$100" / "€100"
}

export function curSymbol(): string { return SYMBOL }
export function curIsSuffix(): boolean { return SUFFIX }

// Format an amount with the active currency. Uses the runtime locale's grouping (matches
// the rest of the UI, e.g. "8 100" in FR / "8,100" in EN).
export function money(n: number): string {
  const v = Math.round(n).toLocaleString()
  return SUFFIX ? `${v} ${SYMBOL}` : `${SYMBOL}${v}`
}
