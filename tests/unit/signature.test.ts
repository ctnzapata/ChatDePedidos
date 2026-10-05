import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidSignature } from "../../src/whatsapp/signature.ts";

const SECRET = "test-app-secret";
const body = Buffer.from(JSON.stringify({ hello: "world" }));
const sign = (payload: Buffer, secret = SECRET): string =>
  `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

describe("isValidSignature", () => {
  it("accepts a correct X-Hub-Signature-256 header", () => {
    expect(isValidSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a signature made with another secret", () => {
    expect(isValidSignature(body, sign(body, "other"), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(isValidSignature(Buffer.from("{}"), sign(body), SECRET)).toBe(false);
  });

  it.each([undefined, "", "sha256=", "md5=abc", "sha256=zz"])("rejects malformed header %s", (header) => {
    expect(isValidSignature(body, header, SECRET)).toBe(false);
  });
});
