import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentSuperAdmin = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const superAdmin = request.superAdmin;

    return data ? superAdmin?.[data] : superAdmin;
  },
);
