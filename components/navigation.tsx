"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../lib/utils";
import { useState, useEffect } from "react";

const links = [
  { href: "/viewer", label: "My Wardrobe" },
  { href: "/editor", label: "Wardrobe Editor" },
  { href: "/stats", label: "Wardrobe Stats" },
];

export function Navigation() {
  const pathname = usePathname() || '';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <nav className="flex justify-center my-8">
      <ul className="flex items-center space-x-4">
        {links.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} passHref>
              <span
                className={cn(
                  "px-4 py-2 text-lg font-medium transition-colors relative",
                  mounted && (pathname === href || (href === "/viewer" && pathname.startsWith("/garments")))
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
    </nav>
  );
}