import type { MultiplayerStatsRecord, StatsFilters, StatsGuessSnapshot, StatsRecord, StatsRound } from "./types";

export interface WorkMetric {
  id: string;
  code: string;
  title: string;
  total: number;
  wins: number;
  winRate: number;
}

export interface HistogramBin {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface SummaryMetrics {
  plays: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  averageMs: number;
  medianMs: number;
  p90Ms: number;
}

export function filterStatsRecords(records: StatsRecord[], filters: StatsFilters): StatsRecord[] {
  const from = filters.from ? Date.parse(`${filters.from}T00:00:00`) : Number.NEGATIVE_INFINITY;
  const to = filters.to ? Date.parse(`${filters.to}T23:59:59.999`) : Number.POSITIVE_INFINITY;
  return records.filter((record) => {
    const startedAt = Date.parse(record.startedAt);
    if (filters.mode !== "all" && record.mode !== filters.mode) return false;
    if (startedAt < from || startedAt > to) return false;
    if (
      filters.multiplayerMode !== "all" &&
      (record.kind !== "multiplayer" || (record.multiplayerMode ?? "race") !== filters.multiplayerMode)
    ) return false;
    return filters.format === "all" || (record.kind === "multiplayer" && record.format === filters.format);
  });
}

export function roundsForRecords(records: StatsRecord[]): StatsRound[] {
  return records.flatMap((record) => record.kind === "single" ? [record.round] : record.rounds);
}

function inferRelayMemberSlot(record: MultiplayerStatsRecord): 1 | 2 | undefined {
  if ((record.multiplayerMode ?? "race") !== "relay") return record.memberSlot;
  if (record.memberSlot) return record.memberSlot;
  for (const round of record.rounds) {
    const winnerGuess = round.guesses.find((guess) => guess.correct && guess.memberSlot);
    if (!winnerGuess?.memberSlot) continue;
    if (round.result === "win") return winnerGuess.memberSlot;
    if (round.result === "loss") return winnerGuess.memberSlot === 1 ? 2 : 1;
  }
  return undefined;
}

export function displayGuessesForRecord(record: StatsRecord): StatsGuessSnapshot[] {
  const guesses = roundsForRecords([record]).flatMap((round) => round.guesses);
  if (record.kind !== "multiplayer" || (record.multiplayerMode ?? "race") !== "relay") return guesses;
  const selfSlot = inferRelayMemberSlot(record);
  if (!selfSlot) return guesses;
  if (!guesses.some((guess) => guess.memberSlot)) return guesses;
  return guesses.filter((guess) => guess.memberSlot === selfSlot);
}

export function quantile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, percentile));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function summarize(records: StatsRecord[]): SummaryMetrics {
  const eligible = records.filter((record) => record.outcome !== "incomplete");
  const durations = roundsForRecords(eligible).map((round) => round.durationMs);
  const wins = eligible.filter((record) => record.outcome === "win").length;
  const draws = eligible.filter((record) => record.outcome === "draw").length;
  const losses = eligible.length - wins - draws;
  return {
    plays: eligible.length,
    wins,
    losses,
    draws,
    winRate: eligible.length ? wins / eligible.length : 0,
    averageMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
    medianMs: quantile(durations, 0.5),
    p90Ms: quantile(durations, 0.9),
  };
}

export function aggregateWorks(records: StatsRecord[]): WorkMetric[] {
  const metrics = new Map<string, WorkMetric>();
  for (const round of roundsForRecords(records.filter((record) => record.outcome !== "incomplete"))) {
    const work = round.answer.work;
    if (!work) continue;
    const current = metrics.get(work.id) ?? { id: work.id, code: work.code, title: work.title, total: 0, wins: 0, winRate: 0 };
    current.total += 1;
    if (round.result === "win") current.wins += 1;
    current.winRate = current.wins / current.total;
    metrics.set(work.id, current);
  }
  return [...metrics.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export function winningGuessDistribution(records: StatsRecord[]): { guesses: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const round of roundsForRecords(records)) {
    if (round.result !== "win") continue;
    counts.set(round.guesses.length, (counts.get(round.guesses.length) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left - right).map(([guesses, count]) => ({ guesses, count }));
}

export function guessDurations(records: StatsRecord[]): number[] {
  return roundsForRecords(records).flatMap((round) => round.guesses.map((guess) => guess.durationMs).filter((value): value is number => Number.isFinite(value)));
}

export function buildHistogram(values: number[], binCount = 8): HistogramBin[] {
  const safe = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (safe.length === 0) return [];
  const max = Math.max(...safe);
  const width = Math.max(1000, Math.ceil(Math.max(max, 1000) / Math.max(1, binCount) / 1000) * 1000);
  const count = Math.max(1, Math.ceil((max + 1) / width));
  const bins = Array.from({ length: count }, (_, index) => {
    const min = index * width;
    const upper = (index + 1) * width;
    return { label: `${Math.round(min / 1000)}-${Math.round(upper / 1000)}s`, min, max: upper, count: 0 };
  });
  for (const value of safe) bins[Math.min(bins.length - 1, Math.floor(value / width))].count += 1;
  return bins;
}

function localDateKey(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(key: string, delta: number): string {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return localDateKey(date.toISOString());
}

export function dailyStreak(records: StatsRecord[], now = new Date()): { current: number; longest: number } {
  const wins = new Set(
    records.flatMap((record) =>
      record.kind === "single" && record.mode === "daily" && record.outcome === "win"
        ? [record.puzzleKey ?? localDateKey(record.startedAt)]
        : [],
    ),
  );
  const sorted = [...wins].sort();
  let longest = 0;
  let run = 0;
  let previous: string | undefined;
  for (const key of sorted) {
    run = previous && addDays(previous, 1) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  const today = localDateKey(now.toISOString());
  let cursor = wins.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (wins.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

export function selfScore(record: MultiplayerStatsRecord): string {
  return `${record.scoreSelf}:${record.scoreOpponent}`;
}
