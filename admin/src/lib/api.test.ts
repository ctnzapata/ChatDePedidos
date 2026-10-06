import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "./api";

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("returns the data of a successful envelope and sends the bearer token", async () => {
    const fetchMock = mockFetch(200, { success: true, data: { ok: 1 }, error: null });

    const data = await apiRequest<{ ok: number }>("/me", { token: "abc" });

    expect(data).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/me");
    expect(init.headers).toMatchObject({ Authorization: "Bearer abc" });
  });

  it("sends JSON bodies", async () => {
    const fetchMock = mockFetch(200, { success: true, data: null, error: null });

    await apiRequest("/x", { token: "t", method: "POST", body: { a: 1 } });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("throws the server's message with the status", async () => {
    mockFetch(403, { success: false, data: null, error: "Tu rol no tiene permiso para esta acción." });

    const error = await apiRequest("/x", { token: "t" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Tu rol no tiene permiso para esta acción.", status: 403 });
  });

  it("throws a friendly error when the response is not JSON", async () => {
    mockFetch(502, "<html>Bad gateway</html>");

    await expect(apiRequest("/x", { token: "t" })).rejects.toMatchObject({ status: 502 });
  });
});
