import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  users: { data: undefined as any, isLoading: false },
  activity: { data: undefined as any, isLoading: false },
  lastUsersArgs: undefined as any,
}));
vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useAllUsers: (args: unknown) => {
    h.lastUsersArgs = args;
    return h.users;
  },
  useUserActivity: () => h.activity,
}));

import AllUsersPage from './AllUsersPage';

beforeEach(() => {
  h.users.data = { data: [], meta: { page: 1, totalPages: 1 } };
  h.users.isLoading = false;
  h.activity.data = { data: [], meta: { page: 1, totalPages: 1 } };
  h.activity.isLoading = false;
  h.lastUsersArgs = undefined;
});

describe('AllUsersPage', () => {
  it('renders the header and starts on the users tab', () => {
    render(<AllUsersPage />);
    expect(
      screen.getByRole('heading', { name: 'users.title' }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('users.searchPlaceholder'),
    ).toBeInTheDocument();
  });

  it('renders user rows from the query', () => {
    h.users.data = {
      data: [
        {
          id: 'u1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@x.io',
          role: 'ADMIN',
        },
      ],
      meta: { page: 1, totalPages: 1 },
    };
    render(<AllUsersPage />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@x.io')).toBeInTheDocument();
  });

  it('feeds the search input value into the query params', () => {
    render(<AllUsersPage />);
    const search = screen.getByPlaceholderText('users.searchPlaceholder');
    fireEvent.change(search, { target: { value: 'ada' } });
    expect((search as HTMLInputElement).value).toBe('ada');
    expect(h.lastUsersArgs).toMatchObject({ search: 'ada' });
  });

  it('switches to the activity tab', () => {
    h.activity.data = {
      data: [
        {
          id: 'a1',
          action: 'login',
          user: { firstName: 'Bob', lastName: 'B', email: 'bob@x.io' },
        },
      ],
      meta: { page: 1, totalPages: 1 },
    };
    render(<AllUsersPage />);
    fireEvent.click(
      screen.getByRole('button', { name: 'users.tabLoginActivity' }),
    );
    expect(screen.getByText('Bob B')).toBeInTheDocument();
  });
});
