import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_GROUPS,
  ACCOUNT_TYPES,
  accountGroupColor,
  accountGroupLabel,
  accountTypeGroup,
  accountTypeLabel,
} from './index';

describe('account taxonomy', () => {
  it('keeps every account type mapped to an existing group', () => {
    const groups = new Set(ACCOUNT_GROUPS.map((group) => group.value));

    for (const accountType of ACCOUNT_TYPES) {
      expect(groups.has(accountType.group)).toBe(true);
      expect(accountTypeLabel(accountType.value)).toBe(accountType.label);
      expect(accountTypeGroup(accountType.value)).toBe(accountType.group);
    }
  });

  it('returns stable fallbacks for unknown groups', () => {
    expect(accountGroupLabel('missing')).toBe('missing');
    expect(accountGroupColor('missing')).toBe('#64748b');
  });

  it('classifies liabilities separately from assets', () => {
    expect(accountTypeGroup('credit')).toBe('liabilities');
    expect(accountTypeGroup('loan')).toBe('liabilities');
    expect(accountTypeGroup('checking')).toBe('cash');
  });
});
