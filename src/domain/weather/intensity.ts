/** Umbrales de lluvia de la OMM (Guía de instrumentos, I.14-7), aplicados como media horaria orientativa.
 * La guía original usa observaciones de tres minutos; esto no predice picos ni tipo de precipitación. */
export function describeHourlyRain(amountMm: number | null, probability: number | null): string {
  if (amountMm === null) return probability !== null && probability >= 0.5 ? "Lluvia posible" : "Sin dato";
  if (amountMm === 0) return probability !== null && probability >= 0.5 ? "Lluvia posible" : "Sin lluvia prevista";
  if (amountMm < 2.5) return "Lluvia ligera";
  if (amountMm < 10) return "Lluvia moderada";
  if (amountMm < 50) return "Lluvia fuerte";
  return "Lluvia muy intensa";
}
