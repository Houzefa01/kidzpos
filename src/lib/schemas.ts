import { z } from "zod";

export const StoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
});

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  stock: z.number(),
  storeId: z.string(),
  category: z.string().optional(),
  sku: z.string(),
  createdAt: z.string(),
});

export const SaleItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.number(),
  price: z.number(),
});

export const SaleSchema = z.object({
  id: z.string(),
  seq: z.number().default(0),
  storeId: z.string(),
  userId: z.string(),
  userName: z.string(),
  items: z.array(SaleItemSchema),
  subtotal: z.number(),
  tax: z.number(),
  taxRate: z.number(),
  discount: z.number(),
  total: z.number(),
  date: z.string(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  pointsEarned: z.number(),
  pointsRedeemed: z.number(),
  paymentMode: z.enum(["CASH", "CARD", "MIXED"]),
  amountPaid: z.number().optional(),
  change: z.number().optional(),
  refundedFrom: z.string().optional(),
});

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  points: z.number(),
  totalSpent: z.number(),
  visits: z.number(),
  createdAt: z.string(),
});

export const SettingsSchema = z.object({
  taxRate: z.number(),
  maxDiscountPercent: z.number(),
  pointsPerEuro: z.number(),
  euroPerPoint: z.number(),
  shopName: z.string(),
  currency: z.enum(["AR", "EUR"]).default("AR"),
});

export const BackupSchema = z.object({
  stores: z.array(StoreSchema),
  products: z.array(ProductSchema),
  sales: z.array(SaleSchema),
});
export type Backup = z.infer<typeof BackupSchema>;

export const ProductCsvRowSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  price: z.coerce.number().positive(),
  stock: z.coerce.number().int().nonnegative().default(0),
  category: z.string().optional(),
  storeId: z.string().min(1),
});
