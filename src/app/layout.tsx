import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lluvia — San Rafael",
  description: "Consulta de lluvia local y exposición durante recorridos.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}

