import { Outfit } from "next/font/google";
import { ToastContainer } from "@/components/Toast";
import MobileWarning from "./components/MobileWarning";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], display: "swap" });

export const metadata = {
  title: "DESAYNBRO Auto-Tracer",
  description: "Automated AI vector tracing tool for apparel designers",
};

import MaintenanceScreen from "./components/MaintenanceScreen";
import GlobalMobileSync from "@/components/GlobalMobileSync";

const isMaintenance = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === 'true'; // Emergency maintenance mode

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={outfit.className}>
        {isMaintenance ? (
          <MaintenanceScreen />
        ) : (
          <>
            <MobileWarning />
            <GlobalMobileSync />
            {children}
          </>
        )}
        <ToastContainer />
      </body>
    </html>
  );
}
