import { Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { MetaController, MetaPublicController, ApiMetaController } from './meta.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule supplies JwtAuthGuard and BusinessAccessGuard, which now protect
  // every Meta endpoint except the OAuth redirect and the lead webhook.
  imports: [AuthModule],
  controllers: [MetaPublicController, MetaController, ApiMetaController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
