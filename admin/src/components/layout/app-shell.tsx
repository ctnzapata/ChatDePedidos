import { Outlet, useLocation } from "react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";
import { UserMenu } from "./user-menu";
import { useSidebarPreference } from "./use-sidebar-preference";

/** Estructura del panel: barra lateral plegable (cajón en el celular), barra superior y contenido. */
export function AppShell() {
  const [isSidebarOpen, setSidebarOpen] = useSidebarPreference();
  const { pathname } = useLocation();

  return (
    <SidebarProvider open={isSidebarOpen} onOpenChange={setSidebarOpen}>
      <AppSidebar footer={<UserMenu />} />
      <SidebarInset className="min-w-0">
        <TopBar />
        <div className="flex-1 px-4 pt-6 pb-16 md:px-8 lg:px-12 lg:pt-10">
          <div key={pathname} className="mx-auto max-w-6xl animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            <Outlet />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
