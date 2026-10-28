import { NextResponse } from "next/server";
import { isMaintenanceEnabled, isMaintenancePage, isPausedGeneration, MAINTENANCE_MESSAGE } from "./lib/maintenance";
import { maintenancePageHtml } from "./lib/maintenancePage";

export function proxy(request) {
  if (!isMaintenanceEnabled()) return NextResponse.next();
  const { pathname } = request.nextUrl;
  const headers = { "Cache-Control": "no-store, max-age=0", "Retry-After": "300" };
  if (isPausedGeneration(pathname, request.method)) {
    return NextResponse.json({ error: MAINTENANCE_MESSAGE, code: "AI_MAINTENANCE", maintenance: true }, { status: 503, headers });
  }
  if (isMaintenancePage(pathname)) {
    return new NextResponse(maintenancePageHtml(), {
      status: 503,
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/workspace/:path*", "/upscale/:path*", "/bg-remover/:path*", "/mockup-studio/:path*", "/mobile/:path*", "/api/:path*"],
};
