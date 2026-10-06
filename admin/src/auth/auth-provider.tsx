import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { loadPublicConfig } from "@/lib/config";

type AuthStatus = "loading" | "signedOut" | "signedIn" | "error";

interface AuthContextValue {
  readonly status: AuthStatus;
  readonly session: Session | null;
  /** true al llegar desde un enlace de invitación o de recuperación: hay que definir contraseña. */
  readonly needsPassword: boolean;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly requestPasswordReset: (email: string) => Promise<void>;
  readonly updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Se lee antes de que supabase-js limpie el hash de la URL.
const arrivedFromInvite = typeof window !== "undefined" && /type=(invite|recovery)/.test(window.location.hash);

const SIGN_IN_ERROR = "Correo o contraseña incorrectos.";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [needsPassword, setNeedsPassword] = useState(arrivedFromInvite);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    loadPublicConfig()
      .then((config) => {
        const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);
        setClient(supabase);
        const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
          if (event === "PASSWORD_RECOVERY") setNeedsPassword(true);
          setSession(nextSession);
          setStatus(nextSession ? "signedIn" : "signedOut");
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch(() => setStatus("error"));
    return () => unsubscribe?.();
  }, []);

  const requireClient = (): SupabaseClient => {
    if (!client) throw new Error("El panel aún está cargando.");
    return client;
  };

  const value: AuthContextValue = {
    status,
    session,
    needsPassword,
    async signIn(email, password) {
      const { error } = await requireClient().auth.signInWithPassword({ email, password });
      if (error) throw new Error(SIGN_IN_ERROR);
    },
    async signOut() {
      await requireClient().auth.signOut();
    },
    async requestPasswordReset(email) {
      // Respuesta siempre igual para no revelar qué correos tienen cuenta.
      await requireClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/admin/definir-clave`,
      });
    },
    async updatePassword(password) {
      const { error } = await requireClient().auth.updateUser({ password });
      if (error) throw new Error("No se pudo guardar la contraseña. Intenta con otra.");
      setNeedsPassword(false);
    },
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return context;
}
