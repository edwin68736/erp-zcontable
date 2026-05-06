import client from '../api/client';
import type { PlanTier, SubscriptionPlan } from '../types/dashboard';

export interface SubscriptionPlanCreateInput {
  plan_category_id: number;
  name: string;
  description?: string;
  billing_basis?: string;
  active?: boolean;
  tiers: PlanTier[];
}

export interface SubscriptionPlanUpdateInput {
  name?: string;
  description?: string;
  billing_basis?: string;
  active?: boolean;
}

export const subscriptionPlansService = {
  async list(categoryId?: number): Promise<SubscriptionPlan[]> {
    const res = await client.get<{ data: SubscriptionPlan[] }>('/subscription-plans', {
      params: categoryId ? { plan_category_id: categoryId } : {},
    });
    return res.data?.data ?? [];
  },

  async get(id: number): Promise<SubscriptionPlan> {
    const res = await client.get<SubscriptionPlan>(`/subscription-plans/${id}`);
    return res.data;
  },

  async create(input: SubscriptionPlanCreateInput): Promise<SubscriptionPlan> {
    const res = await client.post<SubscriptionPlan>('/subscription-plans', input);
    return res.data;
  },

  async update(id: number, input: SubscriptionPlanUpdateInput): Promise<SubscriptionPlan> {
    const res = await client.put<SubscriptionPlan>(`/subscription-plans/${id}`, input);
    return res.data;
  },

  async replaceTiers(id: number, tiers: PlanTier[]): Promise<SubscriptionPlan> {
    const res = await client.put<SubscriptionPlan>(`/subscription-plans/${id}/tiers`, { tiers });
    return res.data;
  },

  async delete(id: number): Promise<void> {
    await client.delete(`/subscription-plans/${id}`);
  },

  async runLiquidation(date?: string): Promise<{ created_documents: number; skipped: number; errors?: string[] }> {
    const res = await client.post('/liquidation/run', undefined, { params: date ? { date } : {} });
    return res.data;
  },
};
