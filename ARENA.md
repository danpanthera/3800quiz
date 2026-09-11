# Module Đấu trường (Arena)

Tài liệu này mô tả đầy đủ tính năng, kiến trúc và các cơ chế đảm bảo tính
**đúng đắn — công bằng — trực quan** của module Đấu trường (buzzer-round thi
đấu real-time theo đội).

## 1. Đấu trường là gì

Một chế độ thi đấu real-time theo đội, MC (giảng viên/admin) điều khiển từ
màn hình lớn, người chơi tham gia bằng điện thoại qua mã phòng 6 ký tự. Mỗi
câu hỏi: cả lớp cùng thấy, các đội cùng trả lời, ai đúng và nhanh nhất được
điểm cao nhất — theo mô hình kiểu Kahoot/Quizizz.

Vòng đời một phiên: **Tạo phòng (LOBBY)** → đội vào bằng join code → **MC bấm
Bắt đầu (RUNNING)** → lặp qua từng câu (chuẩn bị → hỏi → khoá → công bố) →
**Kết thúc (FINISHED)**, cộng XP/huy hiệu qua `gamification.service.ts`.

## 2. Luồng một câu hỏi, chi tiết từng bước

```
PENDING ──(nextQuestion)──► publish 'preparing'
                                  │  ARENA_PREPARE_SEC = 3 giây
                                  │  (hiện "Lĩnh vực: …", round vẫn PENDING
                                  │   nên recordAnswer/revealRound tự chối)
                                  ▼
                          showQuestion() ─► publish 'question'
                          round chuyển ACTIVE, chốt deadlineAt = startedAt + questionDurationSec
                                  │
                                  │  Server hẹn timer tại đúng deadlineAtMs
                                  │  (ArenaClockService — KHÔNG phải trình duyệt MC)
                                  │
              đội bấm trả lời ────┤──── hết giờ
              (arena.answer,      │
               server tự đo       ▼
               receivedAtMs,   publish 'locked'  (khoá nút mọi màn hình ngay)
               suy teamId          │
               từ membership)      │  chờ LOCK_GRACE_MS = 400ms
                                   │  (gói tin bấm sát nút kịp hạ cánh)
                                   ▼
                          revealRound() ─► publish 'revealed'
                          (transaction + CAS — idempotent, xem mục 4)
                          chấm điểm, xếp hạng tốc độ, cộng điểm, xây payload
                          kết quả TỪNG đội (đúng/sai/không trả lời)
                                   │
                    MANUAL: chờ MC bấm "Câu tiếp theo"
                    AUTO:   tự hẹn nextQuestion() sau revealPauseSec giây
                                   │
                                   ▼
                          round kế tiếp, hoặc endSession() nếu hết câu
```

MC vẫn có thể **công bố sớm** bất kỳ lúc nào (cả 2 chế độ) — hủy timer
deadline, publish `revealed` với `revealReason: 'HOST'`. Nếu MC bấm "Câu tiếp
theo" mà quên công bố, server tự chốt điểm trước với `revealReason:
'SKIPPED'` (không bao giờ mất điểm âm thầm).

## 3. Kiến trúc backend (`apps/api/src/arena/`)

### 3.1 Vì sao cần một event bus nội bộ

`ArenaService` (nghiệp vụ), `ArenaGateway` (broadcast WebSocket) và
`ArenaClockService` (hẹn giờ) phụ thuộc lẫn nhau nếu inject trực tiếp
(Service cần gọi Gateway để broadcast, Clock cần gọi lại Service để
reveal/next — vòng lặp DI). Giải pháp: một `Subject<ArenaOutgoing>`
(`arena-event-bus.ts`) không inject gì cả — Service chỉ `publish()`, Gateway
và Clock chỉ `subscribe()`. Đồ thị phụ thuộc trở thành DAG thuần.

```
                    ArenaEventBus (Subject<ArenaOutgoing>)
                    ▲                                    │
          publish() │                          subscribe()│
                     │                                    ▼
              ArenaService                    ArenaGateway · ArenaClockService
                     ▲                                    │
                     └──────────── inject ─────────────────┘
        (ArenaClockService gọi lại ArenaService.revealRound/nextQuestion)
