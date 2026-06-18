import client from '../api/client';

export type ActivityRuleCompareMode = 'date' | 'datetime';

export interface ActivityRule {
  id: number;
  name: string;
  description?: string;
  compare_mode: ActivityRuleCompareMode;
  max_upload_time?: string;
  grace_days: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ActivityRuleInput {
  name: string;
  description?: string;
  compare_mode: ActivityRuleCompareMode;
  max_upload_time?: string;
  grace_days: number;
  active: boolean;
}

export interface ActivityRuleAudit {
  id: number;
  activity_rule_id: number;
  user_id: number;
  action: string;
  before_json?: string;
  after_json?: string;
  created_at: string;
}

export const activityRulesService = {
  async list(activeOnly = false): Promise<ActivityRule[]> {
    const res = await client.get<{ data: ActivityRule[] }>('/activity-rules', {
      params: activeOnly ? { active: '1' } : undefined,
    });
    return res.data.data ?? [];
  },

  async get(id: number): Promise<ActivityRule> {
    const res = await client.get<{ data: ActivityRule }>(`/activity-rules/${id}`);
    return res.data.data;
  },

  async create(input: ActivityRuleInput): Promise<ActivityRule> {
    const res = await client.post<{ data: ActivityRule }>('/activity-rules', input);
    return res.data.data;
  },

  async update(id: number, input: ActivityRuleInput): Promise<ActivityRule> {
    const res = await client.put<{ data: ActivityRule }>(`/activity-rules/${id}`, input);
    return res.data.data;
  },

  async remove(id: number): Promise<void> {
    await client.delete(`/activity-rules/${id}`);
  },

  async listAudits(id: number, limit = 50): Promise<ActivityRuleAudit[]> {
    const res = await client.get<{ data: ActivityRuleAudit[] }>(`/activity-rules/${id}/audits`, {
      params: { limit },
    });
    return res.data.data ?? [];
  },
};
