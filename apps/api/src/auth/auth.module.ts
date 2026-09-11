import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import {
  AdminSecurityController,
  SecurityController,
} from './security.controller';
import { AuthService } from './auth.service';
import { getJwtSecret } from './jwt-secret';
import { JwtStrategy } from './jwt.strategy';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as any },
    }),
    // Chỉ dùng cho endpoint đăng nhập (gắn thủ công qua @UseGuards trong
    // AuthController) — không đăng ký làm APP_GUARD toàn cục nên các API khác
    // không bị giới hạn tốc độ.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 5 }]),
  ],
  controllers: [AuthController, SecurityController, AdminSecurityController],
  providers: [AuthService, JwtStrategy, RolesGuard, LoginThrottlerGuard],
  exports: [JwtModule, RolesGuard],
})
export class AuthModule {}
