import { useCallback, useState } from "react";

export const SIDEBAR_STORAGE_KEY = "panel.sidebarOpen";

function readStored(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Barra lateral expandida o plegada; se recuerda en este navegador. */
export function useSidebarPreference(): readonly [boolean, (open: boolean) => void] {
  const [isOpen, setIsOpen] = useState(readStored);

  // Identidad estable: el SidebarProvider la usa en sus dependencias (atajo Ctrl+B y contexto).
  const setOpen = useCallback((open: boolean): void => {
    setIsOpen(open);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open));
    } catch {
      // Sin almacenamiento disponible: se recuerda solo mientras la página esté abierta.
    }
  }, []);

  return [isOpen, setOpen] as const;
}
