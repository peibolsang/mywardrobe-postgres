// middleware.ts (App root)
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const OWNER_EMAIL = (process.env.EDITOR_OWNER_EMAIL)?.toLowerCase();

export default auth((req) => {
  const { nextUrl } = req;
  const email = req.auth?.user?.email?.toLowerCase();

  if (nextUrl.pathname.startsWith("/garments")) {
    if (!email) {
      const url = new URL("/login", nextUrl);
      return NextResponse.redirect(url);
    }
  }

  // Guard owner-only editor subtree
  if (nextUrl.pathname.startsWith("/editor")) {
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
  matcher: ["/editor/:path*", "/garments/:path*"],
};
