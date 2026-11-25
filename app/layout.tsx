import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./mobile.css";
import "./market-theme.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0f0d",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: "Fourth & Ten — The Thursday Club",
  description: "The Dynasty league’s Thursday lunch market. Ten upvotes, five downvotes, one configurable group parlay. The spreadsheet has retired.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
