import { describe, expect, it } from "vitest";
import { describeHourlyRain } from "@/domain/weather/intensity";

describe("descripción horaria de lluvia", () => {
  it("distingue falta de datos, ausencia prevista y posibilidad sin acumulación", () => {
    expect(describeHourlyRain(null, null)).toBe("Sin dato");
    expect(describeHourlyRain(0, 0.1)).toBe("Sin lluvia prevista");
    expect(describeHourlyRain(0, 0.6)).toBe("Lluvia posible");
    expect(describeHourlyRain(null, 0.6)).toBe("Lluvia posible");
  });

  it("clasifica los límites de intensidad por media horaria", () => {
    expect(describeHourlyRain(0.1, 0.2)).toBe("Lluvia ligera");
    expect(describeHourlyRain(2.49, 0.8)).toBe("Lluvia ligera");
    expect(describeHourlyRain(2.5, 0.8)).toBe("Lluvia moderada");
    expect(describeHourlyRain(10, 0.8)).toBe("Lluvia fuerte");
    expect(describeHourlyRain(50, 0.8)).toBe("Lluvia muy intensa");
  });
});
