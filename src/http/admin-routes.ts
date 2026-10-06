import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthVerifier } from "../auth/auth-verifier.ts";
import {
  ROLE_LABELS,
  STAFF_ROLES,
  authorize,
  permissionsFor,
  type Membership,
  type Permission,
} from "../auth/permissions.ts";
import { ORDER_STATUSES } from "../domain/order-status.ts";
import { errorMessage } from "../lib/logger.ts";
import type { RestaurantRepository } from "../repositories/restaurant-repository.ts";
import type { StaffRepository } from "../repositories/staff-repository.ts";
import type { MetricsService } from "../services/metrics-service.ts";
import type { PanelService } from "../services/panel-service.ts";
import type { TeamService } from "../services/team-service.ts";
import { TRANSITION_HTTP_STATUS, parseOr400, sendError, sendOk } from "./responses.ts";

export interface AdminRoutesOptions {
  readonly verifier: AuthVerifier;
  readonly staff: StaffRepository;
  readonly panel: PanelService;
  readonly restaurants: RestaurantRepository;
  readonly team: TeamService;
  readonly metrics: MetricsService;
}

interface AdminAuth {
  readonly userId: string;
  readonly email: string | null;
  readonly memberships: readonly Membership[];
}

declare module "fastify" {
  interface FastifyRequest {
    adminAuth: AdminAuth | null;
  }
}

const INVITE_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

const restaurantParams = z.object({ restaurantId: z.uuid() });
const orderParams = restaurantParams.extend({ orderId: z.uuid() });
const conversationParams = restaurantParams.extend({ conversationId: z.uuid() });
const memberParams = restaurantParams.extend({ staffId: z.uuid() });
const ordersQuery = z.object({ includeClosed: z.enum(["0", "1", "true", "false"]).optional() });
const statusBody = z.object({ status: z.enum(ORDER_STATUSES), courierId: z.uuid().optional() });
const acceptingBody = z.object({ isAcceptingOrders: z.boolean() });
const availabilityBody = z.object({ code: z.string().min(1).max(20), isAvailable: z.boolean() });
const inviteBody = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(60),
  role: z.enum(STAFF_ROLES),
});
const memberChangesBody = z
  .object({
    role: z.enum(STAFF_ROLES).optional(),
    isActive: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(60).optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, "Indica al menos un cambio");

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() || null : null;
}

