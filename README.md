# Agente de pedidos por WhatsApp

Asistente con IA (Claude) que atiende por WhatsApp a los clientes de restaurantes y locales de comidas rápidas.
Muestra el menú, arma el pedido (domicilio o recoger) y pide confirmación con botones. El restaurante gestiona
los pedidos desde un panel web, y cada cambio de estado se le avisa al cliente por WhatsApp.

**Pensado para un piloto de bajo costo:** usa el número de prueba gratuito de Meta, Supabase (plan gratuito), un túnel gratuito y
Claude Haiku 4.5. El único gasto es el uso del modelo.

## Cómo funciona

```
Cliente WhatsApp ─► Meta Cloud API ─► POST /webhook (firma verificada)
                                          │  cola en serie por cliente
                                          ▼
                                   InboundProcessor ──► botones Confirmar / Modificar (sin IA)
                                          │
                                          ▼
                                 OrderAgent (Claude + herramientas)
                    add_to_cart · update_cart_item · view_cart · set_order_details
                    request_order_confirmation · get_order_status · cancel_order · transfer_to_human
                                          │
                                          ▼
                 Supabase Postgres (Prisma) ◄── Panel web /panel
```

- **El modelo nunca calcula precios ni crea pedidos.** Los totales salen del menú en la base de datos, y el pedido
  solo se crea cuando el cliente toca **Confirmar pedido**. Si el precio cambió entre el resumen y la confirmación,
  se vuelve a pedir la confirmación.
- **Escalado a humano:** con quejas o cuando el cliente lo pide, el agente se pausa para ese cliente, avisa al
  personal y reenvía sus mensajes. Desde el panel se reactiva.
- **Control de costos:** caché de prompts, historial recortado, máximo de iteraciones por mensaje, tope de tokens de
  salida, y los botones se resuelven sin llamar al modelo.

## Puesta en marcha

Requisitos: Node.js 20.12 o superior.

```bash
npm install
cp .env.example .env        # completa los valores (ver abajo)
npm run db:setup            # aplica las migraciones en Supabase y carga el menú de ejemplo (seed/menu.json)
```

**Base de datos (Supabase):** crea un proyecto gratuito en <https://supabase.com> (región São Paulo). En
*Project Settings → Database → Connection string* copia la conexión **Transaction pooler** (puerto 6543, agrega
`?pgbouncer=true`) en `DATABASE_URL` y la **Session pooler** (puerto 5432) en `DIRECT_URL`.

**Pruebas:** las de integración usan Supabase local en Docker y nunca tocan la base de la nube.

```bash
npm run supabase:start      # requiere Docker Desktop abierto
npm test                    # unitarias + integración
npm run test:unit           # solo unitarias (sin Docker)
```

### 1. Probar el agente sin WhatsApp (solo necesitas la clave de Anthropic)

```bash
npm run chat -- --siempre-abierto
```

Conversas con el agente real desde la terminal. Comandos: `/confirmar`, `/modificar`, `/reiniciar`, `/costo`
(tokens y costo estimado) y `/salir`. `--siempre-abierto` simula que el local está abierto aunque pruebes de noche.

### 2. Elegir el proveedor de IA

El agente funciona con **Claude** o con **Gemini**. Se elige con `LLM_PROVIDER` en `.env` y no requiere cambios de código.

| | Claude Haiku 4.5 (`anthropic`) | Gemini Flash-Lite (`gemini`) |
|---|---|---|
| Costo del piloto | ≈ US$0,04–0,10 por pedido | US$0 en el plan gratuito (con límites diarios) |
| Privacidad | Anthropic no entrena con los datos de la API | En el plan gratuito Google puede usar los datos para mejorar sus productos |
| Recomendado para | Piloto con clientes reales | Pruebas internas sin costo |

**Gemini:** crea la key en <https://aistudio.google.com/apikey> y configura `LLM_PROVIDER="gemini"` y `GEMINI_API_KEY`.

### 3. Claude (Anthropic)

1. Crea una cuenta en <https://console.anthropic.com>, carga crédito y **fija un límite de gasto mensual**
   (Settings → Limits).
2. Crea una API key y ponla en `ANTHROPIC_API_KEY`.

### 4. WhatsApp Cloud API (número de prueba gratuito)

