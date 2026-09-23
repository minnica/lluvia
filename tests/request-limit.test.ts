import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { checkRequestLimit, limitedResponse } from "@/server/request-limit";

describe("resguardo de ráfagas por instancia", () => {
  it("devuelve 429 con espera, separa clientes y libera la ventana", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
    try {
      const one = new Request("https://localhost/api/weather", { headers: { "x-vercel-forwarded-for": "192.0.2.1" } });
      const other = new Request("https://localhost/api/weather", { headers: { "x-vercel-forwarded-for": "192.0.2.2" } });
      expect(checkRequestLimit(one, "test-weather", 2)).toBeNull();
      expect(checkRequestLimit(one, "test-weather", 2)).toBeNull();
      const retry = checkRequestLimit(one, "test-weather", 2);
      expect(retry).toBe(60);
      const response = limitedResponse(retry!);
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect((await response.json()).code).toBe("quota");
      expect(checkRequestLimit(other, "test-weather", 2)).toBeNull();
      vi.advanceTimersByTime(60_000);
      expect(checkRequestLimit(one, "test-weather", 2)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
