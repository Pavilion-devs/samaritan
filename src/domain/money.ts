export const USD_MICRO_UNITS = 1_000_000;

export type MicroUsd = number & { readonly __brand: "MicroUsd" };

export function microUsd(value: number): MicroUsd {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be represented as safe integer USD micro-units; received ${value}`);
  }
  return value as MicroUsd;
}

export function nonnegativeMicroUsd(value: number): MicroUsd {
  const amount = microUsd(value);
  if (amount < 0) throw new RangeError(`Money amount must be non-negative; received ${value}`);
  return amount;
}
