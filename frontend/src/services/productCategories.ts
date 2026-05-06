import client from '../api/client';

export type ProductCategory = {
  id: number;
  name: string;
  sort_order: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export const productCategoriesService = {
  async list(): Promise<ProductCategory[]> {
    const res = await client.get<{ data: ProductCategory[] }>('/product-categories');
    return res.data?.data ?? [];
  },

  async create(name: string, sort_order = 0): Promise<ProductCategory> {
    const res = await client.post<ProductCategory>('/product-categories', { name: name.trim(), sort_order });
    return res.data;
  },
};
