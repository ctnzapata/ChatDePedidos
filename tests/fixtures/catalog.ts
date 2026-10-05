import type { MenuCatalog } from "../../src/domain/menu.ts";
import type { StorePolicy } from "../../src/domain/checkout.ts";

export const catalog: MenuCatalog = {
  items: [
    {
      code: "HAM-SEN",
      name: "Hamburguesa sencilla",
      description: "Carne 150 g",
      category: "Hamburguesas",
      price: 18500,
      isAvailable: true,
      modifiers: [
        { code: "EXT-QUE", name: "Queso extra", price: 3000, isAvailable: true },
        { code: "EXT-TOC", name: "Tocineta", price: 4000, isAvailable: true },
        { code: "EXT-GUA", name: "Guacamole", price: 3500, isAvailable: false },
      ],
    },
    {
      code: "BEB-GAS",
      name: "Gaseosa 400 ml",
      description: "Sabores varios",
      category: "Bebidas",
      price: 4000,
      isAvailable: true,
      modifiers: [],
    },
    {
      code: "BEB-LIM",
      name: "Limonada de coco",
      description: "Cremosa",
      category: "Bebidas",
      price: 9000,
      isAvailable: false,
      modifiers: [],
    },
  ],
};

export const policy: StorePolicy = {
  deliveryFee: 5000,
  minOrderAmount: 15000,
  paymentMethods: ["CASH", "TRANSFER"],
};
