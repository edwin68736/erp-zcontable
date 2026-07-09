import client from '../api/client';

export type ActivityTemplateConfig = {
  id: number;
  code: string;
  name: string;
  activity_type: string;
  activity_rule_id?: number | null;
  active: boolean;
};

export const activityConfigurationService = {
  async listTemplates(): Promise<ActivityTemplateConfig[]> {
    const res = await client.get<{ data: ActivityTemplateConfig[] }>('/activity-templates');
    return res.data.data ?? [];
  },

  async setTemplateRule(templateId: number, activityRuleId: number | null): Promise<ActivityTemplateConfig> {
    const res = await client.patch<{ data: ActivityTemplateConfig }>(
      `/activity-templates/${templateId}/activity-rule`,
      { activity_rule_id: activityRuleId },
    );
    return res.data.data;
  },
};
