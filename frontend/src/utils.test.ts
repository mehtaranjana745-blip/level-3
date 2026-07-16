import { describe, test, expect } from 'vitest';
import { validateAmount, formatAddress, calculateMockRewards, isValidContractId } from './utils';

describe('Utility Functions Tests', () => {
  test('validateAmount validates positive numbers correctly', () => {
    expect(validateAmount('10')).toBe(true);
    expect(validateAmount('-5')).toBe(false);
    expect(validateAmount('abc')).toBe(false);
  });

  test('formatAddress truncates address properly', () => {
    expect(formatAddress('GDXKETAZIUWTNK7NP5VKR2JVXWUQDTRVG46YQDUBLFCL24UTR5PVAEPL')).toBe('GDXK...AEPL');
    expect(formatAddress('abc')).toBe('abc');
  });

  test('calculateMockRewards calculates correct rewards', () => {
    expect(calculateMockRewards(100, 10)).toBe(1000);
    expect(calculateMockRewards(0, 50)).toBe(0);
  });

  test('isValidContractId checks contract ID structure', () => {
    expect(isValidContractId('CADERYULZE76K23VX36Y4ZK53O7E6I2AE6MXHLNMSQ5XCEVX3DJPFWN2')).toBe(true);
    expect(isValidContractId('invalid_id')).toBe(false);
  });
});
