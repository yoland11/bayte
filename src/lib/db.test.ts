import { describe, expect, it } from 'vitest';
import { db } from './db';

describe('local database schema', () => {
  it('indexes option creation times for ordered selectors', () => {
    expect(db.categories.schema.indexes.map((index) => index.name)).toContain('createdAt');
    expect(db.stages.schema.indexes.map((index) => index.name)).toContain('createdAt');
  });
});
