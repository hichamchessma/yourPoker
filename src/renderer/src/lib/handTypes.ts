// -----------------------------------------------------------------------------
// Shared hand-history vocabulary. These types used to live inside GamePage.tsx,
// which forced the stores, the replay pages and the perf modal to import from a
// 5 000-line PAGE just to name a record -- and dragged the whole game engine into
// their bundles. Pure types: zero runtime cost.
// -----------------------------------------------------------------------------
import type { EquityReasoning } from './postflopAdvisor'

export type Suit = '♠' | '♥' | '♦' | '♣'
export type Phase = 'idle' | 'dealing' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export interface Card { rank: string; suit: Suit }

export interface HistoryAction {
  phase: Phase; seatIdx: number; name: string; isHero: boolean
  actionType: string; amount: number; potAfter: number
}
export interface HandHistoryRecord {
  id: number; handNum: number; date: Date
  players: Array<{
    idx: number; name: string; isHero: boolean; position: string
    startStack: number; endStack: number
    holeCards: [Card|null, Card|null]; isFolded: boolean; isWinner: boolean
    level: number; seatType: 'bot' | 'human'
  }>
  board: (Card|null)[]; actions: HistoryAction[]
  finalPot: number; sb: number; bb: number
  heroProfit: number; winnerNames: string[]
}

// -- Coach critique of one hero action (the "Juge mon coup" verdict) --
// Stable, language-agnostic leak buckets (for the session perf report aggregation).
export type LeakKind = 'pf-loose' | 'overcall' | 'passive' | 'overfold' | 'overaggro' | 'sizing-big' | 'sizing-small'
export interface MoveCritique { verdict: 'good' | 'ok' | 'mistake'; headline: string; lines: string[]; reasoning?: EquityReasoning | null; phase?: Phase; leak?: LeakKind | null }

// -- Session performance report --
export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export interface StreetStat { n: number; good: number; ok: number; mistake: number; acc: number }
export interface SessionMistake { handId: number; handNum: number; actionIdx: number; phase: Street; headline: string; leak: LeakKind | null; verdict: 'ok' | 'mistake' }
export interface SessionEval {
  score: number; grade: 'S' | 'A' | 'B' | 'C' | 'D'
  decisions: number; good: number; ok: number; mistake: number
  streets: Record<Street, StreetStat>
  leaks: Array<{ kind: LeakKind; count: number }>
  worstStreet: Street | null; bestStreet: Street | null
  topMistakes: SessionMistake[]
}
