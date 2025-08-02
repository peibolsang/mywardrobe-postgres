import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Wardrobe",
  description: "Manage your personal wardrobe with ease.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