```

### 3.2 Các file

| File | Vai trò |
|---|---|
| `arena.types.ts` | Hợp đồng dữ liệu dùng chung — mọi payload WebSocket + union `ArenaOutgoing` của bus nội bộ. **Có bản gương thủ công ở `apps/web/src/lib/arena-types.ts`** — 2 app không share build step, sửa file nào phải sửa file kia. |
| `arena.scoring.ts` | Hàm THUẦN, không phụ thuộc Prisma/Socket.IO — test trực tiếp không cần mock: `gradeArenaAnswer`, `computeResponseMs`, `rankAndScoreBuzzes`, `compareTeamsForRanking`, `buildTeamRoundResults`. |
| `arena-latency.service.ts` | Đo RTT từng socket, tính số ms cần bù trừ. |
| `arena-event-bus.ts` | `Subject<ArenaOutgoing>` — cầu nối publish/subscribe nội bộ. |
| `arena-clock.service.ts` | Hẹn giờ deadline/reveal/next — server làm chủ đồng hồ. |
| `arena.service.ts` | Nghiệp vụ chính: tạo phiên, join đội, mở câu, nhận đáp án, chấm điểm, công bố, kết thúc. |
| `arena.gateway.ts` | Socket.IO Gateway — điểm vào/ra WebSocket duy nhất. |
| `arena.controller.ts` | REST phụ trợ (danh sách phiên, chi tiết, join bằng HTTP để lấy JWT trước khi mở socket...). |
| `dto/create-arena.dto.ts` | Validate input tạo phiên (`questionDurationSec`, `revealPauseSec`, `pointsForRank`...). |

### 3.3 `arena.scoring.ts` — chấm điểm & xếp hạng

- **`gradeArenaAnswer(question, selectedOptionIds)`**: SINGLE/MULTIPLE so
  sánh **tập hợp đã sort** (thứ tự chọn không quan trọng). ORDERING so sánh
  **CÓ THỨ TỰ** (không sort đầu vào) — cùng ngữ nghĩa với
  `attempts.service.ts#gradeQuestion` để không lệch cách chấm giữa 2 module.
- **`computeResponseMs({receivedAtMs, startedAtMs, deadlineAtMs,
  compensationMs})`**: `responseMs` LUÔN kẹp trong `[0, durationMs]` — không
  thể âm (bù quá đà) và không thể vượt thời lượng câu hỏi.
- **`rankAndScoreBuzzes(buzzes, pointsForRank, penaltyWrong)`**: gán
  `speedRank` cho MỌI đáp án (kể cả sai), `correctRank` + điểm chỉ cho đáp án
  đúng, phá hoà bằng `answeredAt` rồi `id.localeCompare` (tất định).
- **`compareTeamsForRanking(a, b)`**: 4 tầng phá hoà — điểm → số câu đúng →
  tổng thời gian trả lời đúng → vào phòng sớm hơn. Dùng CHUNG cho bảng xếp
  hạng LIVE và bảng xếp hạng cuối trận nên không bao giờ mâu thuẫn nhau.
- **`buildTeamRoundResults(...)`**: dựng đầy đủ hàng kết quả từng đội cho
  payload `arena.revealed` — kể cả đội **không trả lời** (`outcome:
  'no_answer'`, `scoreBefore === scoreAfter`). Sắp sẵn: đúng theo tốc độ →
  sai theo tốc độ → không trả lời, UI render thẳng không cần sort lại.

### 3.4 `arena-latency.service.ts` — bù trừ độ trễ mạng (RTT)

Đo bằng `socket.timeout(ms).emitWithAck('arena.ping')` (Socket.IO hỗ trợ sẵn
phía server). Lưu **trong bộ nhớ tiến trình** (`Map<socketId, samples[]>`),
KHÔNG ghi DB — nhất quán với ràng buộc "chỉ 1 instance API".

