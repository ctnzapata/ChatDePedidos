import { localHour } from "./hours.ts";
import { isActiveStatus, type OrderStatus } from "./order-status.ts";

const EXCLUDED_STATUSES: readonly OrderStatus[] = ["REJECTED", "CANCELLED"];
const TOP_ITEMS_LIMIT = 5;
const HOURS_PER_DAY = 24;

export interface OrderForMetrics {
  readonly status: OrderStatus;
  readonly total: number;
  readonly createdAt: Date;
  readonly items: readonly { readonly name: string; readonly quantity: number }[];
}

export interface DailySummary {
  /** Pedidos válidos del día (sin rechazados ni cancelados). */
  readonly ordersCount: number;
  readonly revenue: number;
  readonly averageTicket: number;
  /** Pedidos que aún no terminan (recibidos, en preparación, en camino…). */
  readonly activeCount: number;
  /** Ventas por hora local (índice 0–23). */
  readonly revenueByHour: readonly number[];
  readonly topItems: readonly { readonly name: string; readonly quantity: number }[];
}

export function summarizeDay(orders: readonly OrderForMetrics[], timeZone: string): DailySummary {
  const valid = orders.filter((o) => !EXCLUDED_STATUSES.includes(o.status));
  const revenue = valid.reduce((sum, o) => sum + o.total, 0);

  const revenueByHour = Array.from({ length: HOURS_PER_DAY }, () => 0);
  for (const order of valid) revenueByHour[localHour(order.createdAt, timeZone)]! += order.total;

  const quantities = new Map<string, number>();
  for (const item of valid.flatMap((o) => o.items)) {
    quantities.set(item.name, (quantities.get(item.name) ?? 0) + item.quantity);
  }
  const topItems = [...quantities.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
    .slice(0, TOP_ITEMS_LIMIT);

  return {
    ordersCount: valid.length,
    revenue,
    averageTicket: valid.length > 0 ? Math.round(revenue / valid.length) : 0,
    activeCount: valid.filter((o) => isActiveStatus(o.status)).length,
    revenueByHour,
    topItems,
  };
}
