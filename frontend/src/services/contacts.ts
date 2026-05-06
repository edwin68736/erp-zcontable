import client from '../api/client';
import type { Contact } from '../types/dashboard';

export interface ContactUpsertInput {
  full_name: string;
  position: string;
  phone: string;
  email: string;
  priority: string;
  notes: string;
}

export const contactsService = {
  async listByCompany(companyID: number): Promise<Contact[]> {
    const res = await client.get<{ data: Contact[] }>(`/companies/${companyID}/contacts`);
    return res.data?.data ?? [];
  },

  async get(companyID: number, id: number): Promise<Contact> {
    const res = await client.get<Contact>(`/companies/${companyID}/contacts/${id}`);
    return res.data;
  },

  async create(companyID: number, input: ContactUpsertInput): Promise<Contact> {
    const res = await client.post<Contact>(`/companies/${companyID}/contacts`, input);
    return res.data;
  },

  async update(companyID: number, id: number, input: ContactUpsertInput): Promise<Contact> {
    const res = await client.put<Contact>(`/companies/${companyID}/contacts/${id}`, input);
    return res.data;
  },

  async delete(companyID: number, id: number): Promise<void> {
    await client.delete(`/companies/${companyID}/contacts/${id}`);
  },
};
