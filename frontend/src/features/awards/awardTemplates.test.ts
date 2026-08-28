import { describe, expect, it } from 'vitest';
import { AWARD_TEMPLATES, templateById } from './awardTemplates';

describe('AWARD_TEMPLATES', () => {
  it('has a stable, unique id for every template', () => {
    const ids = AWARD_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every template a name and an artwork key', () => {
    for (const template of AWARD_TEMPLATES) {
      expect(template.name.trim()).not.toBe('');
      expect(template.artworkKey.trim()).not.toBe('');
    }
  });

  it('includes the superlatives the issue named', () => {
    const names = AWARD_TEMPLATES.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Best Paint',
        'Most Original',
        'Best Use of Colour',
        'Most Aerodynamic',
        'Most Patriotic',
        'Best Scout Spirit',
        "Judges' Choice",
      ]),
    );
  });
});

describe('templateById', () => {
  it('finds a template by its id', () => {
    expect(templateById('best-paint')?.name).toBe('Best Paint');
  });

  it('returns undefined for an id that does not exist', () => {
    expect(templateById('nonexistent')).toBeUndefined();
  });
});
