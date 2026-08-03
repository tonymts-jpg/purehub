import { safeCallbackPath } from "@/lib/safe-callback";

export function redirectToAccountSignIn(pathname: string, search: string) {
  const callback = safeCallbackPath(`${pathname}${search.startsWith("?") ? search : ""}`);
  window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent(callback)}`);
}
