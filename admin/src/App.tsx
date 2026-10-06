import type { ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { Navigate, Route, Routes } from "react-router";
import { homePathFor, NO_ACCESS_PATH } from "@/app/navigation";
import { RestaurantProvider, useRestaurant } from "@/app/restaurant-context";
import { useAuth } from "@/auth/auth-provider";
import { useMe } from "@/auth/use-me";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import type { Permission } from "@/lib/types";
import { LoginPage } from "@/pages/login-page";
import { ForgotPasswordPage, SetPasswordPage } from "@/pages/password-pages";
import {
  AttentionPage,
  DashboardPage,
  DeliveriesPage,
  MenuPage,
  NoAccessPage,
  OrdersPage,
  SettingsPage,
  TeamPage,
} from "@/pages/section-pages";

function FullScreenMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center px-6 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Muestra la sección solo si el rol tiene el permiso; si no, lleva a su sección de inicio. */
function Guarded({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { membership } = useRestaurant();
  if (membership.permissions.includes(permission)) return children;
  return <Navigate to={homePathFor(membership.permissions)} replace />;
}

function PanelRoutes() {
  const { membership } = useRestaurant();
  const home = homePathFor(membership.permissions);
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Guarded permission="metrics:read"><DashboardPage /></Guarded>} />
        <Route path="pedidos" element={<Guarded permission="orders:read"><OrdersPage /></Guarded>} />
        <Route path="entregas" element={<Guarded permission="deliveries:own"><DeliveriesPage /></Guarded>} />
        <Route path="menu" element={<Guarded permission="menu:availability"><MenuPage /></Guarded>} />
        <Route path="atencion" element={<Guarded permission="conversations:manage"><AttentionPage /></Guarded>} />
        <Route path="equipo" element={<Guarded permission="team:manage"><TeamPage /></Guarded>} />
        <Route path="ajustes" element={<Guarded permission="settings:manage"><SettingsPage /></Guarded>} />
      </Route>
      <Route path={NO_ACCESS_PATH.slice(1)} element={<NoAccessPage />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

function SignedInApp() {
  const { data: me, isPending, isError, refetch } = useMe();
  if (isPending) {
    return (
      <FullScreenMessage>
        <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden /> Preparando tu panel…
      </FullScreenMessage>
    );
  }
  if (isError) {
    return (
      <FullScreenMessage>
        <span>
          No pudimos cargar tu información.{" "}
          <Button variant="link" className="px-1" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </span>
      </FullScreenMessage>
    );
  }
  if (me.memberships.length === 0) return <NoAccessPage />;
  return (
    <RestaurantProvider memberships={me.memberships}>
      <PanelRoutes />
    </RestaurantProvider>
  );
}

export function App() {
  const { status, needsPassword } = useAuth();

  if (status === "loading") {
    return (
      <FullScreenMessage>
        <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden /> Cargando…
      </FullScreenMessage>
    );
  }
  if (status === "error") return <FullScreenMessage>No se pudo conectar con el servidor. Recarga la página en un momento.</FullScreenMessage>;
  if (status === "signedOut") {
    return (
      <Routes>
        <Route path="recuperar" element={<ForgotPasswordPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (needsPassword) return <SetPasswordPage />;
  return <SignedInApp />;
}
