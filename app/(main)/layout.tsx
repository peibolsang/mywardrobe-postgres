import type { Metadata } from "next";
import "../globals.css";
import { Navigation } from "@/components/navigation";
import Provider from "@/components/client/session-provider";
import * as Auth from "@/lib/auth";

export const metadata: Metadata = {
  title: "My Wardrobe",
  description: "Manage your personal wardrobe with ease.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await Auth.auth();
  console.log("SESSION ON SERVER:", session);
  return (
    <Provider session={session}>
      <Navigation />
      <main>{children}</main>
    </Provider>
  );
}
