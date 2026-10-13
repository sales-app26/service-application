import { compareRoster, rankLeaderboard } from './team-rules';

describe('rankLeaderboard', () => {
  const row = (name: string, conversions: number, followUps: number) => ({
    userId: name.toLowerCase(),
    name,
    conversions,
    followUps,
  });

  it('orders by conversions, then follow-ups, then name', () => {
    const ranked = rankLeaderboard([
      row('Ravi', 2, 10),
      row('Asha', 3, 1),
      row('Priya', 2, 12),
      row('Karan', 0, 0),
    ]);
    expect(ranked.map((r) => [r.row.name, r.rank])).toEqual([
      ['Asha', 1],
      ['Priya', 2],
      ['Ravi', 3],
      ['Karan', 4],
    ]);
  });

  it('gives a shared rank to equal counts and skips the next', () => {
    const ranked = rankLeaderboard([
      row('Ravi', 1, 5),
      row('Asha', 1, 5),
      row('Meera', 4, 0),
      row('Karan', 0, 9),
    ]);
    expect(ranked.map((r) => [r.row.name, r.rank])).toEqual([
      ['Meera', 1],
      ['Asha', 2],
      ['Ravi', 2],
      ['Karan', 4],
    ]);
  });
});

describe('compareRoster', () => {
  it('puts people on leave last, then the most overdue first, then by name', () => {
    const leave = { startsOn: '2026-10-13', endsOn: '2026-10-14' };
    const people = [
      { name: 'Zoya', onLeave: null, overdue: 1 },
      { name: 'Asha', onLeave: leave, overdue: 9 },
      { name: 'Ravi', onLeave: null, overdue: 4 },
      { name: 'Karan', onLeave: null, overdue: 1 },
    ];
    expect([...people].sort(compareRoster).map((p) => p.name)).toEqual([
      'Ravi',
      'Karan',
      'Zoya',
      'Asha',
    ]);
  });
});
