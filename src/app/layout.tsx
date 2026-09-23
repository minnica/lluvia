import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lluvia — San Rafael",
  description: "Consulta de lluvia local y exposición durante recorridos.",
  appleWebApp: { capable: true, title: "Lluvia", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport = { themeColor: "#155f57", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
