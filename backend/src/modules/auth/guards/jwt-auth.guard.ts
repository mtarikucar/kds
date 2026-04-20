import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { shouldBypassGlobalAuth } from '../../../common/helpers/guard-bypass.helper';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (shouldBypassGlobalAuth(this.reflector, context)) {
      return true;
    }
    return super.canActivate(context);
  }
}
