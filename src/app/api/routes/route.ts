import { getRoute, readRouteInput, routeError } from "@/server/routes/service";
import { recordOperation } from "@/server/operation";
import { RoutingFailure } from "@/server/providers/routing/tomtom";
import { checkRequestLimit, limitedResponse } from "@/server/request-limit";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const retryAfter = checkRequestLimit(request, "routes", 12);
  if (retryAfter !== null) {
    recordOperation("routes", startedAt, "error", { code: "local-rate-limit" });
    return limitedResponse(retryAfter);
  }
  try {
    const input = await readRouteInput(request);
    const { response } = await getRoute(input, AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]));
    recordOperation("routes", startedAt, "ok", { maxProviderCalls: 1 });
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    recordOperation("routes", startedAt, "error", { code: error instanceof RoutingFailure ? error.code : "unexpected" });
    return routeError(error);
  }
}
