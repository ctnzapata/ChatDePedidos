import { useState, type FormEvent, type ReactNode } from "react";
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/auth/auth-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Botón principal de las pantallas de acceso: el ají marca la acción. */
export const AUTH_SUBMIT_CLASS = "h-11 w-full bg-brand text-sm text-brand-foreground hover:bg-brand/90";

type TicketProps = {
  number: string;
  time: string;
  status: string;
  statusClassName: string;
  fulfillment: string;
  lines: readonly (readonly [string, string])[];
  total: string;
  className?: string;
};

/** Comanda decorativa colgada del riel (contexto del producto en la pantalla de acceso). */
function Ticket({ number, time, status, statusClassName, fulfillment, lines, total, className }: TicketProps) {
  return (
    <div className={cn("relative w-60 origin-top", className)}>
      <span className="absolute -top-3 left-1/2 h-4 w-8 -translate-x-1/2 rounded-sm bg-sidebar-muted/60" />
      <div className="ticket-edge rounded-t-sm bg-paper px-4 pt-4 pb-6 text-paper-foreground shadow-[var(--shadow-ticket)]">
        <div className="flex items-center justify-between border-b border-dashed border-paper-foreground/20 pb-2.5">
          <span className="font-num text-sm font-semibold">#{number}</span>
          <span className="font-num text-xs text-paper-foreground/55">{time}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <span className={cn("label-mono rounded-sm px-1.5 py-0.5 text-[0.625rem]", statusClassName)}>{status}</span>
          <span className="label-mono text-[0.625rem] text-paper-foreground/55">{fulfillment}</span>
        </div>
        <div className="mt-3 space-y-1.5 text-[0.8rem]">
          {lines.map(([item, price]) => (
            <p key={item} className="flex justify-between gap-3">
              <span className="truncate">{item}</span>
              <span className="font-num text-paper-foreground/60">{price}</span>
            </p>
          ))}
        </div>
        <p className="mt-3 flex justify-between border-t border-dashed border-paper-foreground/20 pt-2.5 text-sm font-semibold">
          <span>Total</span>
          <span className="font-num">{total}</span>
        </p>
      </div>
    </div>
  );
}

/** Riel de cocina con dos comandas: la nueva entra mientras la anterior ya está en preparación. */
function KitchenRail() {
  return (
    <div aria-hidden className="relative mt-14">
      <div className="h-2.5 rounded-full bg-gradient-to-b from-sidebar-muted/50 to-sidebar-accent shadow-[0_2px_0_oklch(0_0_0/0.35)]" />
      <div className="flex gap-6 pl-6">
        <Ticket
          number="0127"
          time="12:41"
          status="Preparando"
          statusClassName="bg-[oklch(0.92_0.08_80)] text-paper-foreground"
          fulfillment="Recoger"
          lines={[["1 × Perro especial", "$17.000"], ["1 × Gaseosa 400 ml", "$4.000"]]}
          total="$21.000"
          className="-rotate-1 opacity-80"
        />
        <Ticket
          number="0128"
          time="12:47"
          status="Nuevo"
          statusClassName="bg-brand text-brand-foreground"
          fulfillment="Domicilio"
          lines={[["2 × Combo hamburguesa", "$50.000"], ["1 × Limonada de coco", "$9.000"], ["Domicilio", "$4.000"]]}
          total="$63.000"
          className="rotate-2 animate-in fade-in-0 slide-in-from-top-6 duration-700 ease-out"
        />
      </div>
    </div>
  );
}

/** Diseño de las pantallas de acceso: riel de comandas a la izquierda (escritorio) y formulario a la derecha. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.15fr_1fr]">
      <section className="rail-grid relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[28rem] rounded-full bg-brand/15 blur-3xl" aria-hidden />
        <p className="label-mono relative flex items-center gap-2 text-sidebar-muted">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden />
          Panel de pedidos
        </p>
        <div className="relative">
          <h2 className="font-display text-[4.5rem] leading-[0.88] text-sidebar-accent-foreground">
            Tu cocina,
            <br />
            <span className="text-brand">en orden.</span>
          </h2>
          <p className="mt-6 max-w-sm text-sidebar-muted">
            Los pedidos de WhatsApp llegan al riel en tiempo real. Acéptalos, prepáralos y despáchalos sin perder uno.
          </p>
          <KitchenRail />
        </div>
        <p className="label-mono relative text-sidebar-muted">Hecho para restaurantes en Colombia</p>
      </section>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
          <p className="label-mono flex items-center gap-2 text-muted-foreground lg:hidden">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden />
            Panel de pedidos
          </p>
          <h1 className="mt-3 font-display text-[2.75rem] leading-[0.92] lg:mt-0">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

type LoginFormProps = {
  onSubmit: (email: string, password: string) => Promise<void>;
};

export function LoginForm({ onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Escribe un correo válido.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(email.trim(), password);
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo iniciar sesión.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Correo</Label>
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" required />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Contraseña</Label>
          <Link to="/recuperar" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={isPasswordVisible ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 pr-11"
            required
          />
          <button
            type="button"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            aria-label={isPasswordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {isPasswordVisible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className={AUTH_SUBMIT_CLASS} disabled={isSubmitting}>
        {isSubmitting && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
        Entrar
      </Button>
    </form>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  return (
    <AuthLayout title="Bienvenido de nuevo" subtitle="Entra con el correo con el que te invitaron.">
      <LoginForm onSubmit={signIn} />
    </AuthLayout>
  );
}
