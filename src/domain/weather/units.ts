export function percentageToProbability(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError("El porcentaje debe estar entre 0 y 100");
  }
  return percent / 100;
}

export function amountToMeanRate(amountMm: number, periodMinutes: number): number {
  if (!Number.isFinite(amountMm) || amountMm < 0 ||
      !Number.isFinite(periodMinutes) || periodMinutes <= 0) {
    throw new RangeError("Se requieren acumulación no negativa y periodo positivo");
  }
  return amountMm * 60 / periodMinutes;
}

