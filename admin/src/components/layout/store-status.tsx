import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRestaurant } from "@/app/restaurant-context";
import { useApi } from "@/auth/use-me";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface StoreStatus {
  readonly isAcceptingOrders: boolean;
}

/** Pausar o reanudar la toma de pedidos del agente de WhatsApp. */
export function StoreStatusToggle() {
  const { membership } = useRestaurant();
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = ["store", membership.restaurantId];
  const { data, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => api.get<StoreStatus>(`/restaurants/${membership.restaurantId}/store`),
  });
  const mutation = useMutation({
    mutationFn: (isAcceptingOrders: boolean) =>
      api.post<StoreStatus>(`/restaurants/${membership.restaurantId}/accepting`, { isAcceptingOrders }),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      toast.success(result.isAcceptingOrders ? "Volviste a recibir pedidos" : "Pedidos en pausa");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  // Sin datos no se afirma nada: un "Recibiendo" falso es peor que un estado neutro.
  if (!data) {
    return isError ? (
      <button
        type="button"
        onClick={() => void refetch()}
        className="label-mono flex h-8 items-center gap-2 rounded-md border border-destructive/40 px-2.5 text-destructive hover:bg-destructive/10"
      >
        Sin conexión · Reintentar
      </button>
    ) : (
      <span className="label-mono flex h-8 items-center rounded-md border px-2.5 text-muted-foreground">Cargando…</span>
    );
  }
  const isOpen = data.isAcceptingOrders;

  return (
    <label
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2 rounded-md border pr-1.5 pl-2.5 transition-colors",
        isOpen ? "border-status-ready/30 bg-status-ready-soft" : "border-status-preparing/40 bg-status-preparing-soft",
      )}
    >
      <span className="relative flex size-2" aria-hidden>
        {isOpen && <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-ready opacity-60" />}
        <span className={cn("relative inline-flex size-2 rounded-full", isOpen ? "bg-status-ready" : "bg-status-preparing")} />
      </span>
      <span className="label-mono hidden text-foreground sm:inline">{isOpen ? "Recibiendo" : "En pausa"}</span>
      <Switch
        checked={isOpen}
        disabled={mutation.isPending}
        onCheckedChange={(checked) => mutation.mutate(checked)}
        aria-label="Recibir pedidos por WhatsApp"
      />
    </label>
  );
}
