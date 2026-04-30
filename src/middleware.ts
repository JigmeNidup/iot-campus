import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname, search, origin } = req.nextUrl;
  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/editor") ||
    pathname.startsWith("/operator");

  if (!isProtected) return NextResponse.next();

  if (!req.auth) {
    const loginUrl = new URL("/login", origin);
    const callbackUrl = pathname + (search || "");
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  const role = req.auth.user?.role;
  const isOperatorRoute = pathname.startsWith("/operator");
  const isDashboardOrEditor =
    pathname.startsWith("/dashboard") || pathname.startsWith("/editor");

  if (role === "operator" && isDashboardOrEditor) {
    return NextResponse.redirect(new URL("/operator", origin));
  }

  if (role !== "operator" && isOperatorRoute) {
    return NextResponse.redirect(new URL("/dashboard", origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/editor/:path*", "/operator/:path*"],
};
