import { CoverageFacts, isCovering } from './coverage-rules';

describe('isCovering', () => {
  const covering: CoverageFacts = {
    actorId: 'backup',
    ownerId: 'owner',
    ownerBackupId: 'backup',
    ownerIsActiveMember: true,
    ownerOnLeaveToday: true,
    actorIsActiveMember: true,
  };

  it('covers when the owner is on leave today and the actor is his backup here', () => {
    expect(isCovering(covering)).toBe(true);
  });

  it.each<[string, Partial<CoverageFacts>]>([
    ['the owner is not on leave today', { ownerOnLeaveToday: false }],
    ['someone else is the backup', { ownerBackupId: 'someone-else' }],
    ['the owner has no backup', { ownerBackupId: null }],
    ['the actor left the project', { actorIsActiveMember: false }],
    ['the owner left the project', { ownerIsActiveMember: false }],
    ['the actor is the owner', { actorId: 'owner', ownerBackupId: 'owner' }],
  ])('does not cover when %s', (_, change) => {
    expect(isCovering({ ...covering, ...change })).toBe(false);
  });
});
