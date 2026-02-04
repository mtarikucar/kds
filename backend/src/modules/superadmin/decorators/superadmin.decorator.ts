import { SetMetadata, applyDecorators } from '@nestjs/common';

export const IS_SUPERADMIN_KEY = 'isSuperAdmin';
export const SuperAdmin = () => SetMetadata(IS_SUPERADMIN_KEY, true);

export const IS_SUPERADMIN_PUBLIC_KEY = 'isSuperAdminPublic';
export const SuperAdminPublic = () => SetMetadata(IS_SUPERADMIN_PUBLIC_KEY, true);

// Mark routes as SuperAdmin routes (skip global tenant guards)
export const IS_SUPERADMIN_ROUTE_KEY = 'isSuperAdminRoute';
export const SuperAdminRoute = () => SetMetadata(IS_SUPERADMIN_ROUTE_KEY, true);
