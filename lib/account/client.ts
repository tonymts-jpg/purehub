function safeCallback(pathname: string, search: string): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return "/";
  return `${pathname}${search.startsWith("?") ? search : ""}`;
}

export function redirectToAccountSignIn(pathname: string, search: string) {
  window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent(safeCallback(pathname, search))}`);
}
