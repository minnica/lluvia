import { getRoute, readRouteInput, routeError } from "@/server/routes/service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readRouteInput(request);
    const { response } = await getRoute(input, AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]));
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return routeError(error); }
}
