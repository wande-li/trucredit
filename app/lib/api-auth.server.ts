/**
 * Shared API authentication for public endpoints
 * Fail-closed: if API_SECRET is not configured, all requests are rejected
 */

const AUTH_HEADER = "x-api-key";

/**
 * Verify an incoming API key against the configured TRUCREDIT_API_SECRET.
 * Returns true only when the secret is configured AND matches the request.
 * Fail-closed: missing env = all requests rejected.
 */
export function verifyApiKey(request: Request): boolean {
  const secret = process.env.TRUCREDIT_API_SECRET;
  if (!secret) return false; // Fail-closed

  const authHeader = request.headers.get(AUTH_HEADER);
  if (!authHeader) return false;

  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(authHeader, secret);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
