import { describe, expect, it } from "vitest";
import { parseBaseConfig, parseServerConfig } from "../../src/config/env.ts";

const serverEnv = {
  DATABASE_URL: "file:./dev.db",
  WHATSAPP_ACCESS_TOKEN: "token",
  WHATSAPP_APP_SECRET: "secret",
  WHATSAPP_VERIFY_TOKEN: "verify-token-123",
  PANEL_USER: "admin",
  PANEL_PASSWORD: "una-clave-larga",
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
};

describe("parseBaseConfig", () => {
  it("applies defaults for the agent settings", () => {
    const config = parseBaseConfig({ DATABASE_URL: "file:./dev.db" });

    expect(config).toMatchObject({
      llmProvider: "anthropic",
      anthropicModel: "claude-haiku-4-5",
      geminiModel: "gemini-3.5-flash-lite",
      agentMaxOutputTokens: 1024,
      agentMaxIterations: 6,
      agentHistoryLimit: 20,
    });
  });

  it("selects Gemini when configured with an API key", () => {
    const config = parseBaseConfig({ DATABASE_URL: "file:./dev.db", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "clave" });

    expect(config).toMatchObject({ llmProvider: "gemini", geminiApiKey: "clave" });
  });

  it("requires GEMINI_API_KEY when the provider is Gemini", () => {
    expect(() => parseBaseConfig({ DATABASE_URL: "file:./dev.db", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "" })).toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it("rejects unknown providers", () => {
    expect(() => parseBaseConfig({ DATABASE_URL: "file:./dev.db", LLM_PROVIDER: "openai" })).toThrow(/LLM_PROVIDER/);
  });

  it("treats empty strings as missing values", () => {
    expect(parseBaseConfig({ DATABASE_URL: "file:./dev.db", AGENT_MAX_ITERATIONS: "" }).agentMaxIterations).toBe(6);
  });

  it("fails with a readable message when values are invalid", () => {
    expect(() => parseBaseConfig({ DATABASE_URL: "", AGENT_MAX_ITERATIONS: "100" })).toThrow(
      /DATABASE_URL[\s\S]*AGENT_MAX_ITERATIONS/,
    );
  });
});

describe("parseServerConfig", () => {
  it("parses the WhatsApp and panel settings", () => {
    const config = parseServerConfig(serverEnv);

    expect(config).toMatchObject({ port: 3000, whatsappApiVersion: "v23.0", panelUser: "admin" });
  });

  it("requires a panel password of at least 10 characters", () => {
    expect(() => parseServerConfig({ ...serverEnv, PANEL_PASSWORD: "corta" })).toThrow(/PANEL_PASSWORD/);
  });

  it("requires the Supabase keys and defaults the admin app URL", () => {
    expect(parseServerConfig(serverEnv).adminAppUrl).toBe("http://localhost:3000/admin");
    expect(() => parseServerConfig({ ...serverEnv, SUPABASE_SECRET_KEY: "" })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => parseServerConfig({ ...serverEnv, SUPABASE_URL: "no-es-url" })).toThrow(/SUPABASE_URL/);
  });

  it("requires the WhatsApp secrets", () => {
    expect(() => parseServerConfig({ ...serverEnv, WHATSAPP_APP_SECRET: "" })).toThrow(/WHATSAPP_APP_SECRET/);
  });
});
