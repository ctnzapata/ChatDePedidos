import { localDayRange } from "../domain/hours.ts";
import { summarizeDay, type DailySummary } from "../domain/metrics.ts";
import type { OrderRepository } from "../repositories/order-repository.ts";
import type { RestaurantRepository } from "../repositories/restaurant-repository.ts";

export class MetricsService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly restaurants: RestaurantRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Resumen del día en curso según la zona horaria del restaurante. */
  async today(restaurantId: string): Promise<DailySummary | null> {
    const store = await this.restaurants.findById(restaurantId);
    if (!store) return null;
    const { start, end } = localDayRange(this.now(), store.timezone);
    const orders = await this.orders.listForMetrics(restaurantId, start, end);
    return summarizeDay(orders, store.timezone);
  }
}
