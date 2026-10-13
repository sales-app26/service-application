/**
 * Ordering for the team screens, as pure functions — no database — so the
 * rules are unit-tested in isolation.
 */

export interface LeaderboardCounts {
  userId: string;
  name: string;
  conversions: number;
  followUps: number;
}

export interface RankedRow<T extends LeaderboardCounts> {
  row: T;
  rank: number;
}

/**
 * Most conversions first, then most follow-ups, then by name. People with the
 * same conversions and follow-ups share a rank, and the next rank skips
 * (1, 2, 2, 4) — the name only decides who is listed first.
 */
export const rankLeaderboard = <T extends LeaderboardCounts>(
  rows: readonly T[],
): RankedRow<T>[] => {
  const sorted = [...rows].sort(
    (a, b) =>
      b.conversions - a.conversions ||
      b.followUps - a.followUps ||
      a.name.localeCompare(b.name) ||
      a.userId.localeCompare(b.userId),
  );

  return sorted.map((row, index) => {
    const first = sorted.findIndex(
      (other) => other.conversions === row.conversions && other.followUps === row.followUps,
    );
    return { row, rank: (first === -1 ? index : first) + 1 };
  });
};

export interface RosterSortable {
  name: string;
  onLeave: unknown | null;
  overdue: number;
}

/** People at work first, the most overdue first among them, then by name; those on leave last. */
export const compareRoster = (a: RosterSortable, b: RosterSortable): number =>
  Number(a.onLeave !== null) - Number(b.onLeave !== null) ||
  b.overdue - a.overdue ||
  a.name.localeCompare(b.name);