/** API del panel administrativo. Autenticación con Supabase Auth y permisos por rol en cada ruta. */
export async function adminRoutes(app: FastifyInstance, options: AdminRoutesOptions): Promise<void> {
  const { verifier, staff, panel, restaurants, team, metrics } = options;

  app.decorateRequest("adminAuth", null);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const token = bearerToken(request);
    if (!token) return sendError(reply, 401, "Inicia sesión para continuar.");
    try {
      const user = await verifier.verify(token);
      if (!user) return sendError(reply, 401, "Tu sesión no es válida o venció. Inicia sesión de nuevo.");
      request.adminAuth = { ...user, memberships: await staff.listMemberships(user.userId) };
    } catch (error: unknown) {
      request.log.error({ err: errorMessage(error) }, "No se pudo verificar la sesión");
      return sendError(reply, 503, "No pudimos verificar tu sesión. Intenta de nuevo.");
    }
  });

  /**
   * Autoriza la acción en el restaurante. No miembro → 404 (no revela que el restaurante existe);
   * miembro sin permiso → 403.
   */
  function allow(request: FastifyRequest, reply: FastifyReply, restaurantId: string, permission: Permission): Membership | null {
    const result = authorize(request.adminAuth?.memberships ?? [], restaurantId, permission);
    if (result.ok) return result.value;
    if (result.error === "NOT_MEMBER") sendError(reply, 404, "Restaurante no encontrado.");
    else sendError(reply, 403, "Tu rol no tiene permiso para esta acción.");
    return null;
  }

  app.get("/me", async (request, reply) => {
    const auth = request.adminAuth!;
    return sendOk(reply, {
      userId: auth.userId,
      email: auth.email,
      memberships: auth.memberships.map((m) => ({
        ...m,
        roleLabel: ROLE_LABELS[m.role],
        permissions: permissionsFor(m.role),
      })),
    });
  });

  // ---------------------------------------------------------------- Pedidos
  app.get("/restaurants/:restaurantId/orders", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    const query = params && parseOr400(ordersQuery, request.query, reply);
    if (!params || !query || !allow(request, reply, params.restaurantId, "orders:read")) return reply;
    const includeClosed = query.includeClosed === "1" || query.includeClosed === "true";
    return sendOk(reply, await panel.listOrders(params.restaurantId, { includeClosed }));
  });

  app.post("/restaurants/:restaurantId/orders/:orderId/status", async (request, reply) => {
    const params = parseOr400(orderParams, request.params, reply);
    const body = params && parseOr400(statusBody, request.body, reply);
    if (!params || !body || !allow(request, reply, params.restaurantId, "orders:manage")) return reply;
    const result = await panel.updateOrderStatus(params.restaurantId, params.orderId, body.status, {
      ...(body.courierId ? { courierStaffId: body.courierId } : {}),
    });
    if (!result.ok) return sendError(reply, TRANSITION_HTTP_STATUS[result.error.code], result.error.message);
    return sendOk(reply, result.value);
  });

  app.get("/restaurants/:restaurantId/couriers", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    if (!params || !allow(request, reply, params.restaurantId, "orders:manage")) return reply;
    return sendOk(reply, await staff.listActiveCouriers(params.restaurantId));
  });

  // ---------------------------------------------------------------- Domiciliario
  app.get("/restaurants/:restaurantId/deliveries", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    const membership = params && allow(request, reply, params.restaurantId, "deliveries:own");
    if (!params || !membership) return reply;
    return sendOk(reply, await panel.listDeliveries(params.restaurantId, membership.staffId));
  });

  app.post("/restaurants/:restaurantId/deliveries/:orderId/delivered", async (request, reply) => {
    const params = parseOr400(orderParams, request.params, reply);
    const membership = params && allow(request, reply, params.restaurantId, "deliveries:own");
    if (!params || !membership) return reply;
    const result = await panel.completeDelivery(params.restaurantId, params.orderId, membership.staffId);
    if (!result.ok) return sendError(reply, TRANSITION_HTTP_STATUS[result.error.code], result.error.message);
    return sendOk(reply, result.value);
  });

  // ---------------------------------------------------------------- Operación diaria
  app.post("/restaurants/:restaurantId/accepting", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    const body = params && parseOr400(acceptingBody, request.body, reply);
    if (!params || !body || !allow(request, reply, params.restaurantId, "store:pause")) return reply;
    await panel.setAcceptingOrders(params.restaurantId, body.isAcceptingOrders);
    return sendOk(reply, { isAcceptingOrders: body.isAcceptingOrders });
  });

  app.get("/restaurants/:restaurantId/menu", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    if (!params || !allow(request, reply, params.restaurantId, "menu:availability")) return reply;
    const catalog = await restaurants.loadCatalog(params.restaurantId);
    const extras = [...new Map(catalog.items.flatMap((i) => i.modifiers).map((m) => [m.code, m])).values()];
    return sendOk(reply, { items: catalog.items, extras });
  });

  app.post("/restaurants/:restaurantId/availability", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    const body = params && parseOr400(availabilityBody, request.body, reply);
    if (!params || !body || !allow(request, reply, params.restaurantId, "menu:availability")) return reply;
    const result = await panel.setItemAvailability(params.restaurantId, body.code, body.isAvailable);
    return result.ok ? sendOk(reply, body) : sendError(reply, 404, result.error);
  });

  // ---------------------------------------------------------------- Atención humana
  app.get("/restaurants/:restaurantId/conversations/human", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    if (!params || !allow(request, reply, params.restaurantId, "conversations:manage")) return reply;
    return sendOk(reply, await panel.listHumanConversations(params.restaurantId));
  });

  app.get("/restaurants/:restaurantId/conversations/:conversationId/messages", async (request, reply) => {
    const params = parseOr400(conversationParams, request.params, reply);
    if (!params || !allow(request, reply, params.restaurantId, "conversations:manage")) return reply;
    const result = await panel.getConversationMessages(params.restaurantId, params.conversationId);
    return result.ok ? sendOk(reply, result.value) : sendError(reply, 404, result.error);
  });

  app.post("/restaurants/:restaurantId/conversations/:conversationId/resume", async (request, reply) => {
    const params = parseOr400(conversationParams, request.params, reply);
    if (!params || !allow(request, reply, params.restaurantId, "conversations:manage")) return reply;
    const result = await panel.resumeAgent(params.restaurantId, params.conversationId);
    return result.ok ? sendOk(reply, null) : sendError(reply, 404, result.error);
  });

  // ---------------------------------------------------------------- Equipo (dueño)
  app.get("/restaurants/:restaurantId/team", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    if (!params || !allow(request, reply, params.restaurantId, "team:manage")) return reply;
    return sendOk(reply, await team.list(params.restaurantId));
  });

  app.post("/restaurants/:restaurantId/team/invite", { config: { rateLimit: INVITE_RATE_LIMIT } }, async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    const body = params && parseOr400(inviteBody, request.body, reply);
    if (!params || !body || !allow(request, reply, params.restaurantId, "team:manage")) return reply;
    const result = await team.invite(params.restaurantId, body);
    return result.ok ? sendOk(reply, result.value) : sendError(reply, 502, result.error.message);
  });

  app.patch("/restaurants/:restaurantId/team/:staffId", async (request, reply) => {
    const params = parseOr400(memberParams, request.params, reply);
    const body = params && parseOr400(memberChangesBody, request.body, reply);
    if (!params || !body || !allow(request, reply, params.restaurantId, "team:manage")) return reply;
    const result = await team.update(params.restaurantId, params.staffId, body);
    if (result.ok) return sendOk(reply, result.value);
    return sendError(reply, result.error.code === "LAST_OWNER" ? 409 : 404, result.error.message);
  });

  // ---------------------------------------------------------------- Métricas (dueño)
  app.get("/restaurants/:restaurantId/metrics/today", async (request, reply) => {
    const params = parseOr400(restaurantParams, request.params, reply);
    if (!params || !allow(request, reply, params.restaurantId, "metrics:read")) return reply;
    const summary = await metrics.today(params.restaurantId);
    return summary ? sendOk(reply, summary) : sendError(reply, 404, "Restaurante no encontrado.");
  });
}
