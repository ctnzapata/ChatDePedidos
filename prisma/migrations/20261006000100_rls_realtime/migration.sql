-- Seguridad a nivel de fila (RLS) y Realtime para el panel administrativo.
--
-- Modelo de acceso:
--   * El backend (Fastify + Prisma) se conecta como dueño de las tablas y no está sujeto a RLS.
--   * Los usuarios del panel (rol `authenticated` de Supabase) solo pueden LEER, y solo datos
--     de los restaurantes donde son personal activo. Ninguna política permite escribir:
--     todas las escrituras pasan por la API, que valida reglas de negocio.
--   * OWNER y STAFF ven todo su restaurante; COURIER solo los pedidos que tiene asignados.
--   * El rol `anon` (llave pública sin sesión) no ve nada.

-- ---------------------------------------------------------------------------
-- Vínculo con Supabase Auth
-- ---------------------------------------------------------------------------
ALTER TABLE "staff_members"
  ADD CONSTRAINT "staff_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users ("id") ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Funciones auxiliares. SECURITY DEFINER evita recursión de RLS sobre staff_members.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_role_in(target_restaurant uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text
  FROM public.staff_members
  WHERE user_id = auth.uid() AND restaurant_id = target_restaurant AND is_active
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_back_office(target_restaurant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.staff_role_in(target_restaurant) IN ('OWNER', 'STAFF'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_my_staff_record(staff_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members
    WHERE id = staff_id AND user_id = auth.uid() AND is_active
  )
$$;

REVOKE ALL ON FUNCTION public.staff_role_in(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_back_office(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_my_staff_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_role_in(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_back_office(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_staff_record(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Activar RLS en TODAS las tablas del esquema public (incluida la de Prisma).
-- Una tabla con RLS y sin política no expone ninguna fila.
-- ---------------------------------------------------------------------------
ALTER TABLE "restaurants"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_members"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_categories"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_items"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_modifiers"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_MenuItemModifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Defensa en profundidad: aunque una política fallara, estos roles no pueden escribir.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- ---------------------------------------------------------------------------
-- Políticas de lectura
-- ---------------------------------------------------------------------------
CREATE POLICY "staff lee sus restaurantes" ON "restaurants"
  FOR SELECT TO authenticated
  USING (public.staff_role_in(id) IS NOT NULL);

-- Cada usuario ve su propia membresía; OWNER/STAFF ven al equipo (para asignar domiciliarios).
CREATE POLICY "staff lee equipo" ON "staff_members"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_back_office(restaurant_id));

CREATE POLICY "back office lee categorias" ON "menu_categories"
  FOR SELECT TO authenticated USING (public.is_back_office(restaurant_id));

CREATE POLICY "back office lee productos" ON "menu_items"
  FOR SELECT TO authenticated USING (public.is_back_office(restaurant_id));

CREATE POLICY "back office lee adiciones" ON "menu_modifiers"
  FOR SELECT TO authenticated USING (public.is_back_office(restaurant_id));

-- Tabla implícita de Prisma: "A" = menu_items.id, "B" = menu_modifiers.id.
CREATE POLICY "back office lee adiciones por producto" ON "_MenuItemModifiers"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM "menu_items" i WHERE i.id = "A" AND public.is_back_office(i.restaurant_id)));

CREATE POLICY "back office lee clientes" ON "customers"
  FOR SELECT TO authenticated USING (public.is_back_office(restaurant_id));

CREATE POLICY "back office lee conversaciones" ON "conversations"
  FOR SELECT TO authenticated USING (public.is_back_office(restaurant_id));

CREATE POLICY "back office lee mensajes" ON "messages"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "conversations" c
    WHERE c.id = conversation_id AND public.is_back_office(c.restaurant_id)
  ));

-- El domiciliario solo ve los pedidos que tiene asignados (con dirección y teléfono del cliente).
CREATE POLICY "staff lee pedidos" ON "orders"
  FOR SELECT TO authenticated
  USING (
    public.is_back_office(restaurant_id)
    OR (assigned_courier_id IS NOT NULL AND public.is_my_staff_record(assigned_courier_id))
  );

-- Hereda la visibilidad del pedido (la subconsulta aplica la política de "orders").
CREATE POLICY "staff lee items de pedidos visibles" ON "order_items"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM "orders" o WHERE o.id = order_id));

-- ---------------------------------------------------------------------------
-- Realtime: el panel escucha cambios de pedidos y conversaciones (respeta RLS).
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE "orders", "conversations";
