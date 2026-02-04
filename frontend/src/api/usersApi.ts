import api from '../lib/api';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'MANAGER' | 'WAITER' | 'KITCHEN' | 'COURIER';
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING_APPROVAL';
  approvedAt?: string;
  approvedById?: string;
  approvedBy?: { id: string; firstName: string; lastName: string };
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'MANAGER' | 'WAITER' | 'KITCHEN' | 'COURIER';
}

export interface UpdateUserData {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: 'ADMIN' | 'MANAGER' | 'WAITER' | 'KITCHEN' | 'COURIER';
  status?: 'ACTIVE' | 'INACTIVE';
}

export const usersApi = {
  async getAll(): Promise<User[]> {
    const response = await api.get('/users');
    return response.data;
  },

  async getById(id: string): Promise<User> {
    const response = await api.get(`/users/${id}`);
    return response.data;
  },

  async create(data: CreateUserData): Promise<User> {
    const response = await api.post('/users', data);
    return response.data;
  },

  async update(id: string, data: UpdateUserData): Promise<User> {
    const response = await api.patch(`/users/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/users/${id}`);
  },

  async approveUser(id: string): Promise<User> {
    const response = await api.patch(`/users/${id}/approve`);
    return response.data;
  },

  async rejectUser(id: string): Promise<void> {
    await api.patch(`/users/${id}/reject`);
  },

  async reactivateUser(id: string): Promise<User> {
    const response = await api.patch(`/users/${id}/reactivate`);
    return response.data;
  },
};
