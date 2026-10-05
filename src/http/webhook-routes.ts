import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errorMessage } from "../lib/logger.ts";
import { isValidSignature } from "../whatsapp/signature.ts";
import { parseWebhook, type InboundMessage } from "../whatsapp/webhook-parser.ts";
import { safeEqual } from "./basic-auth.ts";

export interface MessageHandler {
  handle(message: InboundMessage): Promise<void>;
}

export interface WebhookRoutesOptions {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly processor: MessageHandler;
}

// Meta puede enviar ráfagas de notificaciones; límite más alto que el resto de rutas.
const WEBHOOK_RATE_LIMIT = { max: 600, timeWindow: "1 minute" };

const verificationQuery = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string(),
  "hub.challenge": z.string().max(200),
});

export async function webhookRoutes(app: FastifyInstance, options: WebhookRoutesOptions): Promise<void> {
  // La firma se calcula sobre los bytes exactos: en este ámbito el cuerpo llega como Buffer.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  app.get("/webhook", { config: { rateLimit: WEBHOOK_RATE_LIMIT } }, async (request, reply) => {
    const query = verificationQuery.safeParse(request.query);
    if (!query.success || !safeEqual(query.data["hub.verify_token"], options.verifyToken)) {
      return reply.code(403).send("Forbidden");
    }
    return reply.type("text/plain").send(query.data["hub.challenge"]);
  });

  app.post("/webhook", { config: { rateLimit: WEBHOOK_RATE_LIMIT } }, async (request, reply) => {
    const rawBody = request.body;
    const signature = request.headers["x-hub-signature-256"];
    if (!Buffer.isBuffer(rawBody) || typeof signature !== "string" || !isValidSignature(rawBody, signature, options.appSecret)) {
      request.log.warn("Webhook con firma inválida rechazado");
      return reply.code(401).send("Invalid signature");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return reply.code(400).send("Invalid JSON");
    }

    // Responder rápido: Meta reintenta si no recibe 200 en pocos segundos.
    const messages = parseWebhook(payload);
    for (const message of messages) {
      options.processor
        .handle(message)
        .catch((error: unknown) => request.log.error({ err: errorMessage(error) }, "Error no controlado en el procesador"));
    }
    return reply.code(200).send("EVENT_RECEIVED");
  });
}
