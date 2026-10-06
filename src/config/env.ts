import { z } from "zod";
import type { LlmProviderName } from "../llm/types.ts";

type Env = Record<string, string | undefined>;

// Los valores vacíos de .env ("") cuentan como no definidos para que apliquen los valores por defecto.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1, "es obligatorio"),
  LOG_LEVEL: optional(z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")),
  LLM_PROVIDER: optional(z.enum(["anthropic", "gemini"]).default("anthropic")),
  ANTHROPIC_MODEL: optional(z.string().min(1).default("claude-haiku-4-5")),
  GEMINI_API_KEY: optional(z.string().min(1).optional()),
  GEMINI_MODEL: optional(z.string().min(1).default("gemini-3.5-flash-lite")),
  AGENT_MAX_OUTPUT_TOKENS: optional(z.coerce.number().int().min(256).max(8192).default(1024)),
  AGENT_MAX_ITERATIONS: optional(z.coerce.number().int().min(1).max(15).default(6)),
  AGENT_HISTORY_LIMIT: optional(z.coerce.number().int().min(4).max(100).default(20)),
});

const serverSchema = baseSchema.extend({
  PORT: optional(z.coerce.number().int().min(1).max(65535).default(3000)),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1, "es obligatorio"),
  WHATSAPP_APP_SECRET: z.string().min(1, "es obligatorio"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8, "debe tener al menos 8 caracteres"),
  WHATSAPP_API_VERSION: optional(z.string().regex(/^v\d+\.\d+$/, "formato vNN.N").default("v23.0")),
  PANEL_USER: z.string().min(1, "es obligatorio"),
  PANEL_PASSWORD: z.string().min(10, "debe tener al menos 10 caracteres"),
  SUPABASE_URL: z.url("debe ser la Project URL de Supabase"),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1, "es obligatorio"),
  SUPABASE_SECRET_KEY: z.string().min(1, "es obligatorio"),
  // Página del panel a la que llegan los enlaces de invitación.
  ADMIN_APP_URL: optional(z.url().default("http://localhost:3000/admin")),
});

export interface BaseConfig {
  readonly databaseUrl: string;
  readonly logLevel: string;
  readonly llmProvider: LlmProviderName;
  readonly anthropicModel: string;
  readonly geminiApiKey: string | undefined;
  readonly geminiModel: string;
  readonly agentMaxOutputTokens: number;
  readonly agentMaxIterations: number;
  readonly agentHistoryLimit: number;
}

export interface ServerConfig extends BaseConfig {
  readonly port: number;
  readonly whatsappAccessToken: string;
  readonly whatsappAppSecret: string;
  readonly whatsappVerifyToken: string;
  readonly whatsappApiVersion: string;
  readonly panelUser: string;
  readonly panelPassword: string;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly supabaseSecretKey: string;
  readonly adminAppUrl: string;
}

function parseOrThrow<T extends z.ZodType>(schema: T, env: Env): z.infer<T> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Configuración inválida en las variables de entorno:\n${details}`);
}

function toBaseConfig(env: z.infer<typeof baseSchema>): BaseConfig {
  if (env.LLM_PROVIDER === "gemini" && !env.GEMINI_API_KEY) {
    throw new Error("Configuración inválida en las variables de entorno:\n  - GEMINI_API_KEY: es obligatorio con LLM_PROVIDER=gemini");
  }
  return {
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    llmProvider: env.LLM_PROVIDER,
    anthropicModel: env.ANTHROPIC_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    agentMaxOutputTokens: env.AGENT_MAX_OUTPUT_TOKENS,
    agentMaxIterations: env.AGENT_MAX_ITERATIONS,
    agentHistoryLimit: env.AGENT_HISTORY_LIMIT,
  };
}

export function parseBaseConfig(env: Env): BaseConfig {
  return toBaseConfig(parseOrThrow(baseSchema, env));
}

export function parseServerConfig(env: Env): ServerConfig {
  const parsed = parseOrThrow(serverSchema, env);
  return {
    ...toBaseConfig(parsed),
    port: parsed.PORT,
    whatsappAccessToken: parsed.WHATSAPP_ACCESS_TOKEN,
    whatsappAppSecret: parsed.WHATSAPP_APP_SECRET,
    whatsappVerifyToken: parsed.WHATSAPP_VERIFY_TOKEN,
    whatsappApiVersion: parsed.WHATSAPP_API_VERSION,
    panelUser: parsed.PANEL_USER,
    panelPassword: parsed.PANEL_PASSWORD,
    supabaseUrl: parsed.SUPABASE_URL,
    supabasePublishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
    supabaseSecretKey: parsed.SUPABASE_SECRET_KEY,
    adminAppUrl: parsed.ADMIN_APP_URL,
  };
}

/** Carga .env si existe (Node >= 20.12). Las variables ya definidas en el entorno tienen prioridad. */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
