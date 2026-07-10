export type Probability = number & { readonly __brand: "Probability" };

export function probability(value: number): Probability {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Probability must be finite and between 0 and 1; received ${value}`);
  }
  return value as Probability;
}

export function txLinePctToProbability(value: string): Probability | null {
  if (value === "NA") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new RangeError(`TXLine Pct must be NA or a number between 0 and 100; received ${value}`);
  }
  return probability(parsed / 100);
}

export function decimalLineToMilli(value: string | number): number {
  const text = String(value).trim();
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(text)) {
    throw new RangeError(`Market line must have at most three decimal places; received ${text}`);
  }
  const [wholeText = "", fractionText = ""] = text.split(".");
  const sign = wholeText.startsWith("-") ? -1 : 1;
  const whole = Math.abs(Number(wholeText));
  const fraction = Number(fractionText.padEnd(3, "0"));
  return sign * (whole * 1_000 + fraction);
}
