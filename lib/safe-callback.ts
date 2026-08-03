const CALLBACK_BASE = "https://purehub.callback.invalid";

function fullyDecoded(value: string): string | null {
  let decoded = value;
  for (let pass = 0; pass < 10; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  return null;
}

export function safeCallbackPath(value: unknown, fallback = "/"): string {
  const safeFallback = typeof fallback === "string"
    && fallback.startsWith("/")
    && !fallback.startsWith("//")
    && !fallback.includes("\\")
    ? fallback
    : "/";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return safeFallback;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return safeFallback;

  const decoded = fullyDecoded(value);
  if (!decoded || !decoded.startsWith("/") || decoded.startsWith("//")) return safeFallback;
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return safeFallback;

  try {
    const parsed = new URL(value, CALLBACK_BASE);
    if (parsed.origin !== CALLBACK_BASE || parsed.username || parsed.password) return safeFallback;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return safeFallback;
  }
}
