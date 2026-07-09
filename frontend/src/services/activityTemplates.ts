import client from '../api/client';
import { extractApiErrorMessage } from '../utils/apiError';

/** Plantilla maestra del catálogo de actividades (Finanzas / Calendario). */
export type ActivityTemplate = {
  id: number;
  code: string;
  name: string;
  description?: string;
  activity_type: string;
  priority: string;
  text_color: string;
  icon?: string;
  sort_order: number;
  is_validatable: boolean;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ActivityTemplateCreateInput = {
  name: string;
  description?: string;
  activity_type: string;
  priority?: string;
  text_color?: string;
  icon?: string;
  sort_order?: number;
  is_validatable?: boolean;
  active?: boolean;
};

export type ActivityTemplateUpdateInput = Partial<ActivityTemplateCreateInput>;

export type ActivityTemplateActiveFilter = 'all' | 'active' | 'inactive';

export type ActivityTemplateListParams = {
  /** @deprecated usar activeFilter */
  activeOnly?: boolean;
  activeFilter?: ActivityTemplateActiveFilter;
  /** Filtro local por código (case-insensitive). */
  codeSearch?: string;
  /** Filtro local por nombre (case-insensitive). */
  nameSearch?: string;
  /** Filtro local por código o nombre (case-insensitive). */
  search?: string;
};

function unwrap<T>(res: { data: { data: T } }): T {
  return res.data.data;
}

function resolveActiveFilter(params: ActivityTemplateListParams): ActivityTemplateActiveFilter {
  if (params.activeFilter) return params.activeFilter;
  if (params.activeOnly) return 'active';
  return 'all';
}

function applyListFilters(rows: ActivityTemplate[], params: ActivityTemplateListParams): ActivityTemplate[] {
  const activeFilter = resolveActiveFilter(params);
  let out = rows;
  if (activeFilter === 'inactive') {
    out = out.filter((t) => !t.active);
  }
  const codeQ = params.codeSearch?.trim().toLowerCase();
  if (codeQ) {
    out = out.filter((t) => t.code.toLowerCase().includes(codeQ));
  }
  const nameQ = params.nameSearch?.trim().toLowerCase();
  if (nameQ) {
    out = out.filter((t) => t.name.toLowerCase().includes(nameQ));
  }
  const searchQ = params.search?.trim().toLowerCase();
  if (searchQ) {
    out = out.filter(
      (t) => t.code.toLowerCase().includes(searchQ) || t.name.toLowerCase().includes(searchQ),
    );
  }
  return out;
}

/** Mensaje de error legible para operaciones del catálogo. */
export function activityTemplateApiError(err: unknown, fallback: string): string {
  return extractApiErrorMessage(err, fallback);
}

export const activityTemplatesService = {
  async list(params: ActivityTemplateListParams = {}): Promise<ActivityTemplate[]> {
    const activeFilter = resolveActiveFilter(params);
    const res = await client.get<{ data: ActivityTemplate[] }>('/finance/activity-templates', {
      params: activeFilter === 'active' ? { active: '1' } : undefined,
    });
    const rows = res.data.data ?? [];
    return applyListFilters(rows, { ...params, activeFilter });
  },

  async get(id: number): Promise<ActivityTemplate> {
    const res = await client.get<{ data: ActivityTemplate }>(`/finance/activity-templates/${id}`);
    return unwrap(res);
  },

  async previewNextCode(): Promise<string> {
    const res = await client.get<{ data: { code: string } }>('/finance/activity-templates/next-code');
    return unwrap(res).code;
  },

  async create(input: ActivityTemplateCreateInput): Promise<ActivityTemplate> {
    const res = await client.post<{ data: ActivityTemplate }>('/finance/activity-templates', {
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      activity_type: input.activity_type,
      priority: input.priority,
      text_color: input.text_color,
      icon: input.icon?.trim() ?? '',
      sort_order: input.sort_order ?? 0,
      is_validatable: input.is_validatable,
      active: input.active,
    });
    return unwrap(res);
  },

  async update(id: number, input: ActivityTemplateUpdateInput): Promise<ActivityTemplate> {
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name.trim();
    if (input.description !== undefined) body.description = input.description.trim();
    if (input.activity_type !== undefined) body.activity_type = input.activity_type;
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.text_color !== undefined) body.text_color = input.text_color;
    if (input.icon !== undefined) body.icon = input.icon.trim();
    if (input.sort_order !== undefined) body.sort_order = input.sort_order;
    if (input.is_validatable !== undefined) body.is_validatable = input.is_validatable;
    if (input.active !== undefined) body.active = input.active;

    const res = await client.put<{ data: ActivityTemplate }>(`/finance/activity-templates/${id}`, body);
    return unwrap(res);
  },

  async setActive(id: number, active: boolean): Promise<ActivityTemplate> {
    const res = await client.patch<{ data: ActivityTemplate }>(`/finance/activity-templates/${id}/active`, {
      active,
    });
    return unwrap(res);
  },

  async remove(id: number): Promise<void> {
    await client.delete(`/finance/activity-templates/${id}`);
  },
};
