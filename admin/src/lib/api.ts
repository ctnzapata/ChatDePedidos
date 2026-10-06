export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  readonly token: string;
  readonly method?: "GET" | "POST" | "PATCH";
  readonly body?: unknown;
}

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

/** Llama a /api/admin con el token de la sesión y devuelve `data` del sobre { success, data, error }. */
export async function apiRequest<T>(path: string, { token, method = "GET", body }: RequestOptions): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  let envelope: Envelope<T>;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError("El servidor no respondió como esperábamos. Intenta de nuevo.", response.status);
  }
  if (!response.ok || !envelope.success) {
    throw new ApiError(envelope.error ?? "Ocurrió un error inesperado.", response.status);
  }
  return envelope.data;
}
