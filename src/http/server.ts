import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError } from "fastify";
import { logger as defaultLogger, type Logger } from "../lib/logger.ts";
import type { RestaurantRepository } from "../repositories/restaurant-repository.ts";
import type { PanelService } from "../services/panel-service.ts";
import { adminAppRoutes, hasAdminBuild } from "./admin-app.ts";
import { adminRoutes, type AdminRoutesOptions } from "./admin-routes.ts";
import { panelRoutes } from "./panel-routes.ts";
import { webhookRoutes, type MessageHandler } from "./webhook-routes.ts";

export interface ServerDeps {
  readonly config: {
    readonly whatsappAppSecret: string;
    readonly whatsappVerifyToken: string;
    readonly panelUser: string;
    readonly panelPassword: string;
  };
  readonly processor: MessageHandler;
  readonly panel: PanelService;
  readonly restaurants: RestaurantRepository;
  /** API del panel administrativo con Supabase Auth (si se omite, no se registra). */
  readonly admin?: AdminRoutesOptions;
  /** Valores públicos para el panel (nunca la llave secreta). */
  readonly publicConfig?: { readonly supabaseUrl: string; readonly supabasePublishableKey: string };
  /** Carpeta con el build del panel (admin/dist); se sirve en /admin si existe. */
  readonly adminAppDir?: string;
  readonly logger?: Logger;
}

const BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };
const TRUSTED_PROXY = "loopback";

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({
    loggerInstance: deps.logger ?? defaultLogger,
    bodyLimit: BODY_LIMIT_BYTES,
    // Solo se confía en el túnel que corre en esta máquina (cloudflared/ngrok): la IP del cliente es la
    // última que él agrega a X-Forwarded-For. Con `true` cualquiera podría falsearla y saltarse el límite.
    trustProxy: TRUSTED_PROXY,
    // El log por defecto incluye la query string, y en /webhook ahí viaja el verify token.
    disableRequestLogging: true,
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      { method: request.method, route: request.routeOptions.url ?? "desconocida", status: reply.statusCode, ms: Math.round(reply.elapsedTime) },
      "Petición atendida",
    );
  });

  await app.register(rateLimit, DEFAULT_RATE_LIMIT);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error.message }, "Error en la petición");
    // No exponer detalles internos al cliente.
    return reply.code(status).send({ success: false, data: null, error: status >= 500 ? "Error interno" : error.message });
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(webhookRoutes, {
    appSecret: deps.config.whatsappAppSecret,
    verifyToken: deps.config.whatsappVerifyToken,
    processor: deps.processor,
  });

  await app.register(panelRoutes, {
    credentials: { user: deps.config.panelUser, password: deps.config.panelPassword },
    panel: deps.panel,
    restaurants: deps.restaurants,
  });

  if (deps.admin) await app.register(adminRoutes, { ...deps.admin, prefix: "/api/admin" });

  const { publicConfig, adminAppDir } = deps;
  if (publicConfig) {
    app.get("/api/public-config", async () => ({
      supabaseUrl: publicConfig.supabaseUrl,
      supabasePublishableKey: publicConfig.supabasePublishableKey,
    }));
    if (adminAppDir && hasAdminBuild(adminAppDir)) {
      app.get("/admin", async (_request, reply) => reply.redirect("/admin/"));
      await app.register(adminAppRoutes, { rootDir: adminAppDir, supabaseUrl: publicConfig.supabaseUrl, prefix: "/admin" });
    }
  }

  return app;
}

export type AppServer = Awaited<ReturnType<typeof buildServer>>;