- `getRttMs(socketId)` trả **MIN** của cửa sổ 8 mẫu gần nhất — KHÔNG dùng
  trung bình: client cố tình trả ack chậm chỉ có thể LÀM TĂNG RTT đo được,
  không thể kéo xuống dưới độ trễ mạng thật ⇒ vừa là ước lượng sát nhất vừa
  là hàng rào chống gian lận (nguyên lý giống NTP).
- `getCompensationMs(socketId, rawResponseMs)` kẹp qua 3 tầng: hệ số bù
  (`COMPENSATION_FACTOR = 1.0` — bù trọn RTT, đúng về vật lý vì câu hỏi đi
  xuống + đáp án đi lên đều mất thời gian), trần tuyệt đối
  (`MAX_COMPENSATION_MS = 800`), và không bao giờ bù quá 1/2 thời gian thô
  (`MAX_COMPENSATION_RATIO = 0.5`).
- Chưa có mẫu RTT ⇒ trả `0` (không bù) — mặc định bảo thủ, không đo được thì
  không cho lợi thế.
- `forget(socketId)` gọi khi disconnect để không rò bộ nhớ.

Lịch đo: lúc `handleConnection`, ngay sau `arena.host`/`arena.join` thành
công, và quét định kỳ mỗi 5 giây mọi socket trong room.

### 3.5 `arena-clock.service.ts` — đồng hồ do SERVER làm chủ

Vấn đề cũ: đồng hồ AUTO chạy bằng `setInterval` trên **trình duyệt MC** —
MC đóng tab/mất mạng/tab bị throttle là phiên treo hoặc lệch giờ; MANUAL thì
không có giới hạn giờ nào. Nay: **server hẹn giờ cho CẢ 2 chế độ**, mọi màn
hình (MC lẫn người chơi) chỉ đếm ngược theo mốc server phát ra.

- Mỗi phiên tối đa **một** timer đang chờ (`Map<sessionId, Pending>`) — đặt
  timer mới tự huỷ timer cũ, không bao giờ có 2 timer cùng bắn.
- Sự kiện `question` (hoặc `preparing`) → hẹn `revealRound(sessionId,
  {reason: 'DEADLINE'})` tại đúng `deadlineAtMs`.
- **Khoá và công bố tách làm 2 mốc**: bắn `locked` ngay tại `deadlineAtMs`
  (khoá nút mọi màn hình), rồi chờ thêm `LOCK_GRACE_MS = 400ms` mới gọi
  `revealRound()` thật — để gói tin của người bấm sát nút kịp hạ cánh trước
  khi server chốt điểm.
- Sự kiện `revealed` có `nextAtMs` (chế độ AUTO) → hẹn `nextQuestion()`;
  không có (MANUAL) → không hẹn gì, chờ MC bấm.
- `ended`/`cancelled` → xoá sạch timer đang chờ của phiên đó.
- **Khôi phục sau khi API restart** (`resumeAfterRestart()`, gọi từ
  `ArenaGateway.afterInit()` — thời điểm chắc chắn `this.server` đã sẵn
  sàng): quét mọi phiên `RUNNING`, round `ACTIVE` còn hạn → hẹn phần thời
  gian còn lại; đã quá hạn → công bố ngay lập tức; `AUTO` + `REVEALED` còn
  trong khoảng nghỉ → hẹn `nextQuestion` phần còn lại. Một phiên lỗi không
  chặn việc khôi phục các phiên khác.

### 3.6 `arena.service.ts` — các điểm mấu chốt về tính đúng đắn/công bằng

- **`createSession`**: ngoài chọn `quizId` (bộ đề có sẵn), MC có thể gửi
  `mixSlots: {subjectId?, count}[]` (+ `mixName` tuỳ chọn) để **trộn câu hỏi
  theo tỷ lệ lĩnh vực** — web quy đổi % → số câu bằng thuật toán số dư lớn
  nhất (giống hệt trang Quản lý bộ đề), server gọi `buildMixedQuiz()`: chọn
  ngẫu nhiên (Fisher-Yates) đúng số câu mỗi lĩnh vực từ ngân hàng, **sao
  chép** thành Question mới gắn vào 1 Quiz "vật chứa" tự tạo (giữ nguyên bản
  gốc trong ngân hàng), xáo trộn lần cuối toàn bộ danh sách đã gộp rồi mới
  tạo `ArenaRound`. Chỉ được chọn đúng 1 trong 2 cách (`quizId` hoặc
  `mixSlots`), không cả hai cũng không thiếu cả hai.
