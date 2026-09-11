# Tổng hợp tính năng đã triển khai

Tài liệu này ghi lại các tính năng đã hoàn thành trong đợt phát triển gần đây cho **3800Quiz** (và đã áp dụng tương tự cho **3800Quiz**, trừ khi ghi chú khác). Mục đích: giúp người sau (kể cả Claude ở phiên khác) nắm nhanh phạm vi đã làm mà không cần đọc lại toàn bộ lịch sử commit.

> Quy ước trạng thái: ✅ đã xong, kiểm thử đầy đủ (unit test + E2E qua HTTP thật) trên cả 2 dự án. 🔶 đã xong ở mức backend/logic nhưng chưa có giao diện riêng.

---

## 1. Hiển thị "Lĩnh vực" khi làm bài + pha chuẩn bị trong Đấu trường

- Khi cán bộ làm bài thi, phía trên câu hỏi hiện dòng "Lĩnh vực: …" (cả chế độ thi thường lẫn phản hồi tức thì).
- Trong Đấu trường, trước khi câu hỏi thật sự hiện ra, màn hình đếm ngược ~3 giây báo trước lĩnh vực (`arena.prepare` → `arena.question`, `ARENA_PREPARE_SEC` trong `arena.service.ts`) để các đội chuẩn bị tinh thần; trong lúc đó không đội nào bấm trả lời được (round vẫn ở trạng thái `PENDING`).
- File chính: `attempts.service.ts` (bổ sung `subjectName` vào snapshot cũ lúc đọc, không ghi đè `QuizVersion`), `arena.service.ts`/`arena.gateway.ts`, `QuizPlayerPage.tsx`, `InstantQuizPlayer.tsx`, `ArenaPage.tsx`, `ArenaPlayerPage.tsx`.

**Trạng thái: ✅**

## 2. Cho phép thi lại nhiều lần (`Quiz.maxAttempts`)

- Thêm cấu hình "Cho phép thi lại tối đa bao nhiêu lần" khi tạo/sửa bộ đề (`Quiz.maxAttempts`, mặc định 1, `0` = không giới hạn).
- Chặn ở `attempts.service.ts:start()` bằng cách đếm số `QuizAttempt` đã `GRADED` theo `(userId, assignmentId)` — không dùng unique constraint vì cố tình cho phép nhiều lần nộp cho cùng 1 lượt giao bài.
- Chỉ cộng XP ở **lần nộp bài đầu tiên**; các lần thi lại sau vẫn được chấm/lưu điểm bình thường nhưng không cộng thêm XP (tránh cày điểm ảo).
- Báo cáo/gradebook lấy **điểm cao nhất** trong các lần thi làm kết quả chính thức (`admin.service.ts:getReports()` đánh dấu `isBestForUser`).

**Trạng thái: ✅**

## 3. Nhắc nghỉ ngơi sau 4 giờ sử dụng web

- `useScreenTimeReminder` (gắn ở `AppLayout.tsx`) cộng dồn thời gian tab ở trạng thái hiển thị (`visible`) vào `sessionStorage` — **không phải** thời gian đăng nhập. Quá 4 giờ thì bắn `notification.warning`, lặp lại mỗi 1 giờ tiếp theo.
- Logic tính mốc cảnh báo tách riêng ở `lib/screen-time.ts` (hàm thuần, test được không cần DOM).

**Trạng thái: ✅**

---

## Danh sách "20 việc" — tính năng hay ho còn thiếu trên web

Sau khi hoàn thành 3 mục trên, đã rà soát và đề xuất 20 tính năng bổ sung, triển khai theo thứ tự ưu tiên đã thống nhất. Toàn bộ 20/20 đã hoàn thành.

