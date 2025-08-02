// middleware.ts (App root)
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const OWNER_EMAIL = (process.env.EDITOR_OWNER_EMAIL)?.toLowerCase();

export default auth((req) => {
  const { nextUrl } = req;

  // Only guard the /editor subtree
  if (nextUrl.pathname.startsWith("/editor")) {
    const email = req.auth?.user?.email?.toLowerCase();
    if (!email) {
      const url = new URL("/login", nextUrl);
      return NextResponse.redirect(url);
    }
    if (email !== OWNER_EMAIL) {
      const url = new URL("/", nextUrl);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/editor/:path*"],
};
