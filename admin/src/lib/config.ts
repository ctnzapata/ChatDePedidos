export interface PublicConfig {
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
}

/** Valores públicos que entrega el backend (nunca incluye la llave secreta). */
export async function loadPublicConfig(): Promise<PublicConfig> {
  const response = await fetch("/api/public-config");
  if (!response.ok) throw new Error("No se pudo cargar la configuración del panel.");
  const config = (await response.json()) as Partial<PublicConfig>;
  if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error("Configuración del panel incompleta.");
  return { supabaseUrl: config.supabaseUrl, supabasePublishableKey: config.supabasePublishableKey };
}
