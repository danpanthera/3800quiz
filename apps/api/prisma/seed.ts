import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // ── Cơ cấu tổ chức ─────────────────────────────────────────────────────
  // Chi nhánh cấp 1 (mã BRCD ngân hàng — 3800 là Hội Sở, còn lại là các chi nhánh Quảng Bình)
  const units = [
    { code: '01-HS',  name: 'Hội Sở' },
    { code: '02-LT',  name: 'CN Lệ Thủy' },
    { code: '03-QN',  name: 'CN Quảng Ninh' },
    { code: '04-QT',  name: 'CN Quảng Trung' },
    { code: '05-LTK', name: 'CN Lý Thường Kiệt' },
    { code: '06-THD', name: 'CN Trần Hưng Đạo' },
    { code: '07-LTT', name: 'CN Lý Thái Tổ' },
  ];
  const unitMap: Record<string, string> = {};
  for (const u of units) {
    const r = await prisma.department.upsert({ where: { code: u.code }, update: { name: u.name }, create: { code: u.code, name: u.name } });
    unitMap[u.code] = r.id;
  }

  // Phòng ban trực thuộc từng chi nhánh
  const subDepts = [
    // Hội Sở
    { code: '01-HS-BGD',    name: 'Ban Giám đốc',                     parent: '01-HS' },
    { code: '01-HS-KHDN',   name: 'Phòng Khách hàng Doanh nghiệp',    parent: '01-HS' },
    { code: '01-HS-KHCN',   name: 'Phòng Khách hàng Cá nhân',         parent: '01-HS' },
    { code: '01-HS-KHRR',   name: 'Phòng Kế hoạch và Quản lý rủi ro', parent: '01-HS' },
    { code: '01-HS-KTGSNB', name: 'Phòng Kiểm tra, Giám sát nội bộ',  parent: '01-HS' },
    { code: '01-HS-TH',     name: 'Phòng Tổng hợp',                   parent: '01-HS' },
    { code: '01-HS-KTNQ',   name: 'Phòng Kế toán và Ngân quỹ',        parent: '01-HS' },
    { code: '01-HS-IT',     name: 'Phòng Công nghệ Thông tin',        parent: '01-HS' },
    // CN Lệ Thủy — PGD Kiến Giang, Chợ Tràm, Mỹ Đức trực thuộc
    { code: '02-LT-BGD',   name: 'Ban Giám đốc',               parent: '02-LT' },
    { code: '02-LT-KH',    name: 'Phòng Khách hàng',           parent: '02-LT' },
    { code: '02-LT-KTNQ',  name: 'Phòng Kế toán và Ngân quỹ',  parent: '02-LT' },
    { code: '02-LT-PGDKG', name: 'Phòng Giao dịch Kiến Giang', parent: '02-LT' },
    { code: '02-LT-PGDCT', name: 'Phòng Giao dịch Chợ Tràm',   parent: '02-LT' },
    { code: '02-LT-PGDMD', name: 'Phòng Giao dịch Mỹ Đức',     parent: '02-LT' },
    // CN Quảng Ninh — PGD Nam Long, Dinh Mười trực thuộc
    { code: '03-QN-BGD',   name: 'Ban Giám đốc',              parent: '03-QN' },
    { code: '03-QN-KH',    name: 'Phòng Khách hàng',          parent: '03-QN' },
    { code: '03-QN-KTNQ',  name: 'Phòng Kế toán và Ngân quỹ', parent: '03-QN' },
    { code: '03-QN-PGDNL', name: 'Phòng Giao dịch Nam Long',  parent: '03-QN' },
    { code: '03-QN-PGDDM', name: 'Phòng Giao dịch Dinh Mười', parent: '03-QN' },
    // CN Quảng Trung
    { code: '04-QT-BGD',  name: 'Ban Giám đốc',              parent: '04-QT' },
    { code: '04-QT-KH',   name: 'Phòng Khách hàng',          parent: '04-QT' },
    { code: '04-QT-KTNQ', name: 'Phòng Kế toán và Ngân quỹ', parent: '04-QT' },
    // CN Lý Thường Kiệt
    { code: '05-LTK-BGD',  name: 'Ban Giám đốc',              parent: '05-LTK' },
    { code: '05-LTK-KH',   name: 'Phòng Khách hàng',          parent: '05-LTK' },
    { code: '05-LTK-KTNQ', name: 'Phòng Kế toán và Ngân quỹ', parent: '05-LTK' },
    // CN Trần Hưng Đạo — PGD Chợ Ga trực thuộc
    { code: '06-THD-BGD',   name: 'Ban Giám đốc',              parent: '06-THD' },
    { code: '06-THD-KH',    name: 'Phòng Khách hàng',          parent: '06-THD' },
    { code: '06-THD-KTNQ',  name: 'Phòng Kế toán và Ngân quỹ', parent: '06-THD' },
    { code: '06-THD-PGDCG', name: 'Phòng Giao dịch Chợ Ga',    parent: '06-THD' },
    // CN Lý Thái Tổ
    { code: '07-LTT-BGD',  name: 'Ban Giám đốc',              parent: '07-LTT' },
    { code: '07-LTT-KH',   name: 'Phòng Khách hàng',          parent: '07-LTT' },
    { code: '07-LTT-KTNQ', name: 'Phòng Kế toán và Ngân quỹ', parent: '07-LTT' },
  ];
  for (const s of subDepts) {
    await prisma.department.upsert({
      where: { code: s.code },
      update: { name: s.name, parentId: unitMap[s.parent] },
      create: { code: s.code, name: s.name, parentId: unitMap[s.parent] },
    });
  }

  // Phòng CNTT — phòng ban trực thuộc Hội Sở, dùng làm đơn vị mặc định cho tài khoản seed
  const dept = await prisma.department.upsert({
    where: { code: '01-HS-IT' },
    update: { name: 'Phòng Công nghệ Thông tin', parentId: unitMap['01-HS'] },
    create: { name: 'Phòng Công nghệ Thông tin', code: '01-HS-IT', parentId: unitMap['01-HS'] },
  });

  // Người dùng
  const adminHash = await bcrypt.hash('Abcd@1234', 10);
  const staffHash = await bcrypt.hash('Staff@1234', 10);

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminHash,
      fullName: 'Quản trị viên',
      email: 'admin@bank.local',
      role: 'ADMIN',
      departmentId: dept.id,
    },
  });

  await prisma.user.upsert({
    where: { username: 'nhanvien01' },
    update: {},
    create: {
      username: 'nhanvien01',
      passwordHash: staffHash,
      fullName: 'Nguyễn Văn A',
      email: 'nva@bank.local',
      role: 'STAFF',
      departmentId: dept.id,
    },
  });

  // Bài quiz
  const quiz = await prisma.quiz.upsert({
    where: { id: 'quiz-demo-001' },
    update: {},
    create: {
      id: 'quiz-demo-001',
      title: 'Kiểm tra nghiệp vụ tín dụng cơ bản',
      description: 'Quiz mẫu kiểm tra kiến thức tín dụng cơ bản cho nhân viên mới',
      topic: 'Tín dụng',
      durationMin: 30,
      passScore: 70,
      isActive: true,
    },
  });

  // Snapshot phiên bản quiz
  const qv = await prisma.quizVersion.upsert({
    where: { quizId_version: { quizId: quiz.id, version: 1 } },
    update: {},
    create: {
      quizId: quiz.id,
      version: 1,
      snapshot: { title: quiz.title, topic: quiz.topic },
    },
  });

  // Câu hỏi
  const q1 = await prisma.question.create({
    data: {
      quizId: quiz.id,
      content: 'Lãi suất cho vay thông thường được tính theo đơn vị nào?',
      questionType: 'SINGLE',
      points: 10,
      orderIndex: 1,
      options: {
        create: [
          { content: '%/năm', isCorrect: true, orderIndex: 1 },
          { content: 'VND/tháng', isCorrect: false, orderIndex: 2 },
          { content: 'USD/ngày', isCorrect: false, orderIndex: 3 },
          { content: 'Điểm/kỳ', isCorrect: false, orderIndex: 4 },
        ],
      },
    },
  });

  const q2 = await prisma.question.create({
    data: {
      quizId: quiz.id,
      content: 'Những tài liệu nào cần thiết khi thẩm định hồ sơ vay?',
      questionType: 'MULTIPLE',
      points: 20,
      orderIndex: 2,
      options: {
        create: [
          { content: 'CMND/CCCD', isCorrect: true, orderIndex: 1 },
          { content: 'Sổ hộ khẩu', isCorrect: true, orderIndex: 2 },
          { content: 'Giấy phép lái xe', isCorrect: false, orderIndex: 3 },
          { content: 'Hợp đồng lao động', isCorrect: true, orderIndex: 4 },
        ],
      },
    },
  });

  // Giao bài cho tài khoản nhân viên
  const staff = await prisma.user.findUnique({ where: { username: 'nhanvien01' } });
  if (staff) {
    await prisma.assignment.create({
      data: {
        quizId: quiz.id,
        userId: staff.id,
        startAt: new Date(),
        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      },
    });
  }

  console.log('✅ Seed hoàn thành:');
  console.log('  👤 admin / Abcd@1234 (role: ADMIN)');
  console.log('  👤 nhanvien01 / Staff@1234 (role: STAFF)');
  console.log('  📝 Quiz: Kiểm tra nghiệp vụ tín dụng cơ bản');
  console.log('  📋 Assignment: nhanvien01 → quiz demo (7 ngày)');

  // ── Gamification 2.0: đường cong 12 cấp, tăng dần đều hơn (không còn bước
  //    nhảy >2x đột ngột giữa 2 cấp liền kề như bảng 10 cấp cũ) — giữ trần
  //    10.000 XP ở cấp 10 để không đổi tổng công sức "max cấp cũ", thêm cấp
  //    11-12 làm mục tiêu dài hạn cho người đã đạt trần (tương đương "prestige"
  //    trong RPG, dịch sang bối cảnh phi giải trí — không reset, chỉ mở thêm).
  const levels = [
    { level: 1,  name: 'Tân binh',              minXp: 0,     color: '#9E9E9E' },
    { level: 2,  name: 'Học viên',               minXp: 150,   color: '#4CAF50' },
    { level: 3,  name: 'Học viên khá',           minXp: 420,   color: '#8BC34A' },
    { level: 4,  name: 'Học viên giỏi',          minXp: 850,   color: '#03A9F4' },
    { level: 5,  name: 'Chuyên viên',            minXp: 1500,  color: '#2196F3' },
    { level: 6,  name: 'Chuyên viên cấp cao',    minXp: 2400,  color: '#3F51B5' },
    { level: 7,  name: 'Chuyên gia',             minXp: 3600,  color: '#9C27B0' },
    { level: 8,  name: 'Chuyên gia xuất sắc',    minXp: 5200,  color: '#E91E63' },
    { level: 9,  name: 'Bậc thầy',               minXp: 7300,  color: '#FF5722' },
    { level: 10, name: 'Huyền thoại',            minXp: 10000, color: '#FFB300' },
    { level: 11, name: 'Cố vấn nghiệp vụ',       minXp: 13500, color: '#00897B' },
    { level: 12, name: 'Huyền thoại chi nhánh',  minXp: 18000, color: '#5D4037' },
  ];
  for (const l of levels) {
    await prisma.levelDefinition.upsert({
      where: { level: l.level },
      update: { name: l.name, minXp: l.minXp, color: l.color },
      create: l,
    });
  }
  console.log(`  🏆 ${levels.length} LevelDefinition seeded`);

  // ── Gamification 2.0: BadgeDefinition ──────────────────────────────────
  // 4 mã cũ (arena_first, speed_demon, department_top, early_bird) được SỬA
  // LẠI điều kiện — trước đây gắn nhầm sang arena_win_count/pass_count/
  // submission_count nên trao huy hiệu sai ý nghĩa tên gọi. Giữ nguyên `code`
  // để không phát sinh huy hiệu trùng lặp cho user đã lỡ được cấp trước đó.
  const badges = [
    // EXAM — giữ nguyên, đã đúng từ đầu
    { code: 'first_exam',    name: 'Bước đầu tiên',    description: 'Hoàn thành bài thi đầu tiên',              iconSlug: 'badge_first_exam',    category: 'EXAM'  as const, conditionJson: { type: 'submission_count', value: 1  }, xpBonus: 0   },
    { code: 'exam_10',       name: 'Siêng năng',        description: 'Hoàn thành 10 bài thi',                    iconSlug: 'badge_exam_10',       category: 'EXAM'  as const, conditionJson: { type: 'submission_count', value: 10 }, xpBonus: 50  },
    { code: 'exam_50',       name: 'Chăm chỉ',          description: 'Hoàn thành 50 bài thi',                    iconSlug: 'badge_exam_50',       category: 'EXAM'  as const, conditionJson: { type: 'submission_count', value: 50 }, xpBonus: 200 },
    { code: 'perfect_score', name: 'Hoàn hảo',          description: 'Đạt điểm tuyệt đối 100%',                  iconSlug: 'badge_perfect',       category: 'EXAM'  as const, conditionJson: { type: 'perfect_score',    value: 1  }, xpBonus: 100 },
    { code: 'pass_streak_5', name: 'Chuỗi thắng',       description: 'Đạt 5 bài liên tiếp',                      iconSlug: 'badge_pass_streak',   category: 'EXAM'  as const, conditionJson: { type: 'consecutive_pass', value: 5  }, xpBonus: 50  },

    // STREAK — mở rộng thêm mốc, cộng "Trở lại sau gián đoạn"
    { code: 'streak_3',      name: 'Khởi động',             description: 'Hoạt động liên tiếp 3 ngày',               iconSlug: 'badge_streak_3',   category: 'STREAK' as const, conditionJson: { type: 'streak_days',    value: 3  }, xpBonus: 0   },
    { code: 'streak_7',      name: 'Chuyên cần 7 ngày',     description: 'Hoạt động liên tiếp 7 ngày',               iconSlug: 'badge_streak_7',   category: 'STREAK' as const, conditionJson: { type: 'streak_days',    value: 7  }, xpBonus: 0   },
    { code: 'streak_30',     name: 'Kiên trì 30 ngày',      description: 'Hoạt động liên tiếp 30 ngày',              iconSlug: 'badge_streak_30',  category: 'STREAK' as const, conditionJson: { type: 'streak_days',    value: 30 }, xpBonus: 200 },
    { code: 'streak_90',     name: 'Bền bỉ 90 ngày',        description: 'Hoạt động liên tiếp 90 ngày',              iconSlug: 'badge_streak_90',  category: 'STREAK' as const, conditionJson: { type: 'streak_days',    value: 90 }, xpBonus: 800 },
    { code: 'activity_return', name: 'Trở lại sau gián đoạn', description: 'Quay lại hoạt động sau ≥14 ngày vắng mặt', iconSlug: 'badge_return',  category: 'STREAK' as const, conditionJson: { type: 'activity_return', value: 14 }, xpBonus: 20 },

    // ARENA — sửa arena_first, thêm 2 huy hiệu mới
    { code: 'arena_first',   name: 'Chiến binh',        description: 'Tham gia Đấu trường lần đầu',                  iconSlug: 'badge_arena_first',  category: 'ARENA' as const, conditionJson: { type: 'arena_participate_count', value: 1 }, xpBonus: 0   },
    { code: 'arena_winner',  name: 'Vô địch',           description: 'Thắng Đấu trường lần đầu',                     iconSlug: 'badge_arena_winner', category: 'ARENA' as const, conditionJson: { type: 'arena_win_count', value: 1 }, xpBonus: 100 },
    { code: 'arena_5wins',   name: 'Đấu sĩ',            description: 'Thắng 5 lần Đấu trường',                       iconSlug: 'badge_arena_5wins',  category: 'ARENA' as const, conditionJson: { type: 'arena_win_count', value: 5 }, xpBonus: 300 },
    { code: 'arena_win_streak_5', name: 'Bất bại Đấu trường', description: 'Thắng 5 trận liên tiếp, không thua giữa chừng', iconSlug: 'badge_win_streak', category: 'ARENA' as const, conditionJson: { type: 'arena_win_streak', value: 5 }, xpBonus: 400 },
    { code: 'arena_early_joiner', name: 'Người mở đường', description: 'Thuộc 10 người đầu tham gia 1 phiên Đấu trường mới', iconSlug: 'badge_pathfinder', category: 'ARENA' as const, conditionJson: { type: 'arena_early_joiner', value: 1, topN: 10 }, xpBonus: 40 },

    // SPEED — mới, "speed_demon" giữ code cũ nhưng đổi hẳn sang điều kiện tốc độ thật
    { code: 'speed_reflex',  name: 'Phản xạ nhanh',     description: 'Trả lời đúng dưới 5 giây, 10 lần',             iconSlug: 'badge_reflex',    category: 'SPEED' as const, conditionJson: { type: 'fast_answer_count', value: 10, maxMs: 5000, scope: 'both' }, xpBonus: 30  },
    { code: 'speed_demon',   name: 'Tia chớp',          description: 'Trả lời đúng dưới 3 giây, 15 lần',             iconSlug: 'badge_speed',     category: 'SPEED' as const, conditionJson: { type: 'fast_answer_count', value: 15, maxMs: 3000, scope: 'both' }, xpBonus: 80  },
    { code: 'speed_light',   name: 'Tốc độ ánh sáng',   description: 'Trả lời đúng dưới 1 giây trong Đấu trường, 5 lần (độ chính xác cả phiên ≥70%)', iconSlug: 'badge_lightning', category: 'SPEED' as const, conditionJson: { type: 'fast_answer_count', value: 5, maxMs: 1000, scope: 'arena', minAccuracy: 70 }, xpBonus: 200 },
    { code: 'flawless_speed', name: 'Song toàn',        description: '1 phiên Đấu trường: tốc độ trung bình dưới 6 giây VÀ không sai câu nào', iconSlug: 'badge_flawless_speed', category: 'SPEED' as const, conditionJson: { type: 'flawless_session_speed', value: 1, maxMs: 6000 }, xpBonus: 150 },

    // LEVEL — giữ nguyên
    { code: 'level_5',       name: 'Chuyên viên',       description: 'Đạt cấp độ 5',                                 iconSlug: 'badge_level_5',  category: 'LEVEL' as const, conditionJson: { type: 'level_reached', value: 5 },  xpBonus: 0   },
    { code: 'level_10',      name: 'Huyền thoại',       description: 'Đạt cấp độ 10',                                iconSlug: 'badge_level_10', category: 'LEVEL' as const, conditionJson: { type: 'level_reached', value: 10 }, xpBonus: 500 },

    // MASTERY — cột mốc XP trọn đời (per-subject mastery seed động ở dưới)
    { code: 'lifetime_xp_1000',  name: 'Học không ngừng I',   description: 'Tổng XP đạt 1.000',   iconSlug: 'badge_lifetime_1', category: 'MASTERY' as const, conditionJson: { type: 'lifetime_xp', value: 1000  }, xpBonus: 0    },
    { code: 'lifetime_xp_5000',  name: 'Học không ngừng II',  description: 'Tổng XP đạt 5.000',   iconSlug: 'badge_lifetime_2', category: 'MASTERY' as const, conditionJson: { type: 'lifetime_xp', value: 5000  }, xpBonus: 200  },
    { code: 'lifetime_xp_20000', name: 'Học không ngừng III', description: 'Tổng XP đạt 20.000',  iconSlug: 'badge_lifetime_3', category: 'MASTERY' as const, conditionJson: { type: 'lifetime_xp', value: 20000 }, xpBonus: 1000 },

    // PROGRESS — sửa department_top/early_bird, thêm tiến bộ cá nhân + "Toàn diện"
    { code: 'department_top', name: 'Ngôi sao phòng ban', description: 'Thuộc top 3 XP cao nhất phòng ban',            iconSlug: 'badge_dept_top',   category: 'PROGRESS' as const, conditionJson: { type: 'department_rank', value: 3 }, xpBonus: 100 },
    { code: 'early_bird',     name: 'Người tiên phong',   description: 'Thuộc 10 người đầu hoàn thành 1 bộ đề mới',   iconSlug: 'badge_early_bird', category: 'PROGRESS' as const, conditionJson: { type: 'first_n_to_complete_quiz', value: 1, topN: 10 }, xpBonus: 30 },
    { code: 'first_time_pass', name: 'Đạt ngay lần đầu', description: 'Pass ngay ở lần làm đầu tiên, 3 lần',          iconSlug: 'badge_first_try',  category: 'PROGRESS' as const, conditionJson: { type: 'first_time_pass', value: 3 }, xpBonus: 60 },
    { code: 'improved_retake', name: 'Tiến bộ vượt bậc', description: 'Điểm làm lại cao hơn lần đầu ít nhất 20 điểm %', iconSlug: 'badge_improve',  category: 'PROGRESS' as const, conditionJson: { type: 'improved_retake', value: 1, minDeltaPoints: 20 }, xpBonus: 60 },
    { code: 'all_badges',    name: 'Toàn diện',         description: 'Đã đạt mọi huy hiệu công khai khác',           iconSlug: 'badge_platinum',  category: 'PROGRESS' as const, conditionJson: { type: 'all_badges_except', value: 1 }, xpBonus: 1000 },

    // SPECIAL — ẩn (???), chỉ mang tính bất ngờ tích cực
    { code: 'flawless_program', name: '??? Không một câu sai', description: 'Mọi bộ đề đang mở đều đạt 100% điểm', iconSlug: 'badge_secret_flawless', category: 'SPECIAL' as const, conditionJson: { type: 'flawless_program', value: 1 }, xpBonus: 1500 },
    { code: 'night_owl',        name: '??? Ca đêm',           description: 'Hoàn thành bài thi ngoài giờ hành chính, 5 lần', iconSlug: 'badge_secret_night', category: 'SPECIAL' as const, conditionJson: { type: 'night_owl', value: 5 }, xpBonus: 50 },
  ];
  for (const b of badges) {
    await prisma.badgeDefinition.upsert({
      where: { code: b.code },
      update: { name: b.name, description: b.description, iconSlug: b.iconSlug, category: b.category, conditionJson: b.conditionJson, xpBonus: b.xpBonus },
      create: b,
    });
  }
  console.log(`  🏅 ${badges.length} BadgeDefinition seeded`);

  // ── MASTERY theo từng lĩnh vực (Subject) — sinh động theo dữ liệu thật,
  //    không hard-code tên lĩnh vực. Chạy lại seed sau khi thêm Subject mới
  //    sẽ tự bổ sung huy hiệu tương ứng (upsert, không tạo trùng).
  const subjects = await prisma.subject.findMany({ select: { id: true, name: true } });
  const slugify = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  for (const subject of subjects) {
    const code = `subject_mastery_${slugify(subject.name)}`;
    await prisma.badgeDefinition.upsert({
      where: { code },
      update: {
        name: `Chuyên gia ${subject.name}`,
        description: `Đạt trung bình ≥90% các bài thuộc lĩnh vực "${subject.name}" (tối thiểu 3 bài, dùng bộ đề mới nhất)`,
        iconSlug: 'badge_subject_mastery',
        category: 'MASTERY',
        conditionJson: { type: 'subject_mastery', subjectId: subject.id, minAvgScore: 90, minCount: 3, value: 1 },
        xpBonus: 150,
      },
      create: {
        code,
        name: `Chuyên gia ${subject.name}`,
        description: `Đạt trung bình ≥90% các bài thuộc lĩnh vực "${subject.name}" (tối thiểu 3 bài, dùng bộ đề mới nhất)`,
        iconSlug: 'badge_subject_mastery',
        category: 'MASTERY',
        conditionJson: { type: 'subject_mastery', subjectId: subject.id, minAvgScore: 90, minCount: 3, value: 1 },
        xpBonus: 150,
      },
    });
  }
  console.log(`  🎓 ${subjects.length} huy hiệu "Chuyên gia lĩnh vực" seeded theo Subject hiện có`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
