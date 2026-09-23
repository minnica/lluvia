import { z } from "zod";

export const runtime = "nodejs";

const responseSchema = z.object({ results: z.array(z.object({
  position: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  address: z.object({ freeformAddress: z.string().optional() }).optional(),
})) });

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3 || q.length > 100) return Response.json({ error: "Escribe entre 3 y 100 caracteres" }, { status: 400 });
  const key = process.env.TOMTOM_API_KEY;
  if (!key) return Response.json({ error: "Falta configurar TOMTOM_API_KEY para buscar direcciones" }, { status: 503 });
  const url = new URL(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(q)}.json`);
  url.searchParams.set("key", key);
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrySet", "MX");
  url.searchParams.set("language", "es-MX");
  try {
    const response = await fetch(url, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]), cache: "no-store" });
    if (!response.ok) return Response.json({ error: response.status === 429 ? "Cuota de búsqueda agotada" : "No se pudo buscar la dirección" },
      { status: response.status === 429 ? 429 : 502 });
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return Response.json({ error: "Respuesta de búsqueda inválida" }, { status: 502 });
    return Response.json({ results: parsed.data.results.map((item) => ({
      label: item.address?.freeformAddress ?? `${item.position.lat}, ${item.position.lon}`,
      point: item.position,
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Búsqueda no disponible" }, { status: 502 });
  }
}