| # | Tên việc | Mô tả ngắn | File chính |
|---|---|---|---|
| 1 | Bản đồ điểm yếu theo lĩnh vực | Widget trên "Bài kiểm tra của tôi" — tổng hợp tỷ lệ đúng theo từng lĩnh vực từ lịch sử bài đã nộp, sắp yếu nhất lên đầu | `performance.service.ts` (module mới), `MyQuizzesPage.tsx` |
| 2 | Bảng xếp hạng công khai | Trang xếp hạng theo XP (toàn thời gian/tháng/tuần), mở cho mọi vai trò | `LeaderboardPage.tsx`, route `me/leaderboard` |
| 3 | Câu hỏi khởi động mỗi ngày | Mỗi ngày cả hệ thống chung 1 câu (chọn theo hàm băm ngày từ ngân hàng câu hỏi), đúng +5 XP, mỗi người 1 lần/ngày | `daily-question/` (module mới) |
| 4 | Luyện tập tự do | Chọn lĩnh vực + số câu, chấm ngay tại chỗ, **không** lưu lịch sử/không tính điểm chính thức | `practice/` (module mới), `PracticePage.tsx` |
| 5 | Ôn tập ngắt quãng (Spaced Repetition) | Tự gom câu từng trả lời sai (đọc từ `Submission`/`SubmissionAnswer`) thành thẻ ôn, thuật toán SM-2 rút gọn giãn dần khoảng ôn lại | `review/` (module mới), `ReviewPage.tsx` |
| 6 | Nhân bản bộ đề + gia hạn hàng loạt + import phân công qua Excel | 3 tiện ích quản trị cho trang Bộ đề/Phân công | `admin.service.ts` (`duplicateQuiz`, `extendAssignmentsByFilter`, `importAssignmentsFromExcel`) |
| 7 | Phân tích độ khó & độ phân biệt câu hỏi | Thống kê toàn hệ thống: câu quá dễ/quá khó/cần xem lại, độ phân biệt (so nhóm điểm cao/thấp) | `admin.service.ts:getQuestionAnalytics()`, `QuestionAnalyticsPage.tsx` |
| 8 | Lịch giao bài tự động định kỳ | Đặt lịch DAILY/WEEKLY/MONTHLY theo bộ đề + phòng ban (hoặc toàn bộ cán bộ); hệ thống tự kiểm tra mỗi giờ và tự tạo phân công | `assignment-schedule/` (module mới) |
| 9 | Quy trình duyệt câu hỏi mới | Câu hỏi ngân hàng do TRAINER tạo phải chờ ADMIN duyệt (`Question.approvalStatus`) mới được chọn vào bộ đề/Đấu trường; ADMIN tự tạo thì tự động duyệt | `question-approval/` (module mới), sửa `admin.service.ts` (chỗ tạo/import câu hỏi + `pickRandomToQuiz`), `arena.service.ts` (`buildMixedQuiz`) |
| 10 | Giám sát vi phạm khi làm bài | Danh sách các lần phát hiện rời tab/thoát toàn màn hình/cố sao chép đề, kèm bộ lọc | `admin.service.ts:getAttemptViolations()`, `AttemptViolationsPage.tsx` |
| 11 | Xu hướng điểm & tỷ lệ đạt theo thời gian | Dashboard nhóm theo tuần/tháng | `admin.service.ts:getReportTrends()`, `ReportTrendsPage.tsx` |
| 12 | So sánh hiệu suất chi nhánh/phòng ban | Bảng so sánh điểm trung bình, tỷ lệ đạt giữa các phòng ban | `admin.service.ts:getDepartmentPerformance()`, `DepartmentPerformancePage.tsx` |
| 13 | Cảnh báo sớm nguy cơ (at-risk staff) | Danh sách cán bộ có dấu hiệu tụt lại (điểm thấp/bỏ bài/không hoạt động) theo 3 nhóm quy tắc | `admin.service.ts:getAtRiskStaff()`, `AtRiskStaffPage.tsx` |
| 14 | Nhật ký quản trị (Audit log) | Ghi lại các thao tác xoá/reset mật khẩu hàng loạt kèm người thực hiện; **đã hoàn thiện nốt**: nhật ký đăng nhập ghi cả địa chỉ IP + User-Agent thật | `admin.service.ts` (nhiều hàm), `auth.service.ts:writeLoginAuditLog()`, `AuditLogsPage.tsx` |
| 15 | Khóa tài khoản tạm sau nhiều lần đăng nhập sai | Sai mật khẩu (hoặc sai mã 2 lớp) 5 lần liên tiếp → khóa 15 phút, đếm theo **tài khoản** (bổ sung cho giới hạn theo IP sẵn có). ADMIN mở khóa sớm được | `auth.service.ts` (`registerFailedAttempt`, `assertNotLocked`), `AdminSecurityPage.tsx` |
| 16 | Kiểm soát phiên đăng nhập nâng cao | Mỗi lần đăng nhập tạo 1 `UserSession` (kèm IP + User-Agent), JWT mang `sid`; `jwt.strategy.ts` kiểm tra phiên còn sống ở **mọi** request → thu hồi có hiệu lực **ngay lập tức**. Tự xem/đăng xuất thiết bị; ADMIN giám sát toàn hệ thống | `auth.service.ts`, `jwt.strategy.ts`, `security.controller.ts`, `SecurityPage.tsx`, `AdminSecurityPage.tsx` |
| 17 | Xác thực 2 lớp (TOTP) | Tự cài RFC 6238 bằng `crypto` của Node, **không thêm thư viện**. Đăng nhập 2 nhịp: `/auth/login` → `pendingToken` (5 phút, không gọi API được) → `/auth/login/verify-totp` → access token thật. Tắt 2FA bắt buộc nhập lại mật khẩu | `auth/totp.ts`, `auth.service.ts`, `LoginPage.tsx`, `SecurityPage.tsx` |
| 18 | Chế độ khán giả Đấu trường | Xem trực tiếp qua joinCode, không thuộc đội nào, không trả lời được — dùng chiếu màn hình lớn | `arena.gateway.ts:handleSpectate()`, `ArenaSpectatorPage.tsx`, route `/arena/spectate/:joinCode` |
| 19 | Xem lại chi tiết trận đấu | Xem lại toàn bộ diễn biến 1 phiên Đấu trường đã kết thúc | `ArenaReplayPage.tsx`, route `manage/arena/:id/replay` |
| 20 | Giải đấu nhiều vòng loại trực tiếp | Bốc thăm bảng đấu (số đội phải luỹ thừa của 2), mỗi trận **tái dùng nguyên** cỗ máy Đấu trường có sẵn (tạo `ArenaSession` với 2 đội preset) — không đụng `arena.service.ts`/`arena.gateway.ts`; đội thắng tự tiến vòng sau khi ADMIN chốt kết quả | `tournament/` (module mới), `TournamentsPage.tsx` |

