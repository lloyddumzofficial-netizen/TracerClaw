import { describe, expect, it } from 'vitest';
import { verifyPaidAmount } from '@/server/payments/verifyPaidAmount';

describe('paid webhook amount verification', () => {
  const checkout = { amount: 14000, currency: 'PHP' };

  it('accepts the exact provider amount and currency', () => {
    expect(() => verifyPaidAmount(checkout, 14000, 'php')).not.toThrow();
  });

  it.each([
    [null, 'PHP'],
    [0, 'PHP'],
    [13900, 'PHP'],
    [14000, null],
    [14000, 'USD'],
    [14000.5, 'PHP'],
  ])('rejects amount %s and currency %s', (amount, currency) => {
    expect(() => verifyPaidAmount(checkout, amount, currency)).toThrow(/does not match/);
  });
});
