import client from '../api/client';
import type { User } from '../types/dashboard';

export interface UserUpsertInput {
  username: string;
  name: string;
  email?: string;
  password?: string;
  role: string;
  active?: boolean;
  dni?: string;
  phone?: string;
  address?: string;
}

export type UserCreateResponse = User & { generated_password?: string };

export const usersService = {
  async list(): Promise<User[]> {
    const res = await client.get<{ data: User[] }>('/users');
    return res.data?.data ?? [];
  },

  async get(id: number): Promise<User> {
    const res = await client.get<User>(`/users/${id}`);
    return res.data;
  },

  async create(input: UserUpsertInput): Promise<UserCreateResponse> {
    const res = await client.post<UserCreateResponse>('/users', input);
    return res.data;
  },

  async update(id: number, input: UserUpsertInput): Promise<User> {
    const res = await client.put<User>(`/users/${id}`, input);
    return res.data;
  },

  async delete(id: number): Promise<void> {
    await client.delete(`/users/${id}`);
  },
};
