import type { Metadata } from "next";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "NF Fácil - Emissor de NFS-e",
  description: "Sistema de emissão de notas fiscais de serviço",
  manifest: "/manifest.webmanifest",
  applicationName: "NF Fácil",
  appleWebApp: {
    capable: true,
    title: "NF Fácil",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/notafacil.png",
    apple: "/notafacil.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased bg-gray-50 text-gray-900">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
