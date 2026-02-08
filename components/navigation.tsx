"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSession, signOut } from "next-auth/react";

import { Shirt, BarChart3, LogOut, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const links = [
  {
    href: "/viewer",
    label: "My Wardrobe",
    icon: Shirt,
    description: "Browse your collection",
  },
  {
    href: "/stats",
    label: "Wardrobe Stats",
    icon: BarChart3,
    description: "View analytics",
  },
]


export function Navigation() {
  const pathname = usePathname() || ""
  const sessionResult = useSession()
  const session = sessionResult?.data || null
  const status = sessionResult?.status || "loading"

  // Friendly fallback if name is null on first magic-link login
  const rawName = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? undefined
  const displayName = rawName?.split(" ")[0]
  const userInitials = rawName
    ? rawName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U"

   return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-8 w-full">
        {/* Logo/Brand */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-slate-800 to-slate-600 rounded-lg flex items-center justify-center">
              <Shirt className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
              MyWardrobe
            </span>
          </div>
        </div>


        {/* Navigation Links */}
        <div className="hidden md:flex items-center space-x-1">
          {links.map(({ href, label, icon: Icon, description }) => {
            const isActive = pathname === href || (href === "/viewer" && pathname.startsWith("/garments"))

            return (
              <Link key={href} href={href}>
                <div
                  className={cn(
                    "group relative flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 hover:bg-accent/50",
                   "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="font-medium">{label}</span>

                  {/* Active indicator */}
                  {isActive && <div className="absolute inset-x-0 -bottom-px h-0.5 bg-primary rounded-full" />}

                  {/* Tooltip on hover */}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    {description}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Shirt className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {links.map(({ href, label, icon: Icon }) => (
                <DropdownMenuItem key={href} asChild>
                  <Link href={href} className="flex items-center space-x-2">
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* User Section */}
        <div className="flex items-center space-x-2">
          {status === "authenticated" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                  <Avatar className="h-10 w-10 ring-2 ring-primary/20 transition-all hover:ring-primary/40">
                    <AvatarImage src={session?.user?.image || undefined} alt={displayName || "User"} />
                    <AvatarFallback className="bg-black text-white font-semibold">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{displayName || "User"}</p>
                    <p className="text-xs leading-none text-muted-foreground">{session?.user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-red-600 focus:text-red-600 cursor-pointer" onClick={() => signOut()}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : status === "loading" ? (
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
            </div>
          ) : (
            <Button asChild variant="default" size="sm" className="shadow-sm">
              <Link href="/login" className="flex items-center space-x-2">
                <LogIn className="w-4 h-4" />
                <span>Sign In</span>
              </Link>
            </Button>
          )}
        </div>
      </div>
    </nav>
  )
}
