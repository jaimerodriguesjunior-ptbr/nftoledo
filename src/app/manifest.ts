import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NF Fácil",
    short_name: "NF Fácil",
    description: "Emissor de notas fiscais de serviço",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#06256f",
    theme_color: "#0a51cb",
    lang: "pt-BR",
    icons: [
      {
        src: "/notafacil.png",
        sizes: "1280x1280",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
