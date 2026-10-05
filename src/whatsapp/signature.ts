import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/** Verifica el encabezado X-Hub-Signature-256 que Meta firma con el App Secret. */
export function isValidSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith(PREFIX)) return false;
  const received = header.slice(PREFIX.length);
  if (!HEX_SHA256.test(received)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(received, "hex"));
}
