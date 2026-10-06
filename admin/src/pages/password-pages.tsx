import { useState, type FormEvent } from "react";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/auth/auth-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "./login-page";

const MIN_PASSWORD_LENGTH = 10;

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [isSent, setIsSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    await requestPasswordReset(email.trim()).catch(() => undefined);
    setIsSubmitting(false);
    setIsSent(true);
  }

  return (
    <AuthLayout title="Recupera tu acceso" subtitle="Te enviaremos un enlace para crear una contraseña nueva.">
      {isSent ? (
        <Alert>
          <CheckCircle2Icon aria-hidden />
          <AlertDescription>Si el correo tiene una cuenta, te llegará un enlace en unos minutos. Revisa también el spam.</AlertDescription>
        </Alert>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="reset-email">Correo</Label>
            <Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" required />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
            Enviar enlace
          </Button>
        </form>
      )}
      <Link to="/" className="mt-6 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Volver a iniciar sesión
      </Link>
    </AuthLayout>
  );
}

/** Al aceptar una invitación o recuperar la cuenta, la persona define su contraseña. */
export function SetPasswordPage() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    if (password !== confirmation) return setError("Las contraseñas no coinciden.");
    setError(null);
    setIsSubmitting(true);
    try {
      await updatePassword(password);
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo guardar la contraseña.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Crea tu contraseña" subtitle={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres. La usarás para entrar al panel.`}>
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="new-password">Contraseña nueva</Label>
          <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Repite la contraseña</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="h-11" />
        </div>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
          Guardar y entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