- Số đội tối đa mỗi phiên (đặt trước lẫn tự tham gia): **10** — `TEAM_COLORS`
  có đúng 10 màu tương ứng.
- **`recordAnswer`**: `receivedAtMs = Date.now()` được chốt ở **dòng đầu
  tiên** của `handleAnswer` bên `arena.gateway.ts` (trước cả verify JWT) —
  không để độ trễ xử lý (JWT, DB) làm sai lệch thời gian đo. `teamId` được
  **suy ra từ membership phía server**, không tin `teamId` client tự gửi.
  Trùng buzz (đua giữa các thành viên cùng đội) bắt lỗi Prisma `P2002` →
  thông báo tiếng Việt thân thiện thay vì lỗi 500.
- **`revealRound(sessionId, opts)`** — **idempotent tuyệt đối** nhờ khoá lạc
  quan (optimistic concurrency / CAS): lệnh ghi đầu tiên trong
  `$transaction` là
  ```ts
  const claimed = await tx.arenaRound.updateMany({
    where: { id: round.id, status: 'ACTIVE' },   // CAS
    data: { status: 'REVEALED', ... },
  });
  if (claimed.count === 0) return buildRevealPayload(...); // đã có người thắng — không chấm lại
  ```
  Nhờ đó: MC bấm "Công bố" đúng lúc server tự công bố do hết giờ (2 nguồn
  đua nhau) chỉ cộng điểm **một lần**.
- **`endSession()`** — cùng cơ chế CAS trên `ArenaSession.status` trước khi
  cộng XP, tránh cộng XP nhân đôi khi MC bấm "Kết thúc" đúng lúc câu cuối tự
  công bố/tự chuyển.
