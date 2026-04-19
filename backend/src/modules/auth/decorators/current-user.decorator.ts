import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

/**
 * Read the authenticated user (or a field of it) off the request. Fails
 * loudly when the route did not have an auth guard, because propagating
 * `undefined` downstream produces misleading Prisma errors.
 */
export const CurrentUser = createParamDecorator((data: string, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const user = request.user;
  if (!user) {
    throw new InternalServerErrorException(
      'CurrentUser used on a route without an active auth guard',
    );
  }
  return data ? user[data] : user;
});
