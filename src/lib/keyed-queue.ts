/**
 * Ejecuta en serie las tareas que comparten clave (una conversación) y en paralelo las de claves distintas.
 * Evita que dos mensajes seguidos del mismo cliente se procesen a la vez y se pisen el carrito.
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    // Las colas guardadas nunca rechazan, así que `previous` siempre se resuelve.
    const previous = this.tails.get(key) ?? Promise.resolve();
    const runTask = async (): Promise<T> => {
      try {
        return await task();
      } finally {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      }
    };
    const current = previous.then(runTask);
    const tail: Promise<unknown> = current.catch(() => undefined);
    this.tails.set(key, tail);
    return current;
  }

  pendingKeys(): number {
    return this.tails.size;
  }
}
