// Provider amounts and checkout amounts are both in minor currency units.
// Never substitute the expected checkout price for missing provider evidence.
export function verifyPaidAmount(localPayment, paidAmount, paidCurrency) {
  const expectedCurrency = String(localPayment?.currency || '').toUpperCase();
  const actualCurrency = String(paidCurrency || '').toUpperCase();
  if (!Number.isSafeInteger(localPayment?.amount) || localPayment.amount <= 0 ||
      !Number.isSafeInteger(paidAmount) || paidAmount !== localPayment.amount ||
      !expectedCurrency || actualCurrency !== expectedCurrency) {
    throw new Error('Provider payment amount or currency does not match the checkout');
  }
}
