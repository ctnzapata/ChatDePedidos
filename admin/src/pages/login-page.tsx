import { useState, type FormEvent, type ReactNode } from "react";
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/auth/auth-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tarjeta de pedido decorativa del panel de bienvenida (profundidad y contexto del producto). */
function OrderPreview() {
  return (
    <div aria-hidden className="relative mt-12 max-w-sm">
      <div className="absolute inset-0 translate-x-4 translate-y-4 rotate-2 rounded-2xl border bg-card/70" />
      <div className="relative rounded-2xl border bg-card p-5 shadow-[var(--shadow-lifted)]">
        <div className="flex items-center justify-between">
          <p className="font-display text-2xl">Pedido #128</p>
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">Nuevo</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Ana · Domicilio · hace 1 min</p>
        <div className="mt-4 space-y-1.5 text-sm">
          <p className="flex justify-between"><span>2 × Combo hamburguesa</span><span>$50.000</span></p>
          <p className="flex justify-between"><span>1 × Limonada de coco</span><span>$9.000</span></p>
        </div>
        <div className="mt-4 h-9 rounded-lg bg-primary" />
      </div>
    </div>
  );
}

/** Diseño de las pantallas de acceso: marca a la izquierda (escritorio) y formulario a la derecha. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <section className="paper-grain relative hidden flex-col justify-between overflow-hidden border-r bg-secondary p-12 lg:flex">
        <p className="text-sm font-medium tracking-[0.18em] text-muted-foreground uppercase">Panel de pedidos</p>
        <div>
          <h2 className="font-display text-6xl leading-[0.95]">
            Tu cocina,
            <br />
            <em className="text-brand">en orden.</em>
          </h2>
          <p className="mt-5 max-w-sm text-muted-foreground">
            Los pedidos de WhatsApp llegan aquí en tiempo real. Acéptalos, prepáralos y despáchalos sin perder uno.
          </p>
          <OrderPreview />
        </div>
        <p className="text-xs text-muted-foreground">Hecho para restaurantes en Colombia</p>
      </section>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-700">
          <h1 className="font-display text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
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
      <Button type="submit" className="h-11 w-full text-sm" disabled={isSubmitting}>
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
