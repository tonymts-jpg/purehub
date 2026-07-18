import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const cookie = request.cookies.get("purehub.session_token") ?? request.cookies.get("__Secure-purehub.session_token");
  if (cookie) return NextResponse.next();
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(signIn);
}

export const config = { matcher: ["/admin/:path*", "/dashboard/:path*", "/library/:path*", "/notifications/:path*"] };
