import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import type { BaseConfig } from "../config/env.ts";
import { AnthropicProvider } from "./anthropic-provider.ts";
import { GeminiProvider } from "./gemini-provider.ts";
import type { LlmProvider } from "./types.ts";

/** Elige el proveedor según LLM_PROVIDER (anthropic por defecto). */
export function createLlmProvider(config: BaseConfig): LlmProvider {
  if (config.llmProvider === "gemini") {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    return new GeminiProvider((params) => ai.models.generateContent(params), config.geminiModel);
  }
  const anthropic = new Anthropic();
  return new AnthropicProvider((params) => anthropic.messages.create(params), config.anthropicModel);
}
