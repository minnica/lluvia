import { describe, expect, it } from "vitest";
import { formatCoordinates, parseCoordinates } from "@/domain/routing/coordinates";

describe("coordenadas del recorrido", () => {
  it("interpreta latitud y longitud en ese orden, con precisión completa", () => {
    const point = { lat: 19.20487325043874, lon: -98.87037416564777 };
    expect(parseCoordinates("19.20487325043874, -98.87037416564777")).toEqual(point);
    expect(parseCoordinates(formatCoordinates(point))).toEqual(point);
  });

  it("rechaza valores incompletos, adicionales o fuera de rango", () => {
    for (const value of ["", "19.2", "19.2,", "19.2, -98.8, 5", "91, -98", "19, -181", "19; -98", "19, abc"]) {
      expect(parseCoordinates(value)).toBeNull();
    }
  });
});
