// Felt geometry shared by the LIVE table and the hand-history replay, so a bet
// stack is drawn in the same place in both (it used to be a private helper inside
// GamePage that the replay could only reach by importing the whole page).
export const POT_POS = { x: 50, y: 50 }
// Offset (in % of table box) of a player's committed-bet chip stack, placed
// on the line from the seat toward the table center.
export function betOffset(leftPct: number, topPct: number): { x: number; y: number } {
  // The hole CARDS sit ABOVE the seat-panel centre, so the line "cards → pot" is NOT the
  // same as "seat → pot". Anchor the chips on the CARDS→pot line so seat-cards-chips-pot
  // read as one straight line pointing at the pot, for EVERY seat (top, sides, bottom).
  const isHero = topPct > 62 && Math.abs(leftPct - 50) < 16
  const co = isHero ? 13 : 6                 // how far the cards sit above the seat centre (%)
  const ay = topPct - co                     // the cards' y — the line's anchor
  const dx = 50 - leftPct, dy = 50 - ay
  const len = Math.hypot(dx, dy) || 1
  // Push the chips PAST the cards toward the pot. Bottom seats only clear their cards;
  // top/side seats must clear the whole panel that sits between their cards and the pot.
  const d = isHero ? 8 : topPct > 60 ? 8 : 16
  return { x: (dx / len) * d, y: -co + (dy / len) * d }
}
