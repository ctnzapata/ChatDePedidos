import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer, type AppServer } from "../../src/http/server.ts";
import { ConversationRepository } from "../../src/repositories/conversation-repository.ts";
import { OrderRepository } from "../../src/repositories/order-repository.ts";
import { RestaurantRepository } from "../../src/repositories/restaurant-repository.ts";
import { PanelService } from "../../src/services/panel-service.ts";
import { testPrisma } from "../fixtures/db.ts";
import { FakeMessenger } from "../fixtures/fake-messenger.ts";

const restaurants = new RestaurantRepository(testPrisma);
const publicConfig = { supabaseUrl: "https://demo.supabase.co", supabasePublishableKey: "sb_publishable_demo" };
let adminAppDir: string;
let server: AppServer;

beforeAll(() => {
  // Build falso del panel: un index.html y un recurso con hash.
  adminAppDir = mkdtempSync(path.join(tmpdir(), "panel-"));
  writeFileSync(path.join(adminAppDir, "index.html"), "<!doctype html><title>Panel de pedidos</title>");
  mkdirSync(path.join(adminAppDir, "assets"));
  writeFileSync(path.join(adminAppDir, "assets", "app-123.js"), "console.info('panel')");
});

async function start(withPanel: boolean): Promise<AppServer> {
  return buildServer({
    config: { whatsappAppSecret: "s", whatsappVerifyToken: "verify-token-123", panelUser: "admin", panelPassword: "clave-del-panel" },
    processor: { handle: async () => undefined },
    panel: new PanelService({
      restaurants,
      conversations: new ConversationRepository(testPrisma),
      orders: new OrderRepository(testPrisma),
      messenger: new FakeMessenger(),
    }),
    restaurants,
    publicConfig,
    ...(withPanel ? { adminAppDir } : {}),
  });
}

afterEach(async () => {
  await server.close();
});

describe("panel administrativo (frontend)", () => {
  it("exposes only public configuration", async () => {
    server = await start(true);

    const response = await server.inject({ method: "GET", url: "/api/public-config" });

    expect(response.json()).toEqual(publicConfig);
  });

  it("redirects /admin to /admin/", async () => {
    server = await start(true);

    const response = await server.inject({ method: "GET", url: "/admin" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/admin/");
  });

  it("serves index.html for any panel route (SPA) with a strict CSP", async () => {
    server = await start(true);

    const root = await server.inject({ method: "GET", url: "/admin/" });
    const deepLink = await server.inject({ method: "GET", url: "/admin/pedidos" });

    expect(root.body).toContain("Panel de pedidos");
    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.body).toContain("Panel de pedidos");
    const csp = String(deepLink.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' https://demo.supabase.co wss://demo.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(deepLink.headers["cache-control"]).toBe("no-cache");
  });

  it("serves hashed assets with long-lived caching", async () => {
    server = await start(true);

    const response = await server.inject({ method: "GET", url: "/admin/assets/app-123.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  it("does not serve the panel when there is no build", async () => {
    server = await start(false);

    expect((await server.inject({ method: "GET", url: "/admin/" })).statusCode).toBe(404);
  });
});