- **`showQuestion()`**: nếu vẫn còn round `ACTIVE` chưa công bố (MC bấm "Câu
  tiếp theo" khi quên reveal), tự gọi `revealRound(..., {reason: 'SKIPPED'})`
  trước khi mở câu mới — không còn tình trạng mất điểm âm thầm.
- **`joinTeam()`**: tra membership hiện có **trước**, chặn theo trạng thái
  phiên **sau** — cho phép người chơi **vào lại giữa trận** (F5, rớt mạng,
  đổi máy) thay vì bị chặn cứng "Phiên đấu đã bắt đầu".
- **`nextQuestion()`**: luôn chọn round `PENDING` sớm nhất (không phải
  `currentRoundOrder + 1`) — nếu API khởi động lại giữa lúc đang ở pha chờ,
  gọi lại vẫn ra đúng câu còn dang dở, kể cả câu đầu tiên.
- **`getRunningSessionsForClockResume()` / `getLiveState()` /
  `buildRevealPayload()` / `buildEndPayload()`**: các hàm đọc thuần, dùng lại
  cho cả reconnect (`arena.state`) lẫn khôi phục sau restart — không cần
  bảng phụ nào lưu "bảng xếp hạng từng vòng", vì `scoreBefore`/`scoreAfter`
  đã lưu sẵn trên từng `ArenaBuzz`.

### 3.7 `arena.gateway.ts` — điểm vào/ra WebSocket duy nhất

- **Một điểm broadcast duy nhất**: `afterInit()` subscribe
  `ArenaEventBus.stream$`, mọi socket emit (`arena.question`,
  `arena.revealed`, `arena.locked`, `arena.ended`...) đều đi qua
  `broadcastOutgoing()` — không handler nào tự ý emit riêng lẻ.
- `handleConnection` gọi `probeLatency()`; probe định kỳ mọi socket trong
  room mỗi 5 giây.
- `handleAnswer`: `receivedAtMs = Date.now()` là câu lệnh đầu tiên (xem 3.6);
  không còn nhận `teamId` từ client.
- `handleHost`/`handleJoin`: sau khi (re)connect thành công đều emit
  `arena.state` — snapshot đầy đủ để client dựng lại UI mà không cần lịch sử
  sự kiện trước đó.
- `handleTime()`: trả `{serverNowMs: Date.now()}` — dùng cho đồng bộ đồng hồ
  kiểu Cristian's algorithm phía client.

## 4. Idempotency (bắt buộc)

Hai điểm ghi dữ liệu quan trọng nhất của Đấu trường — **chấm điểm một câu**
(`revealRound`) và **cộng XP cuối trận** (`endSession`) — đều dùng chung một
mẫu: **CAS qua `prisma.<model>.updateMany({where: {..., status: <trạng thái
cũ>}, data: {status: <trạng thái mới>}})`**. Nếu `count === 0` nghĩa là một
lời gọi khác đã thắng trong lúc đua — hàm trả về kết quả đã có sẵn thay vì
ghi đè/ghi trùng. Đây là cơ chế idempotency bắt buộc cho mọi endpoint ghi dữ
liệu trong dự án, áp dụng cho ngữ cảnh real-time nhiều nguồn kích hoạt cùng
lúc (MC bấm tay + server tự động) thay vì UUID client-gen (không phù hợp ở
đây vì hành động không đến từ 1 client duy nhất).

## 5. Kiến trúc frontend (`apps/web/src/`)

### 5.1 File dùng chung giữa MC và người chơi

| File | Vai trò |
|---|---|
| `lib/arena-types.ts` | Bản gương thủ công của `arena.types.ts` phía API. |
| `lib/arena-format.ts` | `formatResponseTime(ms)` → `"03:412"` (`ss:ms`), `null` → `"—"`; `formatCountdown`, `formatSignedPoints`, `rankDeltaLabel`. |
| `lib/arena-socket.ts` | `createArenaSocket()` — gộp cấu hình `io(WS_URL, {auth:{token}, transports:['websocket']})`, tự đăng ký sẵn handler `arena.ping`. |
| `hooks/useServerClock.ts` | Đồng bộ đồng hồ kiểu Cristian's algorithm — `getServerNow()` ổn định, resync lúc `connect` và mỗi 20 giây. |
| `hooks/useArenaCountdown.ts` | Đếm ngược mượt bằng `requestAnimationFrame`, ghi thẳng CSS custom property qua ref (không qua `setState`) để chạy 60fps mà chỉ re-render 1 lần/giây hiển thị. |
| `hooks/useFlipRows.ts` | Hoạt ảnh đổi hạng bảng xếp hạng bằng kỹ thuật FLIP (First-Last-Invert-Play) — không cần thư viện animation. Tự tắt khi `prefers-reduced-motion`. |
| `components/ArenaCountdownRing.tsx` | Vòng tròn đếm ngược SVG, đập nhịp khi ≤5 giây. |
| `components/ArenaBuzzStrip.tsx` | Dải chip "đội nào đã bấm + thời gian" — hiện NGAY khi bấm, chưa lộ đúng/sai. |
| `components/ArenaRevealBoard.tsx` | Bảng công bố kết quả từng đội — dùng chung cho cả màn MC lẫn màn người chơi. |
| `components/ArenaLeaderboard.tsx` | Bảng xếp hạng có hoạt ảnh FLIP khi đổi thứ hạng. |

### 5.2 `ArenaPage.tsx` (MC / màn chiếu, `/manage/arena`)

Không còn `setInterval` phía trình duyệt — mọi đếm ngược bám theo
`deadlineAtMs` từ server qua `useServerClock` + `useArenaCountdown`.
`applyState()` dựng lại toàn bộ view từ snapshot `arena.state` (phục vụ
reconnect). Nút "Công bố" hoạt động ở **cả 2 chế độ** MANUAL và AUTO (label
đổi theo ngữ cảnh: "Reveal đáp án" / "Công bố sớm"); nút "Câu tiếp theo" chỉ
hiện ở MANUAL vì AUTO tự chuyển câu qua server.

**Form tạo phiên**: công tắc "Trộn câu hỏi theo tỷ lệ lĩnh vực" thay Select
"Bộ đề" bằng: tổng số câu + danh sách lĩnh vực kèm % (validate tổng = 100%,
xem trước số câu quy đổi/cảnh báo thiếu câu trong ngân hàng) — tái dùng đúng
thuật toán số dư lớn nhất từ `QuizzesPage.tsx`. "Đội đặt trước" tối đa 10.

### 5.3 `ArenaPlayerPage.tsx` (người chơi, `/arena/join/:joinCode`)

Route đứng **ngoài** `AppLayout`, chạy full-screen (vẫn yêu cầu đăng nhập qua
`RequireAuth`) vì học viên thường quét QR vào chơi bằng điện thoại. Một
handler `socket.on('connect', ...)` duy nhất vừa lo lần join đầu tiên vừa lo
tự rejoin lặng lẽ khi mất kết nối rồi có lại — dựa vào `arena.state` để đồng
bộ lại UI, không cần logic reconnect riêng. `submitAnswer()` không gửi
`teamId` (server tự suy), dùng ack callback để hiện ngay "Bạn trả lời sau
`03:412`".

### 5.4 Hiệu ứng hình ảnh/âm thanh (`lib/feedback-fx.ts`)

`playFastestSound()` (chuỗi 3 nốt arpeggio) và `fireGoldSparkle()` (confetti
vàng nhỏ) — phát riêng cho đội **nhanh nhất trong số trả lời đúng**
(`isFastestCorrect`), cả trên màn MC lẫn màn người chơi tương ứng.

### 5.5 CSS (`index.css`, khối `arena-*` sau `.arena-player-brand`)

Vòng đếm ngược dạng `conic-gradient` điều khiển bằng biến `--arena-progress`,
chip buzz nảy vào (`arena-buzz-pop`), số `ss:ms` dùng
`font-variant-numeric: tabular-nums` để không nhảy bề ngang, hàng kết quả lật
ra lần lượt theo `outcome` (đúng/sai/không trả lời — mỗi loại một tông màu),
vương miện lấp lánh cho đội nhanh nhất đúng, điểm `+10`/`-5` bay lên rồi mờ
dần, mũi tên đổi hạng nảy, bố cục tự xếp lại theo bề ngang điện thoại. Bảng
màu đáp án đồng bộ 4 sắc độ Agribank thay vì đỏ/xanh/vàng/cam rời rạc trước
đây. **Toàn bộ khối có nhánh `prefers-reduced-motion` tắt hết animation**
(kể cả transition FLIP do JS đặt inline — chặn ở cả 2 lớp CSS lẫn kiểm tra
`matchMedia` trong `useFlipRows`).

## 6. Dữ liệu (schema Prisma)

6 model: `ArenaSession`, `ArenaInvite`, `ArenaTeam`, `ArenaTeamMember`,
`ArenaRound`, `ArenaBuzz`. Toàn bộ mốc thời gian dùng `@db.Timestamptz(3)`
(UTC, không tin đồng hồ client).

Các trường quan trọng bổ sung trong migration
`20260908135710_dong_ho_may_chu_va_do_tre_dau_truong`:

- `ArenaSession.questionDurationSec` (mặc định 20s, thay thế
  `autoAdvanceSec` cũ — trường cũ giữ lại làm giá trị backfill, đánh dấu
  `@deprecated`), `revealPauseSec` (mặc định 5s).
- `ArenaRound.deadlineAt` (mốc hết giờ server chốt), `revealReason` (`HOST` /
  `DEADLINE` / `SKIPPED` — phục vụ đối soát khi có khiếu nại điểm).
- `ArenaBuzz.receivedAt` (mốc thô server nhận gói, để kiểm toán),
  `responseMs`/`rawResponseMs`/`latencyMs` (thời gian chính thức đã bù /
  thời gian thô / RTT đã dùng để bù), `speedRank` (hạng tốc độ trên mọi đáp
  án), `scoreBefore`/`scoreAfter` (ảnh chụp điểm — dựng lại được cả thứ hạng
  tăng/giảm mà không cần bảng phụ).
- `ArenaTeam.correctCount`/`totalAnswerMs` — 2 tiêu chí phụ phá hoà, cộng dồn
  ngay lúc chốt điểm nên bảng xếp hạng LIVE cũng phá hoà đúng như bảng cuối
  trận.

> ⚠️ Migration Prisma tự sinh cho `ALTER COLUMN ... TYPE TIMESTAMPTZ` **thiếu
> mệnh đề `USING`** — phải sửa tay thành `USING "cot" AT TIME ZONE 'UTC'`
> (xem tiền lệ `20260903133000_attempt_timestamptz`), nếu không Postgres sẽ
> diễn giải giờ cũ theo timezone của session, sai lệch dữ liệu lịch sử.

## 7. Danh sách file (tham chiếu nhanh)

**Backend** (`apps/api/src/arena/`): `arena.types.ts`, `arena.scoring.ts` +
`.spec.ts`, `arena-latency.service.ts` + `.spec.ts`, `arena-event-bus.ts`,
`arena-clock.service.ts` + `.spec.ts`, `arena.service.ts`, `arena.gateway.ts`,
`arena.controller.ts`, `arena.module.ts`, `dto/create-arena.dto.ts`.

**Frontend** (`apps/web/src/`): `lib/arena-types.ts`, `lib/arena-format.ts` +
`.spec.ts`, `lib/arena-socket.ts`, `hooks/useServerClock.ts`,
`hooks/useArenaCountdown.ts`, `hooks/useFlipRows.ts`,
`components/ArenaCountdownRing.tsx`, `components/ArenaBuzzStrip.tsx`,
`components/ArenaRevealBoard.tsx`, `components/ArenaLeaderboard.tsx`,
`pages/ArenaPage.tsx`, `pages/ArenaPlayerPage.tsx`, hiệu ứng trong
`lib/feedback-fx.ts`, CSS `arena-*` trong `index.css`.

## 8. Test

- `arena.scoring.spec.ts` (25 test) — chấm điểm SINGLE/MULTIPLE/ORDERING,
  bù trừ thời gian, xếp hạng + tính điểm, phá hoà, dựng payload kết quả kể
  cả đội không trả lời.
- `arena-latency.service.spec.ts` (13 test) — cửa sổ mẫu, MIN chống gian
  lận, kẹp 3 tầng bù trừ.
- `arena-clock.service.spec.ts` (12 test) — hẹn giờ đúng lúc, huỷ khi công
  bố sớm, AUTO tự next, MANUAL không tự làm gì, khôi phục sau restart.
- `arena-format.spec.ts` (16 test, Vitest phía web) — định dạng `ss:ms` và
  các hàm hiển thị khác.

Chạy: `npm --prefix apps/api test` (Jest) và `npm --prefix apps/web test`
(Vitest).

## 9. Kịch bản kiểm thử thủ công trên dev

Xem chi tiết đầy đủ (12 kịch bản: đồng hồ đồng bộ 3 màn hình, bù trễ mạng
qua throttle, tự khoá + tự công bố, vào lại giữa trận, restart API giữa
trận, idempotency khi đua giữa MC và server, câu ORDERING, phá hoà, giảm
chuyển động, bố cục điện thoại...) trong lịch sử trao đổi lúc lập kế hoạch
tính năng này — chưa chạy tự động hoá được vì cần nhiều trình duyệt thật.
Tài khoản seed dev: xem `apps/api/prisma/seed.ts`.

## 10. Ràng buộc đã tôn trọng khi xây tính năng

- Chỉ 1 instance API (không Redis adapter) ⇒ hẹn giờ trong tiến trình tiến
  trình là hợp lệ, đúng tiền lệ `attempts.service.ts`.
- Không thêm dependency mới — dùng `rxjs` (đã có sẵn) cho event bus,
  `canvas-confetti` (đã có sẵn) cho hiệu ứng, không dùng
  `@nestjs/event-emitter`/`@nestjs/schedule`.
- Logic chấm điểm/reveal ở `arena.service.ts`, không đưa vào REST controller
  (dùng chung cho cả Gateway lẫn Controller).
- Mọi XP đi qua `gamification.service.ts`, không cộng thẳng field `xp`.
- Tên kỹ thuật tiếng Anh; comment/chuỗi UI/thông báo lỗi tiếng Việt có dấu.