**Trạng thái: 20/20 ✅**

### Lưu ý triển khai quan trọng cho việc 16/17

Token đăng nhập phát hành **trước** khi có kiểm soát phiên (việc 16) không mang `sid` nên sẽ bị `jwt.strategy.ts` từ chối. **Sau khi deploy bản này lên môi trường thật, mọi người phải đăng nhập lại một lần** — đây là đánh đổi có chủ ý, không phải lỗi.

---

## Gamification v2 — mở rộng hệ thống huy hiệu, cấp độ, chuỗi ngày

Nâng cấp toàn diện hệ thống game hoá (`gamification.service.ts`), hoàn thành song song với đợt "20 việc" ở trên và đã kiểm tra kỹ trước khi gộp vào nhánh chính.

- **Huy hiệu**: mở rộng từ 15 lên **31 mã cố định** + huy hiệu "Chuyên gia lĩnh vực" sinh động theo từng `Subject` thực tế (upsert theo tên lĩnh vực, tự thêm khi có lĩnh vực mới). Bổ sung **17 loại điều kiện** mới:
  - `fast_answer_count`, `flawless_session_speed` (nhóm **SPEED** mới) — dựa trên `QuizAttemptAnswer.answeredMs` (cột mới, ghi ở `saveAnswers()` lần đầu câu trả lời chuyển từ rỗng sang có nội dung, tính bằng đồng hồ SERVER) và `ArenaBuzz.responseMs` sẵn có.
  - `subject_mastery`, `lifetime_xp` (nhóm **MASTERY** mới).
  - `all_badges_except`, `first_time_pass`, `improved_retake`, `arena_win_streak`, `arena_early_joiner`, `department_rank`, `first_n_to_complete_quiz`, `activity_return`, `night_owl` (nhóm **SPECIAL** ẩn), `flawless_program`, `arena_participate_count`.
  - Sửa lại 4 điều kiện cũ gắn nhầm ý nghĩa (`arena_first`, `speed_demon`, `department_top`, `early_bird`) — giữ nguyên `code` để không phát sinh huy hiệu trùng cho user đã lỡ được cấp.
