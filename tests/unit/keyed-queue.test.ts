import { describe, expect, it } from "vitest";
import { KeyedSerialQueue } from "../../src/lib/keyed-queue.ts";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("KeyedSerialQueue", () => {
  it("runs tasks with the same key one after another, in order", async () => {
    const queue = new KeyedSerialQueue();
    const log: string[] = [];

    await Promise.all([
      queue.run("a", async () => {
        await delay(20);
        log.push("a1");
      }),
      queue.run("a", async () => {
        log.push("a2");
      }),
    ]);

    expect(log).toEqual(["a1", "a2"]);
  });

  it("runs tasks with different keys concurrently", async () => {
    const queue = new KeyedSerialQueue();
    const log: string[] = [];

    await Promise.all([
      queue.run("a", async () => {
        await delay(20);
        log.push("a");
      }),
      queue.run("b", async () => {
        log.push("b");
      }),
    ]);

    expect(log).toEqual(["b", "a"]);
  });

  it("keeps processing after a task fails and returns task results", async () => {
    const queue = new KeyedSerialQueue();

    const failed = queue.run("a", async () => {
      throw new Error("boom");
    });
    const next = queue.run("a", async () => 42);

    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe(42);
  });

  it("forgets idle keys", async () => {
    const queue = new KeyedSerialQueue();

    await queue.run("a", async () => undefined);

    expect(queue.pendingKeys()).toBe(0);
  });
});
