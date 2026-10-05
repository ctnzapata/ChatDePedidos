import { createHash, timingSafeEqual } from "node:crypto";

/** Compara secretos en tiempo constante (también cuando tienen longitudes distintas). */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

export interface Credentials {
  readonly user: string;
  readonly password: string;
}

export function parseBasicAuth(header: string | undefined): Credentials | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export function isAuthorized(header: string | undefined, expected: Credentials): boolean {
  const received = parseBasicAuth(header);
  if (!received) return false;
  // Evaluar ambas comparaciones siempre para no filtrar cuál de las dos falló.
  const userOk = safeEqual(received.user, expected.user);
  const passwordOk = safeEqual(received.password, expected.password);
  return userOk && passwordOk;
}
