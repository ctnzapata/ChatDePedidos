# CLAUDE.md

WhatsApp ordering agent for Colombian fast-food restaurants (low-cost pilot). The user-facing docs are in README.md.
Talk to the user in Spanish. Code identifiers are in English. Customer-facing text and comments are in Spanish.

## Commands

```bash
npm run supabase:start   # local Supabase in Docker (needed by integration tests)
npm test                 # vitest projects: unit (no DB) + integration (local Supabase). LLM is faked.
npm run test:unit        # no Docker needed
npm run test:coverage    # thresholds: 80% lines/functions/statements, 75% branches
npm run typecheck        # tsc --noEmit (TypeScript 7)
npm run db:setup         # prisma migrate deploy + seed (seed/menu.json) into DATABASE_URL (Supabase)
npm run db:new-migration # prints SQL diff: save it as prisma/migrations/<timestamp>_<name>/migration.sql
npm run chat -- --siempre-abierto   # terminal simulator against the REAL Claude API (spends tokens)
npm run dev              # Fastify server: /webhook, /panel, /health
```

## Architecture

- `src/domain`: pure rules: cart, checkout/quote, opening hours, order status machine. No I/O.
- `src/agent`: system prompt, tools (zod schema → JSON schema), manual tool-use loop (`OrderAgent`). It is provider-agnostic.
- `src/llm`: the neutral chat format (`ChatMessage`/`ChatPart`), plus `AnthropicProvider` and `GeminiProvider`. Pick one with `LLM_PROVIDER`. Never import a vendor SDK outside `src/llm`.
- `src/services/inbound-processor.ts`: per-message orchestration. Handles dedupe by `waMessageId`, the per-customer rate limit, HUMAN mode, the Confirm/Modify buttons (no LLM) and agent turns.
- `src/services/panel-service.ts`: restaurant panel actions. `src/http`: Fastify routes and the panel page.
- `src/repositories`: Prisma data access, always scoped by `restaurantId` / `customerId`.

## Invariants (do not break)

- **The LLM never sets prices or creates orders.** Totals come from `priceCart`/`buildQuote` over the DB catalog. An order is created only when the customer taps the Confirm button, and inside one transaction with the conversation state (`conversationAfterCreate`).
- Tools return a new `AgentState`; never mutate state. Any cart or checkout change resets `pendingConfirmation`.
- Money is whole COP integers. Format with `formatCop` (`$18.500`). The timezone is `America/Bogota`.
- `TOOL_DEFINITIONS` order and the system prompt must stay deterministic: changing them breaks prompt caching. Put per-turn data (time, open/closed) in `buildTurnContext`, not in the system prompt.
- Once an order exists, WhatsApp send failures must not show the generic error. Use `attempt()` in the processor.
- Domain errors use `Result<T, E>` from `src/lib/result.ts`. Do not throw for expected failures.

## Gotchas

- Prisma is pinned to **6.19.x** on purpose: npm `latest` points to an 8.x RC with a different API.
- The database is **Supabase Postgres**. Tables are snake_case (`@@map`). JSON columns are `jsonb`: write them with `toJson()` from `src/db/client.ts`, **never** `JSON.stringify` (that stores a JSON string).
- Migrations are SQL files in `prisma/migrations`, applied with `prisma migrate deploy`. Generate new ones with `npm run db:new-migration`; `migrate dev` needs a shadow DB. RLS policies, the `auth.users` FK and the Realtime publication live in `20261006000100_rls_realtime` and need Supabase (local or cloud).
- Security model: the backend connects as the table owner (bypasses RLS). Panel users (`authenticated`) can only SELECT their restaurants' rows. Roles are OWNER/STAFF (back office) and COURIER (only orders where `assigned_courier_id` is theirs). Every new table needs RLS enabled.
- Integration tests run against local Supabase (`tests/test-database.ts`) and refuse non-local hosts because they delete data. Prisma blocks `migrate reset`/`--force-reset` from AI agents; tests clean up with `deleteMany` instead.
- Integration tests share one database, so `fileParallelism: false` in the `integration` Vitest project.
- `trustProxy: "loopback"` assumes the tunnel (cloudflared/ngrok) runs on the same machine.
- The default model is `claude-haiku-4-5`, set via `ANTHROPIC_MODEL`. Its prompt-cache minimum is 4096 tokens.
- Gemini (`GEMINI_MODEL`, default `gemini-3.5-flash-lite`) needs its model parts replayed exactly, including thought signatures. They are stored in `ChatMessage.raw`, so keep it when editing history. Locally generated tool-call ids (`gemini-local-*`) are never sent back.
- The stored history uses the neutral format. Legacy or invalid history parses to `[]`, which resets the conversation.

## Tests

TDD: write the failing test first. Fakes live in `tests/fixtures`: `scriptedLlm` (scripted Claude responses), `FakeMessenger` (can fail per recipient), and `db.ts` (test store seeded from seed/menu.json, `MONDAY_3PM` = open).
