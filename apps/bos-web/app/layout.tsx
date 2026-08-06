import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fleeter BOS | Acceso",
  description: "Portal de acceso al Business Operating System de Fleeter."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
