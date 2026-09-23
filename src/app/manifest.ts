import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "Lluvia · San Rafael", short_name: "Lluvia", description: "Consulta local de lluvia para decidir antes de salir.",
    start_url: "/", scope: "/", display: "standalone", background_color: "#0a0a0a", theme_color: "#0a0a0a",
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
}
