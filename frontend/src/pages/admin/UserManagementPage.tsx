import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UsersRound, UserPlus, Edit2, Trash2, AlertTriangle, Lock, Users, UserCheck, Shield, Briefcase, Clock, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usersApi, User, CreateUserData, UpdateUserData } from '../../api/usersApi';
import { UserRole, UserStatus } from '../../types';
import { toast } from 'sonner';
import { useAuthStore } from '../../store/authStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import UpgradePrompt from '../../components/subscriptions/UpgradePrompt';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';

const UserManagementPage = () => {
  const { t } = useTranslation(['common', 'subscriptions']);

  // Zod schema for user form
  const userSchema = z.object({
    email: z.string().email(t('admin.invalidEmail')),
    password: z.string().min(6, t('admin.passwordMinLength')).optional().or(z.literal('')),
    firstName: z.string().min(1, t('admin.firstNameRequired')),
    lastName: z.string().min(1, t('admin.lastNameRequired')),
    role: z.nativeEnum(UserRole),
  });

  type UserFormData = z.infer<typeof userSchema>;

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const currentUser = useAuthStore((state) => state.user);
  const { checkLimit } = useSubscription();

  // Check user limit
  const userLimit = checkLimit('maxUsers', users.length);
  const canAddUser = userLimit.allowed;

  // Calculate statistics
  const stats = useMemo(() => {
    return {
      total: users.length,
      active: users.filter(u => u.status === UserStatus.ACTIVE).length,
      pending: users.filter(u => u.status === UserStatus.PENDING_APPROVAL).length,
      admins: users.filter(u => u.role === UserRole.ADMIN).length,
      managers: users.filter(u => u.role === UserRole.MANAGER).length,
    };
  }, [users]);

  // Filter users by status
  const filteredUsers = useMemo(() => {
    if (statusFilter === 'all') return users;
    return users.filter(u => u.status === statusFilter);
  }, [users, statusFilter]);

  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      role: UserRole.WAITER,
    },
  });

  const roleOptions = [
    { value: UserRole.WAITER, label: t('admin.waiter') },
    { value: UserRole.KITCHEN, label: t('admin.kitchenStaff') },
    { value: UserRole.MANAGER, label: t('admin.manager') },
    { value: UserRole.ADMIN, label: t('admin.admin') },
    { value: UserRole.COURIER, label: t('admin.courier') },
  ];

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await usersApi.getAll();
      setUsers(data);
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('app:app.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      form.reset({
        email: user.email,
        password: '',
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role as UserRole,
      });
    } else {
      setEditingUser(null);
      form.reset({
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        role: UserRole.WAITER,
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingUser(null);
    form.reset();
  };

  const handleSubmit = async (data: UserFormData) => {
    try {
      if (editingUser) {
        const updateData: UpdateUserData = {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
        };
        if (data.password) {
          updateData.password = data.password;
        }
        await usersApi.update(editingUser.id, updateData);
        toast.success(t('app:app.success'));
      } else {
        const createData: CreateUserData = {
          email: data.email,
          password: data.password || '',
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
        };
        await usersApi.create(createData);
        toast.success(t('app:app.success'));
      }

      handleCloseModal();
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('app:app.error'));
    }
  };

  const handleDeleteClick = (user: User) => {
    setUserToDelete(user);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!userToDelete) return;

    try {
      await usersApi.delete(userToDelete.id);
      toast.success(t('admin.userDeletedSuccess'));
      setShowDeleteDialog(false);
      setUserToDelete(null);
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('admin.userDeleteFailed'));
    }
  };

  const getRoleBadgeColor = (role: UserRole) => {
    const colors: Record<UserRole, string> = {
      [UserRole.ADMIN]: 'bg-red-100 text-red-800',
      [UserRole.MANAGER]: 'bg-blue-100 text-blue-800',
      [UserRole.WAITER]: 'bg-green-100 text-green-800',
      [UserRole.KITCHEN]: 'bg-orange-100 text-orange-800',
      [UserRole.COURIER]: 'bg-purple-100 text-purple-800',
    };
    return colors[role] || 'bg-slate-100 text-slate-800';
  };

  const getStatusBadgeColor = (status: UserStatus | string) => {
    if (status === UserStatus.ACTIVE) return 'bg-green-100 text-green-800';
    if (status === UserStatus.PENDING_APPROVAL || status === 'PENDING_APPROVAL') return 'bg-amber-100 text-amber-800';
    return 'bg-slate-100 text-slate-800';
  };

  const handleApproveUser = async (user: User) => {
    try {
      await usersApi.approveUser(user.id);
      toast.success(t('admin.userApproved'));
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('admin.userApproveFailed'));
    }
  };

  const handleRejectUser = async (user: User) => {
    try {
      await usersApi.rejectUser(user.id);
      toast.success(t('admin.userRejected'));
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('admin.userRejectFailed'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">{t('app.loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
            <UsersRound className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold text-slate-900">{t('admin.userManagement')}</h1>
            <p className="text-slate-500 mt-0.5">{t('admin.manageStaff')}</p>
          </div>
        </div>
        <Button onClick={() => handleOpenModal()} disabled={!canAddUser}>
          {canAddUser ? (
            <UserPlus className="h-4 w-4 mr-2" />
          ) : (
            <Lock className="h-4 w-4 mr-2" />
          )}
          {t('admin.addUser')}
        </Button>
      </div>

      {/* User Limit Info Banner */}
      {userLimit.limit !== -1 && (
        <div
          className={`rounded-xl px-6 py-4 flex items-start gap-3 ${
            canAddUser
              ? 'bg-primary-50 border border-primary-200'
              : 'bg-amber-50 border border-amber-200'
          }`}
        >
          <AlertTriangle
            className={`h-5 w-5 mt-0.5 ${canAddUser ? 'text-primary-600' : 'text-amber-600'}`}
          />
          <div>
            <h3
              className={`font-semibold ${canAddUser ? 'text-primary-900' : 'text-amber-900'}`}
            >
              {t('admin.currentUsers')}: {users.length} / {userLimit.limit}
            </h3>
            <p
              className={`text-sm ${canAddUser ? 'text-primary-700' : 'text-amber-700'}`}
            >
              {canAddUser
                ? t('admin.subscriptionLimitInfo')
                : t('subscriptions:subscriptions.limitReachedDescription', {
                    resource: t('subscriptions:subscriptions.planLimits.users'),
                    current: users.length,
                    limit: userLimit.limit,
                  })}
            </p>
          </div>
        </div>
      )}

      {/* Upgrade Prompt when limit reached */}
      {!canAddUser && (
        <UpgradePrompt
          limitType="maxUsers"
          currentCount={users.length}
          limit={userLimit.limit}
        />
      )}

      {/* Statistics Overview */}
      {users.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* Total Users */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
              <Users className="w-6 h-6 text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
              <p className="text-sm text-slate-500">{t('admin.totalUsers')}</p>
            </div>
          </div>

          {/* Active Users */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
              <UserCheck className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{stats.active}</p>
              <p className="text-sm text-slate-500">{t('admin.activeUsers')}</p>
            </div>
          </div>

          {/* Pending Approval */}
          <div
            className={`bg-white rounded-xl border p-4 flex items-center gap-4 cursor-pointer transition-all ${
              stats.pending > 0 ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200/60'
            }`}
            onClick={() => stats.pending > 0 && setStatusFilter(statusFilter === 'PENDING_APPROVAL' ? 'all' : 'PENDING_APPROVAL')}
          >
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
              <p className="text-sm text-slate-500">{t('admin.pendingApproval')}</p>
            </div>
          </div>

          {/* Admins */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
              <Shield className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{stats.admins}</p>
              <p className="text-sm text-slate-500">{t('admin.admins')}</p>
            </div>
          </div>

          {/* Managers */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <Briefcase className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{stats.managers}</p>
              <p className="text-sm text-slate-500">{t('admin.managers')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            statusFilter === 'all'
              ? 'bg-primary-600 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          {t('admin.allUsers')} ({stats.total})
        </button>
        <button
          onClick={() => setStatusFilter('ACTIVE')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            statusFilter === 'ACTIVE'
              ? 'bg-emerald-600 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          {t('statuses.active')} ({stats.active})
        </button>
        {stats.pending > 0 && (
          <button
            onClick={() => setStatusFilter('PENDING_APPROVAL')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === 'PENDING_APPROVAL'
                ? 'bg-amber-600 text-white'
                : 'bg-white text-amber-600 border border-amber-300 hover:bg-amber-50'
            }`}
          >
            {t('admin.pendingApproval')} ({stats.pending})
          </button>
        )}
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-slate-200/60 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50/80">
              <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('admin.user')}
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('admin.email')}
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('admin.role')}
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('admin.status')}
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('admin.created')}
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('admin.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="group hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white font-semibold shadow-sm">
                      {user.firstName[0]}{user.lastName[0]}
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-slate-900">
                        {user.firstName} {user.lastName}
                      </div>
                      {currentUser?.id === user.id && (
                        <span className="text-xs text-primary-600">({t('admin.you')})</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                  {user.email}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${getRoleBadgeColor(user.role)}`}>
                    {t(`admin.roles.${user.role.toLowerCase()}`)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${getStatusBadgeColor(user.status)}`}>
                    {user.status === 'PENDING_APPROVAL' ? t('admin.pendingApproval') : t(`statuses.${user.status.toLowerCase()}`)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
                    {user.status === 'PENDING_APPROVAL' ? (
                      <>
                        <button
                          onClick={() => handleApproveUser(user)}
                          className="p-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                          title={t('admin.approveUser')}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRejectUser(user)}
                          className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                          title={t('admin.rejectUser')}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleOpenModal(user)}
                          className="p-2 text-slate-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(user)}
                          className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={currentUser?.id === user.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {filteredUsers.length === 0 && (
          <div className="py-16 text-center">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <UsersRound className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">
              {statusFilter === 'all' ? t('admin.noUsersFound') : t('admin.noUsersInFilter')}
            </h3>
            <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">
              {statusFilter === 'all' ? t('admin.noUsersFoundDescription') : t('admin.noUsersInFilterDescription')}
            </p>
            {statusFilter === 'all' && (
              <Button className="mt-6" onClick={() => handleOpenModal()} disabled={!canAddUser}>
                <UserPlus className="h-4 w-4 mr-2" />
                {t('admin.addFirstUser')}
              </Button>
            )}
            {statusFilter !== 'all' && (
              <Button className="mt-6" variant="outline" onClick={() => setStatusFilter('all')}>
                {t('admin.showAllUsers')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Create/Edit User Modal */}
      <Modal
        isOpen={showModal}
        onClose={handleCloseModal}
        title={editingUser ? t('admin.editUser') : t('admin.addNewUser')}
      >
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <Input
            label={t('admin.email')}
            type="email"
            placeholder={t('admin.emailPlaceholder')}
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />

          <Input
            label={editingUser ? `${t('admin.password')} (${t('admin.leaveBlankKeepCurrent')})` : t('admin.password')}
            type="password"
            placeholder={t('admin.passwordPlaceholder')}
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('admin.firstName')}
              placeholder={t('admin.firstNamePlaceholder')}
              error={form.formState.errors.firstName?.message}
              {...form.register('firstName')}
            />

            <Input
              label={t('admin.lastName')}
              placeholder={t('admin.lastNamePlaceholder')}
              error={form.formState.errors.lastName?.message}
              {...form.register('lastName')}
            />
          </div>

          {/* @ts-ignore: Pass props via any spread to avoid TS mismatch with custom Select */}
          <Select
            {...({
              label: t('admin.role'),
              options: roleOptions,
              error: form.formState.errors.role?.message,
              ...form.register('role'),
            } as any)}
          />

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleCloseModal}
            >
              {t('app:app.cancel')}
            </Button>
            <Button type="submit" className="flex-1">
              {editingUser ? t('app:app.update') : t('app:app.create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setUserToDelete(null);
        }}
        title={t('admin.deleteUser')}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{t('admin.deleteUser')}</h3>
              <p className="text-sm text-slate-500">{t('admin.actionCannotBeUndone')}</p>
            </div>
          </div>

          <p className="text-slate-700">
            {t('admin.confirmDeleteUser')} <strong>{userToDelete?.firstName} {userToDelete?.lastName}</strong>?
            {t('admin.permanentlyRemoveAccount')}
          </p>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowDeleteDialog(false);
                setUserToDelete(null);
              }}
            >
              {t('app:app.cancel')}
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleDeleteConfirm}
            >
              {t('admin.deleteUser')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default UserManagementPage;
