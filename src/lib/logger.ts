import { pino } from "pino";

const usePretty = process.stdout.isTTY && process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Nunca registrar credenciales aunque lleguen dentro de un objeto.
  redact: ["*.accessToken", "*.authorization", "*.Authorization", "headers.authorization"],
  ...(usePretty ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } } : {}),
});

export type Logger = typeof logger;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
