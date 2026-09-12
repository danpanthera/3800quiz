import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { getCorsOrigin } from './cors-origin';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Sau Caddy, req.ip mặc định là IP nội bộ của chính container Caddy (luôn
  // giống nhau) chứ không phải IP người dùng thật — làm LoginThrottlerGuard
  // (5 lần/phút) gộp CHUNG hạn mức cho toàn bộ người dùng thay vì tính riêng
  // từng người. Tin đúng 1 chặng proxy ngay trước app (Caddy) để req.ip lấy
  // đúng địa chỉ client từ X-Forwarded-For — Caddy tự thêm header này và
  // không có trusted_proxies nên client không tự giả IP được.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  // Mặc định của Express chỉ 100kb — bước "Xác nhận import" của ngân hàng câu
  // hỏi gửi nguyên JSON các dòng đã xem/sửa (không phải file), vài trăm câu
  // hỏi kèm đáp án/giải thích đã vượt quá dễ dàng (VD 240 câu ≈ 175kb) và bị
  // chặn 413 trước khi tới được validation. Không liên quan tới giới hạn
  // upload file Excel (Multer, 10MB, xem admin.module.ts).
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: getCorsOrigin() });
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
