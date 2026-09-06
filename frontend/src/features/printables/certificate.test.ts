import { describe, expect, it } from 'vitest';
import { certificatesFor, signerTitleForOrg } from './certificate';

const RACE = { name: 'Pack 42 Derby', dateTime: '2026-03-14T09:00:00', location: 'The gym' };

describe('certificatesFor', () => {
  it('builds one certificate per award', () => {
    const certificates = certificatesFor(RACE, [
      { id: 1, name: 'Best Paint', kind: 'SPECIAL', sortOrder: 0, artworkKey: 'paintbrush' },
      { id: 2, name: 'Fastest Car', kind: 'SPEED', sortOrder: 1, artworkKey: 'trophy' },
    ]);
    expect(certificates).toHaveLength(2);
    expect(certificates[0].awardName).toBe('Best Paint');
    expect(certificates[1].awardName).toBe('Fastest Car');
  });

  it('fills in the recipient when there is one', () => {
    const certificates = certificatesFor(RACE, [
      {
        id: 1,
        name: 'Best Paint',
        kind: 'SPECIAL',
        recipient: { firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 },
      },
    ]);
    expect(certificates[0].recipientName).toBe('Ada Lovelace (#42)');
  });

  it('prints an undecided award with a blank line rather than skipping it', () => {
    // Most awards stay undecided right up until the ceremony. Skipping them
    // here would mean reprinting the whole batch the moment judging finishes.
    const certificates = certificatesFor(RACE, [
      { id: 1, name: 'Best Paint', kind: 'SPECIAL', recipient: null },
    ]);
    expect(certificates).toHaveLength(1);
    expect(certificates[0].recipientName).toBeNull();
  });

  it('carries the artwork key through, or null for a plain certificate', () => {
    const certificates = certificatesFor(RACE, [
      { id: 1, name: 'Best Paint', kind: 'SPECIAL', artworkKey: 'paintbrush' },
      { id: 2, name: 'Best in Show', kind: 'SPECIAL', artworkKey: null },
    ]);
    expect(certificates[0].artworkKey).toBe('paintbrush');
    expect(certificates[1].artworkKey).toBeNull();
  });

  it('carries the race name onto every certificate', () => {
    const certificates = certificatesFor(RACE, [
      { id: 1, name: 'Best Paint', kind: 'SPECIAL' },
    ]);
    expect(certificates[0].raceName).toBe('Pack 42 Derby');
  });

  it('orders by sortOrder then id, the ceremony’s own running order', () => {
    const certificates = certificatesFor(RACE, [
      { id: 5, name: 'Second, higher id', kind: 'SPECIAL', sortOrder: 1 },
      { id: 1, name: 'First', kind: 'SPECIAL', sortOrder: 0 },
      { id: 2, name: 'Third, same order as second but lower id', kind: 'SPECIAL', sortOrder: 1 },
    ]);
    expect(certificates.map((c) => c.awardName)).toEqual([
      'First',
      'Third, same order as second but lower id',
      'Second, higher id',
    ]);
  });

  it('produces nothing for a race with no awards', () => {
    expect(certificatesFor(RACE, [])).toEqual([]);
  });

  it('abbreviates the recipient name when told to (#552)', () => {
    const certificates = certificatesFor(
      RACE,
      [
        {
          id: 1,
          name: 'Best Paint',
          kind: 'SPECIAL',
          recipient: { firstName: 'Ada', lastName: 'Lovelace', carNumber: 42 },
        },
      ],
      'LAST_INITIAL',
    );
    expect(certificates[0].recipientName).toBe('Ada L. (#42)');
  });
});

describe('signerTitleForOrg', () => {
  it('returns Cubmaster for Pack or when unspecified', () => {
    expect(signerTitleForOrg('Pack')).toBe('Cubmaster');
    expect(signerTitleForOrg('pack')).toBe('Cubmaster');
    expect(signerTitleForOrg('Cub Scout Pack')).toBe('Cubmaster');
    expect(signerTitleForOrg(null)).toBe('Cubmaster');
    expect(signerTitleForOrg(undefined)).toBe('Cubmaster');
    expect(signerTitleForOrg('')).toBe('Cubmaster');
  });

  it('returns Scoutmaster for Troop', () => {
    expect(signerTitleForOrg('Troop')).toBe('Scoutmaster');
    expect(signerTitleForOrg('Scout Troop')).toBe('Scoutmaster');
  });

  it('returns Advisor for Crew and Post', () => {
    expect(signerTitleForOrg('Crew')).toBe('Advisor');
    expect(signerTitleForOrg('Post')).toBe('Advisor');
  });

  it('returns Skipper for Ship', () => {
    expect(signerTitleForOrg('Ship')).toBe('Skipper');
  });

  it('returns Principal for School', () => {
    expect(signerTitleForOrg('School')).toBe('Principal');
  });

  it('returns Coach for Team', () => {
    expect(signerTitleForOrg('Team')).toBe('Coach');
  });

  it('returns Club Leader for Club', () => {
    expect(signerTitleForOrg('Club')).toBe('Club Leader');
  });

  it('returns Race Director for district, council, or generic organization', () => {
    expect(signerTitleForOrg('District')).toBe('Race Director');
    expect(signerTitleForOrg('Council')).toBe('Race Director');
    expect(signerTitleForOrg('Organization')).toBe('Race Director');
    expect(signerTitleForOrg('Group')).toBe('Race Director');
  });

  it('preserves custom titles that already include a leader designation', () => {
    expect(signerTitleForOrg('Race Director')).toBe('Race Director');
    expect(signerTitleForOrg('Camp Director')).toBe('Camp Director');
    expect(signerTitleForOrg('Awana Commander')).toBe('Awana Commander');
  });

  it('appends Leader for other custom organization terms', () => {
    expect(signerTitleForOrg('Awana')).toBe('Awana Leader');
    expect(signerTitleForOrg('Youth League')).toBe('Youth League Leader');
  });
});
