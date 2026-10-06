import path from "node:path";
import { OrderAgent } from "./agent/order-agent.ts";
import { hasAdminBuild } from "./http/admin-app.ts";
import { SupabaseAuthVerifier } from "./auth/auth-verifier.ts";
import { SupabaseUserAdmin } from "./auth/user-admin.ts";
import { StaffRepository } from "./repositories/staff-repository.ts";
import { MetricsService } from "./services/metrics-service.ts";
import { TeamService } from "./services/team-service.ts";
import { createLlmProvider } from "./llm/create-provider.ts";
import { loadDotEnv, parseServerConfig } from "./config/env.ts";
import { createDb } from "./db/client.ts";
import { buildServer } from "./http/server.ts";
import { errorMessage, logger } from "./lib/logger.ts";
import { ConversationRepository } from "./repositories/conversation-repository.ts";
import { OrderRepository } from "./repositories/order-repository.ts";
import { RestaurantRepository } from "./repositories/restaurant-repository.ts";
import { InboundProcessor } from "./services/inbound-processor.ts";
import { PanelService } from "./services/panel-service.ts";
import { CloudApiMessenger } from "./whatsapp/cloud-api-messenger.ts";

const PLACEHOLDER_PHONE_NUMBER_ID = "REEMPLAZAR_CON_PHONE_NUMBER_ID";
const ADMIN_APP_DIR = path.resolve("admin/dist");

async function main(): Promise<void> {
  loadDotEnv();
  const config = parseServerConfig(process.env);
  logger.level = config.logLevel;

  const db = createDb();
  const restaurants = new RestaurantRepository(db);
  const conversations = new ConversationRepository(db);
  const orders = new OrderRepository(db);
  const messenger = new CloudApiMessenger({ accessToken: config.whatsappAccessToken, apiVersion: config.whatsappApiVersion });

  const stores = await restaurants.listAll();
  if (stores.length === 0) logger.warn("No hay restaurantes en la base de datos. Ejecuta: npm run db:setup");
  for (const store of stores.filter((s) => s.whatsappPhoneNumberId === PLACEHOLDER_PHONE_NUMBER_ID)) {
    logger.warn({ restaurant: store.slug }, "Falta configurar SEED_WHATSAPP_PHONE_NUMBER_ID y volver a ejecutar el seed");
  }

  if (config.llmProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    logger.warn("ANTHROPIC_API_KEY no está definida: el agente fallará si no hay otras credenciales de Anthropic");
  }
  const provider = createLlmProvider(config);
  const agent = new OrderAgent(provider, {
    maxOutputTokens: config.agentMaxOutputTokens,
    maxIterations: config.agentMaxIterations,
    historyLimit: config.agentHistoryLimit,
  });

  const processor = new InboundProcessor({ restaurants, conversations, orders, messenger, agent });
  const panel = new PanelService({ restaurants, conversations, orders, messenger });
  const staff = new StaffRepository(db);
  const server = await buildServer({
    config,
    processor,
    panel,
    restaurants,
    admin: {
      verifier: SupabaseAuthVerifier.create(config.supabaseUrl, config.supabasePublishableKey),
      staff,
      panel,
      restaurants,
      team: new TeamService({
        staff,
        userAdmin: SupabaseUserAdmin.create(config.supabaseUrl, config.supabaseSecretKey, db),
        inviteRedirectUrl: config.adminAppUrl,
      }),
      metrics: new MetricsService(orders, restaurants),
    },
    publicConfig: { supabaseUrl: config.supabaseUrl, supabasePublishableKey: config.supabasePublishableKey },
    adminAppDir: ADMIN_APP_DIR,
  });
  if (!hasAdminBuild(ADMIN_APP_DIR)) logger.warn("El panel no está compilado. Ejecuta: npm run admin:build");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Cerrando servidor");
    await server.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await server.listen({ port: config.port, host: "0.0.0.0" });
  logger.info(`Panel: http://localhost:${config.port}/panel · Webhook: /webhook · Modelo: ${provider.name}/${provider.model}`);
}

main().catch((error: unknown) => {
  logger.fatal({ err: errorMessage(error) }, "No se pudo iniciar el servidor");
  process.exit(1);
});
