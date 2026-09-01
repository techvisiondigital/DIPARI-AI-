import { Module, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ProfileCompletedGuard } from './profile-completed.guard';
import { BusinessAccessGuard } from './business-access.guard';

/**
 * Resolves the JWT signing secret.
 *
 * This used to fall back to a literal written in this file. Any secret in the
 * repository is public: anyone who can read the source can forge a token for
 * any user, including an ADMIN. In production we now refuse to start rather
 * than run with a known key. In development we generate a random one — tokens
 * stop working across restarts, which is a minor annoyance and much safer than
 * a shared constant.
 */
function resolveJwtSecret(): string {
  const fromEnv = (process.env.JWT_SECRET || '').trim();

  if (fromEnv.length >= 32) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      fromEnv
        ? 'JWT_SECRET is set but too short — use at least 32 random characters.'
        : 'JWT_SECRET is not set. Refusing to start in production with an insecure signing key.',
    );
  }

  new Logger('AuthModule').warn(
    'JWT_SECRET not set — generating a random development secret. Tokens will not survive a restart.',
  );
  return randomBytes(48).toString('hex');
}

@Module({
  imports: [
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [AuthService, JwtAuthGuard, RolesGuard, ProfileCompletedGuard, BusinessAccessGuard],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard, RolesGuard, ProfileCompletedGuard, BusinessAccessGuard, JwtModule],
})
export class AuthModule {}
