import client from '../api/client';
import type { ProductCategory } from './productCategories';

export type ProductKind = 'product' | 'service';

export type Product = {
  id: number;
  tukifac_item_id?: number | null;
  /** FK remota item_types en Tukifac (si viene del sync sellnow). */
  tukifac_item_type_id?: number | null;
  product_kind: ProductKind;
  product_category_id?: number | null;
  product_category?: ProductCategory | null;
  unit_type_id: string;
  category_id: number;
  description: string;
  name?: string | null;
  second_name?: string | null;
  warehouse_id: number;
  internal_id: string;
  barcode: string;
  item_code?: string | null;
  item_code_gs1?: string | null;
  stock: string;
  stock_min: string;
  currency_type_id: string;
  currency_type_symbol: string;
  sale_affectation_igv_type_id: string;
  price: number;
  calculate_quantity: boolean;
  has_igv: boolean;
  price_includes_igv: boolean;
  track_inventory: boolean;
  active: boolean;
  sale_unit_price: string;
  purchase_unit_price: string;
  apply_store: boolean;
  image_url?: string;
  tukifac_created_at?: string;
  tukifac_updated_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type ProductUpsertInput = {
  product_kind: ProductKind;
  product_category_id?: number | null;
  unit_type_id: string;
  category_id: number;
  description: string;
  name?: string | null;
  second_name?: string | null;
  warehouse_id: number;
  internal_id: string;
  barcode: string;
  item_code?: string | null;
  item_code_gs1?: string | null;
  stock: string;
  stock_min: string;
  currency_type_id: string;
  currency_type_symbol: string;
  sale_affectation_igv_type_id: string;
  price: number;
  calculate_quantity: boolean;
  has_igv: boolean;
  price_includes_igv: boolean;
  track_inventory: boolean;
  active: boolean;
  sale_unit_price: string;
  purchase_unit_price: string;
  apply_store: boolean;
};

export type PaginationMeta = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

export type TukifacSellnowItem = {
  id: number;
  item_type_id?: number | null;
  unit_type_id?: string;
  category_id?: number;
  description?: string;
  name?: string | null;
  internal_id?: string;
  barcode?: string;
  stock?: string | number;
  stock_min?: string | number;
  currency_type_id?: string;
  sale_affectation_igv_type_id?: string;
  price?: number;
  active?: boolean;
  sale_unit_price?: string;
  purchase_unit_price?: string;
  image_url?: string;
};

export const productsService = {
  async listPaged(params: {
    q?: string;
    kind?: string;
    active?: string;
    page: number;
    per_page: number;
  }): Promise<{ items: Product[]; pagination: PaginationMeta }> {
    const res = await client.get<{ data: Product[]; pagination: PaginationMeta }>('/products', { params });
    return {
      items: res.data?.data ?? [],
      pagination: res.data?.pagination ?? {
        page: params.page,
        per_page: params.per_page,
        total: 0,
        total_pages: 0,
      },
    };
  },

  async get(id: number): Promise<Product> {
    const res = await client.get<Product>(`/products/${id}`);
    return res.data;
  },

  async create(input: ProductUpsertInput): Promise<Product> {
    const res = await client.post<Product>('/products', input);
    return res.data;
  },

  async update(id: number, input: ProductUpsertInput): Promise<Product> {
    const res = await client.put<Product>(`/products/${id}`, input);
    return res.data;
  },

  async remove(id: number): Promise<void> {
    await client.delete(`/products/${id}`);
  },

  async syncTukifac(): Promise<{ created: number; updated: number }> {
    const res = await client.post<{ success?: boolean; data?: { created: number; updated: number } }>(
      '/products/sync-tukifac',
    );
    return {
      created: res.data?.data?.created ?? 0,
      updated: res.data?.data?.updated ?? 0,
    };
  },

  async listTukifacSellnow(): Promise<TukifacSellnowItem[]> {
    const res = await client.get<{ success?: boolean; data?: TukifacSellnowItem[] }>('/tukifac/sellnow/items');
    return res.data?.data ?? [];
  },
};