- **Phao cứu chuỗi ngày** (kiểu Duolingo streak freeze): nghỉ đúng 1 ngày mà còn phao thì tự động dùng 1 phao, giữ nguyên `currentStreak` thay vì reset về 1. Cấp lại 1 phao mỗi 30 ngày, dự trữ tối đa 2 (`UserProgress.streakFreezeCount`/`lastStreakFreezeGrantAt`). Thêm mốc thưởng streak 90 ngày (+1500 XP).
- **Đường cong cấp độ**: mở rộng 10 → **12 bậc**, tăng dần đều hơn (bỏ bước nhảy >2x đột ngột giữa 2 cấp liền kề của bảng cũ), giữ nguyên trần 10.000 XP ở cấp 10, thêm cấp 11-12 làm mục tiêu dài hạn.
- Kèm theo (không liên quan gamification, cùng đợt): thanh điều hướng nhanh "Xem lại bài làm" ở `QuizResultPage.tsx` — nút số câu màu xanh/đỏ theo đúng/sai, bấm để cuộn thẳng tới câu đó.

**Trạng thái: ✅**

---

## Ghi chú kỹ thuật chung

- **Không thêm thư viện mới** cho toàn bộ đợt này — TOTP tự cài bằng `crypto` của Node, không dùng `otplib`/`speakeasy`; không thêm thư viện lập lịch (`@nestjs/schedule`) cho việc 8, dùng `setInterval` trong service (cùng mẫu với `EXPIRY_SWEEP_INTERVAL_MS` có sẵn ở `attempts.service.ts`).
- **Module mới đều tự chứa** (`daily-question/`, `practice/`, `review/`, `assignment-schedule/`, `question-approval/`, `tournament/`) — tránh sửa các file lớn/nhạy cảm nhiều nhất có thể; nơi bắt buộc phải sửa (`admin.service.ts`, `arena.service.ts`, `auth.service.ts`, `jwt.strategy.ts`) chỉ thêm phần cần thiết, không refactor lan sang chỗ khác.
- **Kiểm thử**: mỗi tính năng đều có unit test (Jest, mock Prisma) + được xác minh lại bằng kịch bản E2E gọi HTTP thật vào stack dev (Docker) trước khi commit — đặc biệt với việc 15/16/17 (đụng lõi xác thực) đã kiểm tra kỹ: token bị thu hồi bị chặn ngay, `pendingToken` không gọi được API, khóa tài khoản trả đúng 403, vòng đời 2FA (bật → đăng nhập 2 bước → tắt) chạy đúng với mã TOTP sinh thật.
- **Áp dụng cho cả 3800Quiz và 3800Quiz** — 3800Quiz không có git repo nên không có bước commit riêng, chỉ áp dụng trực tiếp vào mã nguồn + chạy migration + rebuild Docker + kiểm thử lại. Các khác biệt hợp lệ giữa 2 dự án (tên chi nhánh/phòng ban, thương hiệu `3800Quiz`/`3800Quiz`, `UNIT_ORDER`...) đều được giữ nguyên khi port, không copy đè.
