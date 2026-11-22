const cents = (kg: number) => Math.round(kg * 100);

export function remainingWeight(allowance: number, expected: number): number {
  return (cents(allowance) - cents(expected)) / 100;
}

export function potentialMatch(balanceA: number, balanceB: number) {
  const a = cents(balanceA);
  const b = cents(balanceB);
  if (!((a < 0 && b > 0) || (a > 0 && b < 0))) return null;
  const excess = -Math.min(a, b);
  const available = Math.max(a, b);
  return {
    excess: excess / 100,
    available: available / 100,
    potentialWeight: Math.min(excess, available) / 100,
    remainingExcess: Math.max(0, excess - available) / 100,
    status: 'POTENTIAL' as const,
  };
}

export const matchDisclaimer = "Potential weight match found. Please verify the airline's baggage rules before making arrangements.";