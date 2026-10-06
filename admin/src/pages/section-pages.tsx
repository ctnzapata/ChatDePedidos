import { useRestaurant } from "@/app/restaurant-context";
import { useAuth } from "@/auth/auth-provider";
import { ComingSoon, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

// Pantallas base de cada sección. Se completan en las Fases 5 (pedidos, resumen, entregas) y 6 (menú, atención, equipo, ajustes).

export function DashboardPage() {
  const { membership } = useRestaurant();
  return (
    <>
      <PageHeader eyebrow="Resumen del día" title={`Hola, ${membership.displayName.split(" ")[0]}`} description="Así va tu restaurante hoy." />
      <ComingSoon title="Tus cifras del día">Ventas, pedidos, ticket promedio y productos estrella aparecerán aquí en tiempo real.</ComingSoon>
    </>
  );
}

export function OrdersPage() {
  return (
    <>
      <PageHeader eyebrow="Operación" title="Pedidos" description="Todo lo que entra por WhatsApp, en un solo tablero." />
      <ComingSoon title="Tablero en tiempo real">Los pedidos nuevos aparecerán al instante con alerta sonora, listos para aceptar, preparar y despachar.</ComingSoon>
    </>
  );
}

export function DeliveriesPage() {
  return (
    <>
      <PageHeader eyebrow="Domicilios" title="Mis entregas" />
      <ComingSoon title="Tus domicilios asignados">Verás la dirección, el valor a cobrar y el cambio, con un botón para marcar cada entrega.</ComingSoon>
    </>
  );
}

export function MenuPage() {
  return (
    <>
      <PageHeader eyebrow="Catálogo" title="Menú" />
      <ComingSoon title="Tu menú, editable">Productos, precios, adiciones y disponibilidad desde aquí, sin tocar archivos.</ComingSoon>
    </>
  );
}

export function AttentionPage() {
  return (
    <>
      <PageHeader eyebrow="Clientes" title="Atención humana" />
      <ComingSoon title="Clientes que pidieron una persona">Verás la conversación completa y podrás reactivar el asistente cuando terminen.</ComingSoon>
    </>
  );
}

export function TeamPage() {
  return (
    <>
      <PageHeader eyebrow="Personas" title="Equipo" />
      <ComingSoon title="Tu equipo">Invita personal y domiciliarios por correo y asigna sus roles.</ComingSoon>
    </>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Restaurante" title="Ajustes" />
      <ComingSoon title="Ajustes del local">Horario, costo de domicilio, pedido mínimo y medios de pago.</ComingSoon>
    </>
  );
}

/** Usuario con sesión pero sin restaurante activo asignado. */
export function NoAccessPage() {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-svh items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="font-display text-4xl">Aún no tienes acceso</h1>
        <p className="mt-3 text-muted-foreground">Pídele al dueño del restaurante que te invite desde la sección Equipo.</p>
        <Button variant="outline" className="mt-6" onClick={() => void signOut()}>
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
