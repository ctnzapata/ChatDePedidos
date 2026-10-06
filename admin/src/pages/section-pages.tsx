import { useRestaurant } from "@/app/restaurant-context";
import { useAuth } from "@/auth/auth-provider";
import { PageHeader } from "@/components/layout/page-header";
import { SectionPreview } from "@/components/layout/section-preview";
import { Button } from "@/components/ui/button";

// Pantallas base de cada sección. Se completan en las Fases 5 (pedidos, resumen, entregas) y 6 (menú, atención, equipo, ajustes).

export function DashboardPage() {
  const { membership } = useRestaurant();
  return (
    <>
      <PageHeader eyebrow="Resumen del día" title={`Hola, ${membership.displayName.split(" ")[0]}`} description="Así va tu restaurante hoy." />
      <SectionPreview kind="stats" title="Tus cifras del día">
        Ventas, pedidos, ticket promedio y productos estrella, en tiempo real.
      </SectionPreview>
    </>
  );
}

export function OrdersPage() {
  return (
    <>
      <PageHeader eyebrow="Operación" title="Pedidos" description="Todo lo que entra por WhatsApp, en un solo tablero." />
      <SectionPreview kind="board" title="Tablero en tiempo real">
        Los pedidos nuevos aparecerán al instante con alerta sonora, listos para aceptar, preparar y despachar.
      </SectionPreview>
    </>
  );
}

export function DeliveriesPage() {
  return (
    <>
      <PageHeader eyebrow="Domicilios" title="Mis entregas" />
      <SectionPreview kind="list" title="Tus domicilios asignados">
        Dirección, valor a cobrar y cambio, con un botón para marcar cada entrega.
      </SectionPreview>
    </>
  );
}

export function MenuPage() {
  return (
    <>
      <PageHeader eyebrow="Catálogo" title="Menú" />
      <SectionPreview kind="list" title="Tu menú, editable">
        Productos, precios, adiciones y disponibilidad desde aquí, sin tocar archivos.
      </SectionPreview>
    </>
  );
}

export function AttentionPage() {
  return (
    <>
      <PageHeader eyebrow="Clientes" title="Atención humana" />
      <SectionPreview kind="list" title="Clientes que pidieron una persona">
        Verás la conversación completa y podrás reactivar el asistente cuando terminen.
      </SectionPreview>
    </>
  );
}

export function TeamPage() {
  return (
    <>
      <PageHeader eyebrow="Personas" title="Equipo" />
      <SectionPreview kind="list" title="Tu equipo">
        Invita personal y domiciliarios por correo y asigna sus roles.
      </SectionPreview>
    </>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Restaurante" title="Ajustes" />
      <SectionPreview kind="list" title="Ajustes del local">
        Horario, costo de domicilio, pedido mínimo y medios de pago.
      </SectionPreview>
    </>
  );
}

/** Usuario con sesión pero sin restaurante activo asignado. */
export function NoAccessPage() {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-svh items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="label-mono text-brand">Sin acceso</p>
        <h1 className="mt-3 font-display text-5xl leading-[0.92]">Aún no tienes un restaurante asignado</h1>
        <p className="mt-4 text-muted-foreground">Pídele al dueño del restaurante que te invite desde la sección Equipo.</p>
        <Button variant="outline" className="mt-6" onClick={() => void signOut()}>
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
