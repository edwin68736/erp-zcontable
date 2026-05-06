import client from '../api/client';
import type { PlanCategory } from '../types/dashboard';

export interface PlanCategoryUpsertInput {
  code: string;
  name: string;
  description?: string;
  sort_order?: number;
  active?: boolean;
}

export const planCategoriesService = {
  async list(): Promise<PlanCategory[]> {
    const res = await client.get<{ data: PlanCategory[] }>('/plan-categories');
    return res.data?.data ?? [];
  },

  async get(id: number): Promise<PlanCategory> {
    const res = await client.get<PlanCategory>(`/plan-categories/${id}`);
    return res.data;
  },

  async create(input: PlanCategoryUpsertInput): Promise<PlanCategory> {
    const res = await client.post<PlanCategory>('/plan-categories', input);
    return res.data;
  },

  async update(id: number, input: PlanCategoryUpsertInput): Promise<PlanCategory> {
    const res = await client.put<PlanCategory>(`/plan-categories/${id}`, input);
    return res.data;
  },

  async delete(id: number): Promise<void> {
    await client.delete(`/plan-categories/${id}`);
  },
};