1. En <https://developers.facebook.com> crea una app de tipo *Business* y agrega el producto **WhatsApp**.
2. En **WhatsApp → API Setup**:
   - Copia el **Phone number ID** del número de prueba en `SEED_WHATSAPP_PHONE_NUMBER_ID` y vuelve a ejecutar
     `npm run db:seed`.
   - Agrega hasta 5 teléfonos destinatarios (el tuyo, el del "restaurante" y los de los testers).
   - El token temporal dura 24 h. Para no renovarlo cada día, crea un *usuario del sistema* en Business Settings
     con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`, y genera un token permanente.
     Ponlo en `WHATSAPP_ACCESS_TOKEN`.
3. En **App settings → Basic** copia el **App secret** en `WHATSAPP_APP_SECRET`.
4. Inventa una cadena larga para `WHATSAPP_VERIFY_TOKEN`.
5. Pon el teléfono del personal en `SEED_STAFF_PHONE` (formato `57300…`, sin `+`) y ejecuta `npm run db:seed`.

### 5. Exponer el servidor con un túnel gratuito

```bash
npm run dev                                   # servidor en http://localhost:3000
cloudflared tunnel --url http://localhost:3000   # o: ngrok http 3000
```

En Meta, ve a **WhatsApp → Configuration → Webhook**:

- *Callback URL*: `https://<tu-túnel>/webhook`
- *Verify token*: el valor de `WHATSAPP_VERIFY_TOKEN`
- Suscríbete al campo **messages**.

La URL de `cloudflared --url` cambia cada vez que lo inicias. Para una URL fija usa un túnel con nombre (requiere un
dominio en Cloudflare) o el dominio estático gratuito de ngrok.

### 6. Panel del restaurante

Abre `http://localhost:3000/panel` (usuario y contraseña de `PANEL_USER` y `PANEL_PASSWORD`). Desde ahí puedes:

- **Pedidos:** aceptar o rechazar, marcar en preparación, en camino o listo, y entregado. Cada cambio avisa al cliente.
- **Menú:** marcar productos y adiciones como agotados.
- **Atención humana:** ver quién espera a una persona y reactivar el asistente.
- **Recibiendo pedidos:** pausar o reanudar la toma de pedidos.

Pulsa **🔔 Activar sonido** para que suene una alerta con cada pedido nuevo.

## Personalizar el restaurante

Edita `seed/menu.json` (datos del local, horario, costo de domicilio, pedido mínimo, medios de pago y menú) y ejecuta
`npm run db:seed`. El seed reemplaza el menú sin borrar pedidos ni conversaciones. Los códigos de producto siguen el
formato `ABC-DEF`.

## Desarrollo

```bash
npm test               # pruebas unitarias e integración (no consumen tokens: el LLM se simula)
npm run test:coverage  # cobertura (mínimo 80%)
npm run typecheck
```

Estructura:

| Carpeta | Contenido |
|---|---|
| `src/domain` | Reglas puras: carrito, totales, horarios, estados del pedido |
| `src/agent` | Prompt, herramientas y bucle del agente |
| `src/llm` | Formato neutral de conversación y adaptadores para Claude y Gemini |
| `src/whatsapp` | Firma del webhook, parser y cliente de la Cloud API |
| `src/services` | Procesador de mensajes entrantes, panel y textos para el cliente |
| `src/repositories` | Acceso a datos con Prisma |
| `src/http` | Servidor Fastify: webhook y panel |
| `src/scripts` | Seed y simulador de chat |

## Limitaciones conocidas del piloto

- **Ventana de 24 horas de WhatsApp:** solo se pueden enviar mensajes libres a quien escribió en las últimas 24 h.
  Los avisos al personal fallan si el personal no le ha escrito al número del bot ese día. El sistema lo registra y
  sigue funcionando, porque el panel es la fuente de verdad. Solución sencilla: que el personal envíe "hola" al bot
  al abrir el local. En producción se usan plantillas aprobadas por Meta.
- **Número de prueba:** solo llega a los 5 teléfonos registrados. Para clientes reales hay que verificar la empresa
  en Meta y registrar un número propio.
- **La caché de prompts en Haiku 4.5 se activa desde 4096 tokens.** Con un menú pequeño puede no activarse en los
  primeros mensajes. Revisa `cacheReadTokens` en la tabla `Conversation` o el comando `/costo` del simulador.
- **Solo mensajes de texto y botones.** Las notas de voz, imágenes y ubicaciones reciben un aviso amable.
- **Una sola credencial de panel:** ve todos los restaurantes de la base. Sirve para un restaurante piloto. Antes de
  sumar otro local hay que agregar credenciales por restaurante.
- **Abre el panel solo por HTTPS** (la URL del túnel). La autenticación básica viaja en texto plano sobre HTTP.
- **Límite de 10 mensajes por minuto por cliente:** protege el gasto en tokens. El cliente recibe un único aviso.
- **Un mensaje que falla no se reprocesa:** si Claude o la base fallan, el cliente recibe una disculpa y debe
  reescribir. Los reintentos de Meta se descartan para no enviar respuestas duplicadas.
- **Un solo proceso:** la cola por cliente vive en memoria. Para varias instancias habría que pasar a Redis y PostgreSQL.
- **Políticas de Meta:** el agente está limitado a temas del restaurante, como exige Meta para bots de negocio.
