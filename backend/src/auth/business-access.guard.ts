import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';

/**
 * Asserts that the authenticated user may act on the `businessId` in the
 * request.
 *
 * Endpoints that take a businessId from the query string or body are otherwise
 * trivially exploitable: anyone holding any valid token — or, before this,
 * no token at all — could pass someone else's businessId and read their leads,
 * disconnect their Meta account, or launch campaigns that spend their budget.
 *
 * Must run AFTER JwtAuthGuard, which populates `request.user`.
 */
@Injectable()
export class BusinessAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      // JwtAuthGuard should have run first. If it did not, fail closed rather
      // than silently allowing the request through.
      throw new UnauthorizedException('Authentication required');
    }

    const businessId = request.query?.businessId || request.body?.businessId;
    if (!businessId) {
      throw new BadRequestException('Missing businessId');
    }

    if (user.role === 'ADMIN') {
      return true;
    }

    const memberships = Array.isArray(user.businesses) ? user.businesses : [];
    const hasAccess = memberships.some(
      (m: any) => m?.businessId === businessId || m?.business?.id === businessId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this business workspace.');
    }

    return true;
  }
}
