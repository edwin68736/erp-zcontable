import client from '../api/client';

export type RoleRow = {
  id: number;
  code: string;
  name: string;
  description?: string;
  is_system: boolean;
  is_default?: boolean;
  user_count?: number;
  permission_count?: number;
  permissions?: { id: number; code: string }[];
};

export type ModuleRow = {
  id: number;
  code: string;
  name: string;
  icon?: string;
  sort_order: number;
  active: boolean;
  permissions?: { id: number; code: string; name: string; action: string; description?: string }[];
};

export type RoleCreateInput = {
  name: string;
  description?: string;
  /** Opcional; si se omite, el servidor genera un identificador interno. */
  code?: string;
};

export type RoleUpdateInput = {
  name: string;
  description?: string;
};

export const rolesService = {
  async list(): Promise<RoleRow[]> {
    const res = await client.get<{ success: boolean; data: RoleRow[] }>('/roles');
    return res.data.data ?? [];
  },

  async get(id: number): Promise<RoleRow> {
    const res = await client.get<{ success: boolean; data: RoleRow }>(`/roles/${id}`);
    return res.data.data as RoleRow;
  },

  async create(input: RoleCreateInput): Promise<RoleRow> {
    const res = await client.post<{ success: boolean; data: RoleRow }>('/roles', input);
    return res.data.data as RoleRow;
  },

  async update(id: number, input: RoleUpdateInput): Promise<RoleRow> {
    const res = await client.put<{ success: boolean; data: RoleRow }>(`/roles/${id}`, input);
    return res.data.data as RoleRow;
  },

  async remove(id: number): Promise<void> {
    await client.delete(`/roles/${id}`);
  },

  async getDefault(): Promise<RoleRow> {
    const res = await client.get<{ success: boolean; data: RoleRow }>('/roles/default');
    return res.data.data as RoleRow;
  },

  async setDefault(id: number): Promise<RoleRow> {
    const res = await client.put<{ success: boolean; data: RoleRow }>(`/roles/${id}/default`);
    return res.data.data as RoleRow;
  },

  async clone(id: number, input: { name: string; description?: string }): Promise<RoleRow> {
    const res = await client.post<{ success: boolean; data: RoleRow }>(`/roles/${id}/clone`, input);
    return res.data.data as RoleRow;
  },

  async catalog(): Promise<ModuleRow[]> {
    const res = await client.get<{ success: boolean; data: ModuleRow[] }>('/permissions/catalog');
    return res.data.data ?? [];
  },

  async replacePermissions(roleId: number, permissionIds: number[]): Promise<void> {
    await client.put(`/roles/${roleId}/permissions`, { permission_ids: permissionIds });
  },
};
