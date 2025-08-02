"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSession, signOut } from "next-auth/react";

const links = [
  { href: "/viewer", label: "My Wardrobe" },
  { href: "/editor", label: "Wardrobe Editor" },
  { href: "/stats", label: "Wardrobe Stats" },
];

export function Navigation() {
  const pathname = usePathname() || "";
  const { data: session, status } = useSession();

  // Friendly fallback if name is null on first magic-link login
  const rawName =
    session?.user?.name ?? session?.user?.email?.split("@")[0] ?? undefined;
  const displayName = rawName?.split(" ")[0];

  return (
    <nav className="flex justify-between items-center my-8 w-full">
      <div className="flex-grow flex justify-center">
        <ul className="flex items-center space-x-4">
          {links.map(({ href, label }) => (
            <li key={href}>
              <Link href={href} passHref>
                <span
                  className={cn(
                    "px-4 py-2 text-lg font-medium transition-colors relative",
                    pathname === href ||
                      (href === "/viewer" && pathname.startsWith("/garments"))
                      ? "text-primary after:content-[''] after:absolute after:left-0 after:bottom-[-2px] after:w-full after:h-[2px] after:bg-primary"
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div>
        {status === "authenticated" ? (
          <button
            onClick={() => signOut()}
            className="px-4 py-2 text-lg font-medium transition-colors text-muted-foreground hover:text-primary"
          >
            {`Sign Out${displayName ? ` (${displayName})` : ""}`}
          </button>
        ) : status === "loading" ? (
          <span className="px-4 py-2 text-lg font-medium text-muted-foreground">
            …
          </span>
        ) : (
          <Link href="/login">
            <span className="px-4 py-2 text-lg font-medium transition-colors text-muted-foreground hover:text-primary">
              Sign In
            </span>
          </Link>
        )}
      </div>
    </nav>
  );
}
