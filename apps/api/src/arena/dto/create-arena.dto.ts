import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  Length,
  ValidateNested,
} from 'class-validator';

export enum ArenaHostModeDto {
  MANUAL = 'MANUAL',
  AUTO = 'AUTO',
}

// 1 lát cắt trong tỷ lệ trộn đề: lấy `count` câu ngẫu nhiên từ ngân hàng câu
// hỏi thuộc lĩnh vực `subjectId` (bỏ trống = câu chưa phân lĩnh vực). Web đã
// quy đổi % → số câu (thuật toán số dư lớn nhất, giống trang Bộ đề) trước khi
// gửi lên — server chỉ cần cộng dồn `count` để biết tổng số câu của phiên.
export class ArenaMixSlotDto {
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsInt()
  @Min(1)
  count: number;
}

export class CreateArenaDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  // Chọn 1 trong 2 cách nạp câu hỏi: `quizId` (bộ đề có sẵn) HOẶC `mixSlots`
  // (trộn ngẫu nhiên theo tỷ lệ lĩnh vực từ ngân hàng câu hỏi) — ArenaService
  // tự kiểm tra phải có đúng 1 trong 2, không cả hai cũng không thiếu cả hai.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  quizId?: string;

  // Tên hiển thị cho bộ đề trộn tự động (tuỳ chọn) — chỉ dùng khi có mixSlots.
  @IsOptional()
  @IsString()
  mixName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ArenaMixSlotDto)
  mixSlots?: ArenaMixSlotDto[];

  @IsOptional()
  @IsEnum(ArenaHostModeDto)
  hostMode?: ArenaHostModeDto;

  // Mật khẩu phòng — tuỳ chọn, admin bật thêm nếu muốn chặn người ngoài quét QR/link vào tự do
  @IsOptional()
  @IsString()
  @Length(4, 20)
  passcode?: string;

  // @deprecated — dùng questionDurationSec. Giữ lại để không vỡ client cũ.
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  autoAdvanceSec?: number;

  // Thời gian trả lời mỗi câu (giây) — áp dụng cho CẢ MANUAL và AUTO, server
  // tự chốt deadline và tự khoá/công bố khi hết giờ.
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  questionDurationSec?: number;

  // Khoảng dừng xem kết quả trước khi tự sang câu kế — chỉ dùng ở chế độ AUTO
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(30)
  revealPauseSec?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  pointsForRank?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  penaltyWrong?: number;

  // Danh sách userId được mời — tuỳ chọn. Có >=1 phần tử thì phòng trở thành
  // allowlist: chỉ những userId này mới join được, người khác bị từ chối dù
  // có đúng mã/mật khẩu.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  invitedUserIds?: string[];

  // Tên các đội đặt trước — tuỳ chọn, tối đa 10 đội. Có >=1 tên thì lúc join
  // người chơi bắt buộc chọn 1 trong các đội này (không được tự gõ tên đội
  // mới), mỗi đội tối đa 5 người.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  presetTeamNames?: string[];
}
