"use client";

import { usePathname } from "next/navigation";
import DesktopRequiredNotice from "./DesktopRequiredNotice";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";

export default function MobileWarning() {
  const pathname = usePathname();
  const isMobileDevice = useIsMobileDevice();

  if (!isMobileDevice) return null;

  const desktopOnlyRoutes = ["/workspace", "/bg-remover", "/upscale"];
  const requiresDesktop = desktopOnlyRoutes.some((route) => (
    pathname === route || pathname.startsWith(`${route}/`)
  ));

  if (!requiresDesktop) return null;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 999999,
      background: "#161616"
    }}>
      <DesktopRequiredNotice />
    </div>
  );
}
