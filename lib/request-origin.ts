import "server-only";

export const isAllowedOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;

  // Non-browser/server-to-server requests may omit Origin.
  if (!origin) return true;
  return origin === requestOrigin;
};
