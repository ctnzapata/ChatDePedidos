import { ChevronsUpDownIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useRestaurant } from "@/app/restaurant-context";
import { useAuth } from "@/auth/auth-provider";
import { useMe } from "@/auth/use-me";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { initials } from "@/lib/format";

/** Persona con sesión: apariencia y cerrar sesión. Vive al pie de la barra lateral. */
export function UserMenu() {
  const { signOut } = useAuth();
  const { data: me } = useMe();
  const { membership } = useRestaurant();
  const { theme, setTheme } = useTheme();
  const name = membership.displayName;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="gap-2.5 px-1.5 group-data-[collapsible=icon]:size-9!" aria-label={`Menú de usuario, ${name}`}>
              <Avatar className="size-7 rounded-md after:rounded-md">
                <AvatarFallback className="rounded-md bg-sidebar-accent text-[0.7rem] font-semibold text-sidebar-accent-foreground">
                  {initials(name)}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium text-sidebar-accent-foreground">{name}</span>
                <span className="truncate text-xs text-sidebar-muted">{me?.email}</span>
              </span>
              <ChevronsUpDownIcon className="ml-auto text-sidebar-muted group-data-[collapsible=icon]:hidden" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-60">
            <DropdownMenuLabel className="label-mono text-muted-foreground">Apariencia</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">
                <SunIcon aria-hidden /> Claro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <MoonIcon aria-hidden /> Oscuro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <MonitorIcon aria-hidden /> Según el sistema
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOutIcon aria-hidden /> Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
