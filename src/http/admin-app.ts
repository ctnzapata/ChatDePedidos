import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export interface AdminAppOptions {
  /** Carpeta con el build del panel (admin/dist). */
  readonly rootDir: string;
  /** Origen de Supabase al que el panel puede conectarse (Auth y Realtime). */
  readonly supabaseUrl: string;
}

const ASSET_CACHE = "public, max-age=31536000, immutable";

/** CSP del panel: solo scripts propios y conexiones al propio servidor y a Supabase. */
export function adminContentSecurityPolicy(supabaseUrl: string): string {
  const origin = new URL(supabaseUrl).origin;
  const websocket = origin.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Los componentes Radix posicionan menús con estilos en línea.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${origin} ${websocket}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function hasAdminBuild(rootDir: string): boolean {
  return existsSync(path.join(rootDir, "index.html"));
}

/** Sirve el panel (SPA) bajo el prefijo con el que se registre (/admin). */
export async function adminAppRoutes(app: FastifyInstance, options: AdminAppOptions): Promise<void> {
  const securityHeaders = {
    "content-security-policy": adminContentSecurityPolicy(options.supabaseUrl),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
  app.addHook("onSend", async (_request, reply) => {
    reply.headers(securityHeaders);
  });

  await app.register(fastifyStatic, {
    root: options.rootDir,
    prefix: "/",
    setHeaders(reply, filePath) {
      reply.header("cache-control", filePath.endsWith(".html") ? "no-cache" : ASSET_CACHE);
    },
  });

  // Rutas del panel (/admin/pedidos…) que no son archivos: las resuelve React Router.
  app.setNotFoundHandler((_request, reply) => reply.header("cache-control", "no-cache").sendFile("index.html"));
}
