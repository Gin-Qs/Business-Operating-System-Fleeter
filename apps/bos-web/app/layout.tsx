import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fleeter BOS | Portal privado",
  description: "Portal privado del Business Operating System de Fleeter."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>
        <a className="skip-link" href="#main-content">
          Ir al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
