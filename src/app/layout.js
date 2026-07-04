import "./globals.css";

export const metadata = {
  title: "DESAYNBRO Auto-Tracer",
  description: "Automated AI vector tracing tool for apparel designers",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
