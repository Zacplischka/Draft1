import { describe, expect, it } from 'vitest';
import { cellTone, consensus, consensusLabel, orderCohorts } from '../src/client/host-report';

describe('consensus: badge from spread width w = p75 − p25 (pinned thresholds)', () => {
  it('w ≤ 30 → strong consensus', () => {
    expect(consensus(60, 60)).toBe('strong');
    expect(consensus(50, 80)).toBe('strong');
  });

  it('30 < w < 50 → mixed', () => {
    expect(consensus(50, 81)).toBe('mixed');
    expect(consensus(0, 49)).toBe('mixed');
  });

  it('w ≥ 50 → polarised', () => {
    expect(consensus(40, 90)).toBe('polarised');
    expect(consensus(0, 100)).toBe('polarised');
  });

  it('labels match the mock copy', () => {
    expect(consensusLabel).toEqual({ strong: 'Strong consensus', mixed: 'Mixed', polarised: 'Polarised' });
  });
});

describe('orderCohorts: heatmap columns in shared-enum order, not server key order', () => {
  it('sorts known cohorts by the enum order', () => {
    expect(orderCohorts('department', ['Sales', 'Product', 'Engineering'])).toEqual([
      'Product',
      'Engineering',
      'Sales',
    ]);
    expect(orderCohorts('tenure', ['10+ years', '<1 year'])).toEqual(['<1 year', '10+ years']);
  });

  it('appends cohorts unknown to the enum (post-#25 swap safety) after the known ones', () => {
    expect(orderCohorts('role', ['Zzz', 'Manager'])).toEqual(['Manager', 'Zzz']);
  });

  it('empty in, empty out (zero-ballot heatmap)', () => {
    expect(orderCohorts('department', [])).toEqual([]);
  });
});

describe('cellTone: heatmap colour-scale buckets', () => {
  it('≥ 70 high, 40–69 mid, < 40 low', () => {
    expect(cellTone(88)).toBe('high');
    expect(cellTone(70)).toBe('high');
    expect(cellTone(69)).toBe('mid');
    expect(cellTone(40)).toBe('mid');
    expect(cellTone(39)).toBe('low');
  });
});
