import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Flight Share — Airport rides and same-flight baggage matches", template: "%s | Flight Share" },
  description: "Offer or request cab seats to your departure airport, or explore potential baggage allowance matches with travellers on your exact flight.",
  applicationName: "Flight Share",
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content', themeColor: '#f8fbff' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-IN" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}