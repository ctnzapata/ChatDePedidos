import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import type { Me } from "@/lib/types";
import { useAuth } from "./auth-provider";

/** Cliente de la API con el token de la sesión actual. */
export function useApi() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  return {
    get: <T>(path: string) => apiRequest<T>(path, { token }),
    post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { token, method: "POST", body: body ?? {} }),
    patch: <T>(path: string, body: unknown) => apiRequest<T>(path, { token, method: "PATCH", body }),
  };
}

export function useMe() {
  const { session } = useAuth();
  const api = useApi();
  return useQuery({
    queryKey: ["me", session?.user.id],
    queryFn: () => api.get<Me>("/me"),
    enabled: Boolean(session),
    staleTime: 60_000,
  });
}
