import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { ORDER_STATUSES } from "../domain/order-status.ts";
import type { StoreProfile } from "../domain/store.ts";
import type { RestaurantRepository } from "../repositories/restaurant-repository.ts";
import type { PanelService } from "../services/panel-service.ts";
import { isAuthorized, type Credentials } from "./basic-auth.ts";
import { PANEL_HTML, PANEL_JS } from "./panel-page.ts";

export interface PanelRoutesOptions {
  readonly credentials: Credentials;
  readonly panel: PanelService;
  readonly restaurants: RestaurantRepository;
}

const PANEL_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };
const CSRF_HEADER = "x-requested-with";
const CSRF_VALUE = "panel";

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

// Los ids son uuid en Postgres: un formato inválido se rechaza aquí (400) antes de llegar a la base.
const restaurantParams = z.object({ restaurantId: z.uuid() });
const orderParams = restaurantParams.extend({ orderId: z.uuid() });
const conversationParams = restaurantParams.extend({ conversationId: z.uuid() });
const ordersQuery = z.object({ includeClosed: z.enum(["0", "1", "true", "false"]).optional() });
const statusBody = z.object({ status: z.enum(ORDER_STATUSES) });
const acceptingBody = z.object({ isAcceptingOrders: z.boolean() });
const availabilityBody = z.object({ code: z.string().min(1).max(20), isAvailable: z.boolean() });

function sendOk(reply: FastifyReply, data: unknown): FastifyReply {
  return reply.send({ success: true, data, error: null });
}

function sendError(reply: FastifyReply, status: number, error: string): FastifyReply {
  return reply.code(status).send({ success: false, data: null, error });
}

function parseOr400<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  sendError(reply, 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return null;
}

const TRANSITION_STATUS = { NOT_FOUND: 404, INVALID_TRANSITION: 409, CONFLICT: 409 } as const;

export async function panelRoutes(app: FastifyInstance, options: PanelRoutesOptions): Promise<void> {
  const { panel, restaurants, credentials } = options;

  // Límite más estricto que el global: frena intentos de adivinar la contraseña.
  // Alcanza para el sondeo del panel (2 peticiones cada 10 s) más las acciones del personal.
  app.addHook("onRoute", (route) => {
    route.config = { ...route.config, rateLimit: PANEL_RATE_LIMIT };
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.headers(SECURITY_HEADERS);
    if (!isAuthorized(request.headers.authorization, credentials)) {
      return reply
        .code(401)
        .header("www-authenticate", 'Basic realm="Panel del restaurante", charset="UTF-8"')
        .send("Autenticación requerida");
    }
    // Los navegadores no envían este encabezado en formularios de otros sitios: protege contra CSRF.
    if (request.method !== "GET" && request.headers[CSRF_HEADER] !== CSRF_VALUE) {
      return sendError(reply, 403, "Falta el encabezado X-Requested-With");
    }
  });

  async function storeOr404(restaurantId: string, reply: FastifyReply): Promise<StoreProfile | null> {
    const store = await restaurants.findById(restaurantId);
    if (!store) sendError(reply, 404, "Restaurante no encontrado");
    return store;
  }

  app.get("/panel", async (_request, reply) => reply.type("text/html; charset=utf-8").send(PANEL_HTML));
  app.get("/panel/app.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(PANEL_JS));

  app.get("/panel/api/restaurants", async (_request, reply) => {
    const list = await restaurants.listAll();
    return sendOk(reply, list.map(({ id, name, isAcceptingOrders }) => ({ id, name, isAcceptingOrders })));
  });

  app.get("/panel/api/restaurants/:restaurantId/orders", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    const query = params && parseOr400(ordersQuery, request.query, reply);
    if (!params || !query || !(await storeOr404(params.restaurantId, reply))) return reply;
    const includeClosed = query.includeClosed === "1" || query.includeClosed === "true";
    return sendOk(reply, await panel.listOrders(params.restaurantId, { includeClosed }));
  });

  app.post("/panel/api/restaurants/:restaurantId/orders/:orderId/status", async (request, reply) => {
    const params = parseOr400(orderParams, request.params, reply);
    const body = params && parseOr400(statusBody, request.body, reply);
    if (!params || !body) return reply;
    const result = await panel.updateOrderStatus(params.restaurantId, params.orderId, body.status);
    if (!result.ok) return sendError(reply, TRANSITION_STATUS[result.error.code], result.error.message);
    return sendOk(reply, result.value);
  });

  app.post("/panel/api/restaurants/:restaurantId/accepting", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    const body = params && parseOr400(acceptingBody, request.body, reply);
    if (!params || !body || !(await storeOr404(params.restaurantId, reply))) return reply;
    await panel.setAcceptingOrders(params.restaurantId, body.isAcceptingOrders);
    return sendOk(reply, { isAcceptingOrders: body.isAcceptingOrders });
  });

  app.get("/panel/api/restaurants/:restaurantId/menu", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    if (!params || !(await storeOr404(params.restaurantId, reply))) return reply;
    const catalog = await restaurants.loadCatalog(params.restaurantId);
    const extras = [...new Map(catalog.items.flatMap((i) => i.modifiers).map((m) => [m.code, m])).values()];
    return sendOk(reply, { items: catalog.items, extras });
  });

  app.post("/panel/api/restaurants/:restaurantId/availability", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    const body = params && parseOr400(availabilityBody, request.body, reply);
    if (!params || !body) return reply;
    const result = await panel.setItemAvailability(params.restaurantId, body.code, body.isAvailable);
    return result.ok ? sendOk(reply, body) : sendError(reply, 404, result.error);
  });

  app.get("/panel/api/restaurants/:restaurantId/conversations/human", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    if (!params || !(await storeOr404(params.restaurantId, reply))) return reply;
    return sendOk(reply, await panel.listHumanConversations(params.restaurantId));
  });

  app.post("/panel/api/restaurants/:restaurantId/conversations/:conversationId/resume", async (request, reply) => {
    const params = parseOr400(conversationParams, request.params, reply);
    if (!params) return reply;
    const result = await panel.resumeAgent(params.restaurantId, params.conversationId);
    return result.ok ? sendOk(reply, null) : sendError(reply, 404, result.error);
  });
}
