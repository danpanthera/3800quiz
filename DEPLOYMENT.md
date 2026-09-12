# 3800Quiz — Lộ trình triển khai Production (từ A đến Z)

Tài liệu này dẫn **từng bước một, theo đúng thứ tự**, để đưa 3800Quiz từ máy dev lên một máy chủ **Windows Server** thật, cài đặt **trực tiếp trên chính máy chủ đó** bằng cách kết nối Internet **tạm thời** trong buổi cài đặt, sau đó ngắt hẳn để vận hành hoàn toàn trong **mạng nội bộ ngân hàng**, phục vụ toàn bộ 7 chi nhánh. Làm tuần tự từ Giai đoạn 0, đánh dấu ô checklist khi xong mỗi bước.

> **Phạm vi**: **Windows Server 2016 trở lên** (2016/2019/2022 đều dùng được — mọi lệnh trong tài liệu này tương thích cả 3 bản). Máy chủ chỉ có Internet **đúng trong buổi cài đặt ban đầu** (Giai đoạn 2) và mỗi lần cập nhật phiên bản sau này (Phụ lục A) — ngoài hai thời điểm đó, **không có Internet**. Không cần máy chuẩn bị riêng — mọi thứ dựng thẳng trên máy chủ.

---

## Giai đoạn 0 — Tổng quan & quyết định trước khi bắt đầu

### 0.1. Kiến trúc hệ thống sẽ có

```
 Mạng nội bộ ngân hàng → https://quiz.vbaquangbinh.com (DNS nội bộ qua RODC)
                          │
                    ┌─────▼─────┐  quiz3800_proxy (Caddy — TLS tự cấp từ CA nội bộ)
                    │   Caddy   │
                    └──┬─────┬──┘
               /api/*  │     │  /socket.io/*        (mọi đường dẫn còn lại)
                       ▼     ▼                              ▼
                 quiz3800_api:13011                  quiz3800_web:80
                 (NestJS + Socket.IO)                (giao diện web)
                          │
                          ▼
                    quiz3800_db (PostgreSQL, không mở ra ngoài)

 Toàn bộ 4 container trên chạy bằng Docker BÊN TRONG một máy ảo Ubuntu, máy
 ảo này chạy trên vai trò Hyper-V của Windows Server — cùng một máy chủ vật lý,
 không có máy trung gian nào khác.
```

**Caddy là cửa duy nhất** nhận traffic trong mạng nội bộ — không cần cài Nginx, Certbot hay IIS trên Windows.

> **Ghi nhớ**: hệ thống chỉ chạy đúng **1 bản API** (không nhân bản/scale ra nhiều instance). Đấu trường (Socket.IO) và bộ đếm giờ tự nộp bài đều giả định chỉ có một tiến trình API duy nhất.

### 0.2. Vì sao Hyper-V + máy ảo Ubuntu, không phải Docker Desktop hay "Docker cho Windows"

Đã chốt dùng: **Windows Server (vai trò Hyper-V) chạy một máy ảo Ubuntu, Docker Engine (container Linux) cài trong máy ảo đó.** Hai lý do loại các phương án khác:

- **"Docker cho Windows" kiểu container Windows (native)**: Postgres **không có** bản image Windows container chính thức. Muốn chạy kiểu này phải viết lại toàn bộ Dockerfile bằng base Windows và bỏ hẳn Postgres container — phá vỡ toàn bộ cách đóng gói hiện tại.
- **Docker Desktop cài thẳng lên Windows (dùng WSL2)**: WSL2 chỉ ổn định từ Windows Server 2019/2022 trở lên, **không có trên Server 2016** — dùng cách này sẽ mất khả năng chạy trên 2016. Docker Desktop cũng cần **giấy phép trả phí** với tổ chức lớn, và mặc định không tự khởi động lại sau khi máy chủ reboot cho tới khi có người đăng nhập — rủi ro thật nếu máy tự khởi động lại lúc nửa đêm.

Hyper-V có từ Windows Server 2012, là hypervisor gốc (không phải ảo hoá lồng nhau) nên tương thích xuyên suốt 2016 → 2022, miễn phí hoàn toàn, và Docker trong Ubuntu tự khởi động cùng máy nhờ `systemd`, không cần ai đăng nhập.

### 0.3. Vì sao cài trực tiếp trên PROD bằng cách nối Internet tạm thời

Cách làm: **cắm Internet tạm thời thẳng vào máy chủ PROD** trong buổi cài đặt (rút dây mạng nội bộ, cắm dây Internet vào đúng card mạng đó — hoặc dùng card mạng thứ 2 nếu máy chủ có sẵn; khi đó card thứ 2 trở thành card riêng của máy ảo, cần thêm 1 cổng switch mạng nội bộ cho nó ở Giai đoạn 3.1), dựng máy ảo + cài Docker + build ứng dụng **ngay trên máy chủ thật**, xong thì **ngắt Internet, cắm lại mạng nội bộ**. Không cần máy trung gian nào khác.

So với cách dùng một máy chuẩn bị riêng rồi mang file qua USB, cách này:
- Không phải lo tương thích "VM Configuration Version" giữa 2 máy Hyper-V khác nhau (máy ảo dựng thẳng trên Server thật thì chạy thẳng trên máy đó, không có bước export/import xuyên máy).
- Không cần chuẩn bị/quét virus USB, không cần `docker save`/`docker load` ảnh cồng kềnh.
- Đơn giản hơn cho lần đầu **và** cho mỗi lần cập nhật phiên bản sau này (Phụ lục A) — luôn lặp lại đúng một thao tác quen thuộc: nối mạng tạm → làm việc → ngắt mạng.

> Nếu Internet tạm thời quá chậm/chập chờn khiến bước build Docker (Giai đoạn 2.3) kéo dài bất thường: có phương án thay thế — build sẵn 2 ảnh Docker ở máy khác có mạng nhanh rồi chuyển qua USB, xem **Phụ lục D**.

Đánh đổi cần biết: máy chủ **có tiếp xúc trực tiếp với Internet** trong khoảng thời gian ngắn đó (thường 1 buổi). Để an toàn:
- **Giữ Windows Firewall bật** (mặc định đã chặn toàn bộ kết nối đến từ ngoài) — không tắt vì "cho nhanh".
- Nếu máy chủ có **2 card mạng vật lý**: dùng card thứ 2 riêng cho Internet tạm thời, không đụng tới card đang nối mạng nội bộ — tránh hẳn việc phải rút/cắm dây.
- Làm xong việc gì cần Internet thì **ngắt ngay**, không để treo qua đêm.
- Không cài thêm phần mềm/duyệt web ngoài phạm vi công việc trong lúc máy đang nối Internet.

### 0.4. Bảo mật — các lớp đã có sẵn & checklist trước go-live

Kiến trúc hiện tại đã có sẵn các lớp bảo vệ sau, không cần cấu hình thêm:
- **HTTPS bắt buộc** cho toàn bộ traffic nội bộ — Caddy tự cấp chứng chỉ từ CA riêng của nó (`tls internal`), tự chuyển hướng HTTP→HTTPS, có HSTS.
- **Cô lập mạng**: chỉ container `caddy` lộ cổng ra ngoài; Postgres/API/web nằm sau network `internal: true` trong `docker-compose.prod.yml`, không gọi trực tiếp được từ bên ngoài.
- **Header bảo mật chuẩn**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, ẩn header `Server` (xem `Caddyfile`).
- **Xác thực**: JWT ký bằng khoá bắt buộc đủ mạnh (API tự chối khởi động nếu thiếu/yếu — xem `jwt-secret.ts`), `CORS_ORIGIN` giới hạn đúng domain, `ValidationPipe` whitelist chặn field lạ.
- **Chống brute-force đăng nhập**: `POST /api/auth/login` giới hạn 5 lần thử/phút theo IP (rate-limit ở tầng ứng dụng).

Checklist bổ sung cần làm khi go-live:
- [ ] Đổi mật khẩu `admin` mặc định ngay sau lần đăng nhập đầu (Giai đoạn 6).
- [ ] Sao lưu **mã hoá GPG**, lưu trong mạng nội bộ ngân hàng — không đẩy ra kho lưu trữ đám mây (máy chủ này không có Internet nên không dùng được, nhưng nhắc lại để không ai vô tình đổi sang cloud sau này).
- [ ] SSH/RDP quản trị Windows Server: hạn chế IP được phép truy cập, đổi mật khẩu quản trị mặc định.
- [ ] Cài `fail2ban` hoặc tương đương trong máy ảo Ubuntu nếu có mở SSH ra ngoài phạm vi máy chủ (lớp chống brute-force bổ sung ở tầng OS, độc lập với rate-limit ở tầng ứng dụng).

### 0.5. Checklist chuẩn bị trước khi bắt tay vào làm

- [ ] Máy chủ Windows Server 2016 trở lên: tối thiểu **4 vCPU / 8GB RAM / 80GB ổ đĩa (ưu tiên SSD)** dành riêng cho máy ảo, cộng thêm phần cho bản thân Windows — tổng máy chủ nên có **6–8 vCPU / 16GB RAM** (mức này đã tính dư cho ~200 người dùng, kể cả kịch bản toàn bộ cùng vào thi một lúc)
- [ ] Ổ `D:` còn ít nhất **80GB trống** — toàn bộ tài liệu này dùng `D:\quiz\` làm thư mục gốc phía Windows (mã nguồn, ISO, máy ảo). Nếu máy chủ chỉ có ổ `C:` hoặc muốn dùng đường dẫn khác, đổi qua tham số `-VmPath` khi chạy `prod-setup-vm.ps1` (Giai đoạn 2.2) và thay `D:\quiz\` bằng đường dẫn đó ở mọi bước còn lại
- [ ] Một nguồn Internet tạm thời có thể cắm được vào máy chủ (dây mạng công ty nối tạm ra ngoài, router/modem/hotspot có cổng Ethernet) — đã xác nhận với bộ phận an ninh thông tin về việc tạm thời kết nối máy chủ này ra Internet
- [ ] Biết máy chủ có mấy card mạng vật lý — nếu có từ 2 trở lên, dùng riêng 1 card cho Internet tạm thời để khỏi phải rút/cắm dây mạng nội bộ
- [ ] Dải IP tĩnh nội bộ dành cho máy ảo (hỏi bộ phận mạng), và biết được máy chủ nằm ở subnet/VLAN nào
- [ ] Quyền tạo bản ghi DNS `quiz.vbaquangbinh.com` trên DC ghi được (không phải RODC) — xem Giai đoạn 3.6
- [ ] Danh sách máy client (đặc biệt máy trong domain AD, nếu có) để biết cách cài chứng chỉ gốc nội bộ hàng loạt qua GPO (Giai đoạn 5)
- [ ] Địa chỉ repo mã nguồn (Git) của 3800quiz — nếu repo **private trên GitHub**, chuẩn bị sẵn **Personal Access Token** (xem cảnh báo ở Giai đoạn 2.3) vì GitHub không cho đăng nhập bằng mật khẩu tài khoản qua Git nữa

### 0.6. Tóm tắt toàn bộ quy trình

Nhìn nhanh toàn bộ 9 giai đoạn — chỉ **Giai đoạn 2** cần Internet, phần còn lại làm hoàn toàn trong mạng nội bộ hoặc không cần mạng:

| Giai đoạn | Việc chính | Cần Internet? |
|---|---|---|
| 1 | Chuẩn bị Windows (đồng hồ, sleep, antivirus...) | Không |
| **2** | Nối Internet tạm thời → chạy `prod-setup-vm.ps1` (tự động) → **cài Ubuntu bằng tay** (~10-15 phút, không tự động hoá được) → chạy `prod-setup-app.sh` (tự động: Docker, build, khởi động, migrate, seed) → kiểm tra | **Có** |
| 3 | Ngắt Internet, cắm lại mạng nội bộ, đặt IP tĩnh, đăng ký DNS `quiz.vbaquangbinh.com` qua RODC | Không |
| 4 | Kiểm thử nội bộ qua cổng 8080 | Không |
| 5 | Lấy chứng chỉ gốc CA nội bộ, cài vào máy client (GPO hoặc tay) | Không |
| 6 | Đổi mật khẩu `admin` mặc định | Không |
| 7 | Kiểm thử toàn diện (Excel, làm bài, Đấu trường...) trên thiết bị thật | Không |
| 8 | Bật cron sao lưu tự động hằng ngày | Không |
| 9 | Go-live — thông báo địa chỉ, bàn giao | Không |

Mỗi lần **cập nhật phiên bản mới** sau này lặp lại đúng kiểu Giai đoạn 2 (nối Internet tạm thời → làm việc → ngắt) — xem Phụ lục A.

---

## Giai đoạn 1 — Chuẩn bị hệ điều hành máy chủ Windows

### 1.1. Kiểm tra phiên bản Windows

```powershell
Get-ComputerInfo | Select-Object OsName, OsVersion, OsHardwareAbstractionLayer
```

### 1.2. Đồng bộ đồng hồ hệ thống

Đồng hồ sai làm JWT bị từ chối sớm và khiến việc xác thực chứng chỉ HTTPS thất bại.

```powershell
w32tm /query /status
w32tm /resync
```
(Nếu máy đã gia nhập domain của ngân hàng, nó tự đồng bộ theo domain controller — không cần đổi gì, chỉ cần xác nhận giờ đúng.)

### 1.3. Xác nhận máy chủ không tự ngủ/hibernate

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
```

### 1.4. Hoãn Windows Update tự khởi động lại

```powershell
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -Name 'ActiveHoursStart' -Value 6
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -Name 'ActiveHoursEnd'   -Value 22
```
Quy tắc vận hành: **không cập nhật Windows trong tuần diễn ra kỳ thi**, và sau **mỗi lần** máy khởi động lại (dù chủ động hay do Update), phải kiểm tra lại hệ thống theo Giai đoạn 7.

### 1.5. Loại trừ khỏi phần mềm diệt virus

Nếu máy có cài antivirus/EDR của ngân hàng, đề nghị bộ phận an ninh thông tin loại trừ khỏi quét realtime (Docker chạy trong máy ảo nên antivirus của Windows chủ yếu cần tránh quét file đĩa ảo dung lượng lớn, gây chậm máy):
`D:\quiz\` — thư mục gốc phía Windows dùng xuyên suốt tài liệu này (mã nguồn, ISO, máy ảo đều nằm chung ở đây, xem 2.2).

### ✅ Checklist Giai đoạn 1
- [ ] Xác nhận phiên bản Windows (2016 trở lên)
- [ ] Đồng hồ hệ thống đúng
- [ ] Đã tắt Sleep/Hibernate
- [ ] Đã cấu hình Active Hours
- [ ] Đã xin ngoại lệ antivirus cho thư mục máy ảo (nếu áp dụng)

---

## Giai đoạn 2 — Kết nối Internet tạm thời & dựng toàn bộ hệ thống trên PROD

⚠️ **Không phải "chạy 2 script rồi xong"** — có đúng 1 bước làm tay xen giữa 2 script, không tự động hoá được:

1. **2.1** — Nối Internet tạm thời (thao tác tay).
2. **2.2** — Chạy `prod-setup-vm.ps1` (tự động: bật Hyper-V, chuẩn bị ISO, tạo + khởi động máy ảo).
3. **2.3, bước 1** — **Cài Ubuntu — LÀM TAY**, qua cửa sổ Connect của Hyper-V, ~10–15 phút thao tác thật (đặt tên máy, tạo user, tick OpenSSH Server...). Đây là màn hình cài đặt tương tác của hệ điều hành, không có cách nào tự động hoá từ PowerShell.
4. **2.3, bước 2** — Chạy `prod-setup-app.sh` trong Ubuntu vừa cài (tự động: cài Docker, clone code, build, khởi động 4 container, `migrate deploy` + `seed`) — bước này thì đúng nghĩa "chạy rồi đợi".
5. **2.4** — Kiểm tra rồi mới ngắt Internet.

Sau khi xong Giai đoạn 2 (đã ngắt Internet), **chưa phải xong toàn bộ triển khai** — Giai đoạn 3 trở đi vẫn còn nhiều việc làm tay (không cần Internet nữa), xem tóm tắt ở mục 0.6.

### 2.1. Kết nối Internet tạm thời

Rút dây mạng nội bộ khỏi card mạng sẽ dùng, cắm dây Internet vào (hoặc dùng card mạng thứ 2 nếu có — xem 0.3). Xác nhận có mạng và ghi lại tên card mạng đó:
```powershell
Get-NetAdapter
Test-NetConnection 8.8.8.8
```

### 2.2. Dựng máy ảo (tự động qua script)

Thư mục gốc phía Windows dùng xuyên suốt tài liệu này là `D:\quiz\` — chứa cả mã nguồn, ISO và máy ảo, không cần tách thư mục riêng (script tự tạo nếu chưa có).

**Lấy `prod-setup-vm.ps1` về `D:\quiz\` trước khi chạy** — chọn 1 trong 2 cách, không cần cài Git nếu không muốn:

- **Không cần cài gì thêm** — tải thẳng file bằng PowerShell (đang có Internet tạm thời):
  ```powershell
  New-Item -ItemType Directory -Force -Path D:\quiz | Out-Null
  Invoke-WebRequest -Uri "<đường-dẫn-repo-thật>/raw/main/scripts/prod-setup-vm.ps1" -OutFile "D:\quiz\prod-setup-vm.ps1"
  ```
  File nằm phẳng ngay trong `D:\quiz\` (không có thư mục con `scripts\`) — bỏ `\scripts` ở lệnh `Set-Location` bên dưới.
- **Nếu tiện dùng Git for Windows** — clone thẳng toàn bộ repo (khớp đúng cấu trúc mã nguồn, có luôn thư mục `scripts\`):
  ```powershell
  git clone <đường-dẫn-repo-thật>.git D:\quiz
  ```

> Việc `git clone` **bắt buộc** để ứng dụng chạy được (Docker, database...) không nằm ở bước này — nó diễn ra tự động bên trong máy ảo Ubuntu ở Giai đoạn 2.3, script ở đó tự cài Git và tự clone. Hai cách ở trên chỉ để có đúng 1 file `prod-setup-vm.ps1` chạy được ngay trên Windows.

Nếu đã tải sẵn ISO Ubuntu (VD `ubuntu-24.04.4-live-server-amd64.iso`): đặt file đó **trực tiếp vào `D:\quiz\`** trước khi chạy script — script tự tìm thấy và dùng luôn, không cần tải lại. Không có sẵn thì script tự tải bản LTS mới nhất (cần Internet, đúng lúc này đang có).

```powershell
Set-Location D:\quiz\scripts    # bỏ "\scripts" nếu chỉ tải lẻ 1 file ở cách đầu tiên
.\prod-setup-vm.ps1 -NetAdapterName "Ethernet"    # đổi "Ethernet" thành đúng tên ở bước 2.1
```

Script sẽ: bật Hyper-V (nếu chưa bật — máy khởi động lại, chạy lại đúng lệnh sau khi lên lại), dùng ISO đã có sẵn trong `D:\quiz\` (hoặc tự tải về nếu chưa có), tạo Virtual Switch tạm `LAN-Tam` gắn với card mạng vừa chỉ định, tạo máy ảo `quiz3800-host` tại `D:\quiz\quiz3800-host` (4GB RAM/2 vCPU/80GB — đổi qua tham số `-MemoryGB`/`-vCPU`/`-DiskGB` nếu cần), rồi khởi động máy ảo.

> Muốn dùng ổ/thư mục khác thay vì `D:\quiz\`: thêm tham số `-VmPath "<đường-dẫn>"` vào lệnh `prod-setup-vm.ps1` ở trên, rồi thay `D:\quiz\` bằng đường dẫn đó ở các bước còn lại của tài liệu.

> ⚠️ **Nếu thao tác qua RDP (VD "Windows App" từ macOS, hoặc bất kỳ remote desktop nào)**: đúng lúc script tạo Virtual Switch, Hyper-V gỡ card mạng vật lý ra khỏi ngăn xếp mạng bình thường rồi gắn lại qua switch — nếu phiên RDP đang đi qua đúng card đó, **RDP sẽ bị rớt vài giây đến vài chục giây**, đây là hành vi bình thường chứ không phải lỗi. Sau khi kết nối lại, đừng vội kết luận là script đã dừng chỉ vì không thấy cửa sổ PowerShell cũ (Windows có thể mở phiên đăng nhập mới thay vì nối lại đúng phiên cũ) — kiểm tra trạng thái thật bằng `Get-VM quiz3800-host` (`Running` = đã xong hết, `Off` = mới tạo xong VM chưa kịp khởi động). Script được viết idempotent nên **chạy lại y hệt lệnh cũ luôn an toàn** trong mọi trường hợp — bước nào đã xong sẽ tự bỏ qua, không tạo trùng hay tải lại.

### 2.3. Cài Ubuntu (làm tay) rồi chạy script ứng dụng

> ⚠️ **Gõ qua nhiều lớp remote (VD macOS "Windows App" → RDP vào Windows Server → cửa sổ Connect của Hyper-V vào máy ảo) dễ bị rớt/lẫn ký tự** — gõ nhanh có khi chỉ còn lại vài ký tự ngẫu nhiên trong ô. Ở mọi ô nhập liệu bên dưới (tên máy, username, password): gõ **chậm**, nhìn lại đúng chữ hiện trên màn hình trước khi qua ô tiếp theo; **không dùng copy-paste** (cửa sổ Connect cơ bản của Hyper-V không hỗ trợ dán clipboard vào máy ảo). Nếu ô đang có sẵn ký tự lạ do gõ hụt, xoá trắng hẳn (`Ctrl+A` rồi `Backspace`) trước khi gõ lại, đừng gõ đè lên.

1. Hyper-V Manager → chuột phải `quiz3800-host` → **Connect...** → cài Ubuntu Server như bình thường: đặt tên máy `quiz3800-host`, tạo user quản trị (nhớ kỹ mật khẩu). Ở màn hình chọn gói cài đặt, **tick sẵn "Install OpenSSH Server"**.
2. Sau khi cài xong và đăng nhập, tải mã nguồn về ngay trong Ubuntu (đang có Internet) rồi chạy script:
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   git clone <đường-dẫn-repo-thật>/3800quiz.git /tmp/3800quiz-scripts
   bash /tmp/3800quiz-scripts/scripts/prod-setup-app.sh <đường-dẫn-repo-thật>/3800quiz.git
   ```

> ⚠️ **Nếu repo là private trên GitHub**: `git clone` sẽ hỏi Username/Password — GitHub đã bỏ đăng nhập bằng **mật khẩu tài khoản** cho Git qua HTTPS từ 2021, gõ mật khẩu thật vào sẽ báo lỗi `Invalid username or token. Password authentication is not supported`. Phải dùng **Personal Access Token (PAT)** thay cho mật khẩu: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → tạo token chỉ cho đúng repo này, quyền Contents: Read-only, hạn dùng ngắn (VD 7 ngày). Cách nhanh nhất là nhúng thẳng token vào URL để khỏi bị hỏi lại — thay cả 2 lệnh `git clone`/`prod-setup-app.sh` ở trên bằng:
> ```bash
> git clone https://<TOKEN>@github.com/<đường-dẫn-repo-thật>/3800quiz.git /tmp/3800quiz-scripts
> bash /tmp/3800quiz-scripts/scripts/prod-setup-app.sh https://<TOKEN>@github.com/<đường-dẫn-repo-thật>/3800quiz.git
> ```
> Lưu ý: URL có token sẽ được lưu lại làm `origin` trong `/opt/3800quiz/.git/config` — sau khi cài xong nên coi token đó là **đã dùng xong, huỷ trên GitHub** (mục "Danger zone" của token) để tránh nằm sẵn dạng chữ thường trên máy chủ; lần cập nhật sau (Phụ lục A) cần token mới, sửa lại `git remote set-url origin ...` lúc đó.

Script `prod-setup-app.sh` sẽ: cài Docker Engine, clone mã nguồn vào `/opt/3800quiz`, tạo `.env.prod` với `JWT_SECRET`/`POSTGRES_PASSWORD` sinh ngẫu nhiên (và `SITE_ADDRESS=quiz.vbaquangbinh.com` sẵn), build ảnh Docker (`npm ci` cần Internet — đúng lúc này đang có), khởi động Postgres, chạy `prisma migrate deploy` và `npm run seed` (7 chi nhánh + phòng ban, cấp độ/huy hiệu, 2 tài khoản mẫu), rồi mới bật API/Web/Caddy và chờ cả 4 container `healthy`. Cuối cùng in ra `JWT_SECRET`/`POSTGRES_PASSWORD` — **lưu ngay vào kho mật khẩu ngân hàng**, đây là bước dễ quên nhất và khó khôi phục nhất nếu mất.

> 🔁 **Script chạy lại bao nhiêu lần cũng an toàn.** Báo lỗi, bị ngắt giữa chừng hay rớt mạng thì cứ chạy lại — bí mật đã sinh được giữ nguyên, `.env.prod` còn sót chữ mẫu `THAY_BANG_...` sẽ tự được sinh lại, bước nào dở dang tự làm lại. Lần chạy lại không cần URL, và nếu ảnh Docker đã build xong thì thêm `SKIP_BUILD=1` để khỏi build lại:
> ```bash
> cd /opt/3800quiz
> git pull
> SKIP_BUILD=1 bash scripts/prod-setup-app.sh
> ```
> Container nào không lên được, script tự in 40 dòng log cuối của container đó rồi dừng — chụp phần log đó để chẩn đoán.

> ⚠️ Postgres chỉ đặt mật khẩu lúc khởi tạo volume **lần đầu** — sửa `POSTGRES_PASSWORD` trong `.env.prod` rồi chỉ khởi động lại container thì không có tác dụng. Muốn đổi: sửa `.env.prod` rồi chạy lại `prod-setup-app.sh` — script tự đồng bộ mật khẩu mới vào Postgres (qua socket nội bộ của container, không mất dữ liệu).

### 2.4. Kiểm tra trước khi ngắt Internet

```bash
curl -s http://127.0.0.1:8080/api/health
# Kỳ vọng: {"status":"ok","timestamp":"..."}
sudo docker compose -f /opt/3800quiz/docker-compose.prod.yml --env-file /opt/3800quiz/.env.prod ps
# Kỳ vọng: cả 4 dòng Up (healthy)
```

Đặt máy ảo tự khởi động cùng Windows (script `prod-setup-vm.ps1` đã đặt sẵn, kiểm tra lại nếu muốn):
```powershell
Get-VM quiz3800-host | Select-Object AutomaticStartAction
```

### ✅ Checklist Giai đoạn 2
- [ ] Đã cắm Internet tạm thời, xác nhận có mạng
- [ ] `prod-setup-vm.ps1` chạy xong không lỗi, máy ảo đã tạo và đang chạy
- [ ] Đã cài xong Ubuntu qua cửa sổ Connect, có OpenSSH Server
- [ ] `prod-setup-app.sh` chạy xong không lỗi
- [ ] Đã lưu `JWT_SECRET`/`POSTGRES_PASSWORD` vào kho mật khẩu ngân hàng
- [ ] `curl http://127.0.0.1:8080/api/health` trả `status: ok`, cả 4 container `Up (healthy)`
- [ ] Automatic Start Action = Start

---

## Giai đoạn 3 — Ngắt Internet, chuyển sang mạng nội bộ

### 3.1. Ngắt Internet, cắm lại dây mạng nội bộ

**Trước khi rút dây Internet**: máy ảo cần có sẵn `scripts/prod-set-static-ip.sh` cho bước 3.2 — nếu mã nguồn được clone từ trước khi có script này, chạy `cd /opt/3800quiz && git pull` ngay lúc còn Internet. Rút dây rồi thì máy ảo không lấy thêm được gì từ GitHub.

Switch `LAN-Tam` gắn cố định vào card mạng đã chỉ định ở Giai đoạn 2.1 (`-NetAdapterName`) — Hyper-V không quan tâm đầu kia dây cắm gì, nên chỉ cần đổi lại dây ở đúng card đó, không đụng gì thêm bên Hyper-V. Việc cần làm tuỳ máy chủ dùng mấy card mạng:

- **1 card** (đã rút dây nội bộ ra để cắm Internet ở 2.1): rút dây Internet, cắm lại dây mạng nội bộ vào đúng card đó. Không cần sửa gì bên Hyper-V.
- **2 card riêng** (card thứ 2 dành cho Internet tạm, xem 0.3): rút dây Internet khỏi card thứ 2, cắm dây mạng nội bộ khác vào (thêm 1 cổng switch LAN, cùng VLAN với card chính) — từ nay card này luôn dành riêng cho máy ảo, không đụng tới nữa trừ lúc cập nhật (Phụ lục A). Windows cũng tự có 1 card ảo "Lan-Tam" trên switch này (`Get-NetIPAddress` sẽ thấy) — **đó là của Windows, không phải của máy ảo**, không đặt IP máy ảo lên đó. Gỡ hẳn để khỏi nhầm lẫn:
  ```powershell
  Set-VMSwitch -Name "LAN-Tam" -AllowManagementOS $false
  Get-NetAdapter | Format-Table Name, Status    # card dành cho máy ảo phải là Up
  ```
  ⚠️ Chỉ chạy lệnh trên với máy chủ **2 card** — máy chủ 1 card thì IP của chính Windows nằm trên card ảo đó, gỡ đi là Windows mất mạng.

Đổi tên switch cho gọn (tuỳ chọn, không bắt buộc):

```powershell
Rename-VMSwitch -Name "LAN-Tam" -NewName "LAN-NoiBo"
```

### 3.2. Đặt IP tĩnh trong Ubuntu

Trong console VM (Hyper-V Connect, hoặc SSH nếu mạng nội bộ đã thông), chạy script có sẵn — tự viết đúng file netplan, tắt cấu hình mạng cũ (DHCP của Internet tạm, cloud-init), tự áp dụng rồi tự kiểm tra IP, bảng định tuyến và ping gateway. Không sửa tay file YAML nhiều dòng nhiều ký tự đặc biệt (`#`, `:`, `[`, thụt lề) — rất dễ gõ sai qua console Hyper-V Connect (không dán clipboard được).

> ⚠️ IP của máy ảo đặt **bên trong Ubuntu** bằng script dưới đây — **không** đặt IP đó cho card `vEthernet (LAN-Tam)` trên Windows: Windows sẽ tự trả lời ping IP đó (tưởng máy ảo đã thông trong khi máy ảo chưa có IP), rồi trùng IP khi máy ảo nhận IP thật.

```bash
cd /opt/3800quiz
sudo bash scripts/prod-set-static-ip.sh <IP/CIDR> <gateway> <dns>
```

Giá trị thật dùng cho máy chủ này — máy ảo đặt IP `10.73.0.22` trên **card mạng thứ 2** của máy chủ vật lý (không phải card LAN chính của máy thật, subnet mask `255.255.255.0` = `/24`, gateway `10.73.0.1`), DNS nội bộ *(Sếp bổ sung IP máy chủ RODC của chi nhánh — nối bằng dấu phẩy nếu có DNS phụ, **không dấu cách**)*:
```bash
sudo bash scripts/prod-set-static-ip.sh 10.73.0.22/24 10.73.0.1 <dns>
```

Script mặc định dùng card `eth0` — nếu `ip addr` cho thấy tên khác thì thêm tham số thứ 4. Chạy xong script tự kiểm tra (IP, bảng định tuyến, ping gateway) và **ghi nhớ** cấu hình này — lần sau chỉ cần chạy `sudo bash scripts/prod-set-static-ip.sh` (không tham số) là quay lại đúng IP tĩnh này, dùng ở Phụ lục A khi cập nhật. Chạy lại (VD gõ nhầm) vẫn an toàn, file cũ tự được sao lưu kèm thời gian trước khi ghi đè.

Ghi lại IP này (`10.73.0.22`) — dùng để đăng ký DNS ở bước 3.6.

### 3.3. Mở tường lửa trong Ubuntu

```bash
sudo ufw status                # nếu "inactive" thì bỏ qua bước này
sudo ufw allow 80,443/tcp
```

### 3.4. Xác nhận với bộ phận mạng nội bộ

Nếu các chi nhánh khác nằm ở VLAN/subnet riêng, nhờ bộ phận quản lý mạng xác nhận có tường lửa/route nội bộ nào chặn cổng 80/443 tới IP máy ảo hay không.

> **Lưu ý**: vì máy ảo có IP riêng trên switch External, **Windows Firewall của máy chủ không liên quan** tới traffic người dùng vào ứng dụng (traffic đi thẳng tới máy ảo, không qua ngăn xếp mạng của Windows). Windows Firewall chỉ cần mở nếu quản trị viên cần RDP vào chính Windows Server để quản trị Hyper-V.

### 3.5. Nếu máy chủ đã có sẵn Apache (hoặc webserver khác) chạy trên Windows

> Đúng trường hợp của máy chủ PROD 3800quiz — máy chủ này **đã có sẵn Apache** chạy trên Windows (khác 7800quiz, máy chủ đó không có Apache).

Cài chung được, **không xung đột port 80/443** — đúng nhờ kiến trúc External switch ở trên: Apache bind vào IP của chính Windows Server, còn Caddy trong máy ảo bind vào IP riêng của máy ảo (bước 3.2), hai địa chỉ IP khác nhau nên hai bên không hề "giành" cổng của nhau dù cùng chạy trên một máy chủ vật lý. (Điều này chỉ đúng khi làm theo đúng Giai đoạn 3 — nếu port-forward 80/443 từ Windows vào máy ảo thay vì dùng External switch, lúc đó Windows mới thực sự phải bind 2 cổng đó và sẽ xung đột thật với Apache.)

Vẫn cần lưu ý 3 điểm sau khi triển khai chung:
- **IP/tên riêng**: `SITE_ADDRESS` phải là IP tĩnh/tên nội bộ **khác** với IP/tên đang gán cho site Apache hiện tại.
- **Chính sách switch mạng**: nếu ngân hàng bật port security/802.1X (giới hạn 1 MAC/IP mỗi cổng switch vật lý), việc thêm IP của máy ảo trên cùng cổng NIC vật lý với Windows có thể bị switch chặn — báo trước cho bộ phận mạng ở bước 3.4.
- **Tài nguyên máy chủ**: cấu hình dành cho 3800quiz + máy ảo là **cộng thêm** vào phần Apache/site khác đang chiếm trên cùng máy chủ, không phải dùng chung.

### 3.6. Đăng ký tên DNS nội bộ `quiz.vbaquangbinh.com` qua RODC

Dùng tên nội bộ thay vì gõ thẳng IP — người dùng dễ nhớ, và IP máy ảo có đổi sau này cũng chỉ cần sửa 1 bản ghi DNS thay vì báo lại toàn bộ chi nhánh. Máy chủ đang dùng **RODC** (Read-Only Domain Controller) làm DNS, nên cần đúng thứ tự sau — **không tạo được bản ghi trực tiếp trên RODC**, RODC chỉ giữ **bản sao chỉ-đọc** của zone.

1. Trên **một Domain Controller ghi được** (writable DC, không phải RODC): mở **DNS Manager** → Forward Lookup Zones → zone `vbaquangbinh.com` → chuột phải → **New Host (A or AAAA)...** → Name: `quiz` → IP address: đúng IP tĩnh của máy ảo đã đặt ở bước 3.2 (`10.73.0.22`) → Add Host.
2. Chờ bản ghi replicate về RODC theo lịch AD replication bình thường, hoặc ép ngay cho gấp:
   ```powershell
   repadmin /syncall /AdeP
   ```
3. Kiểm tra từ một máy client đang dùng RODC đó làm DNS server (thường là máy trong cùng chi nhánh với RODC):
   ```powershell
   nslookup quiz.vbaquangbinh.com
   # Kỳ vọng: trả đúng IP tĩnh của máy ảo, 10.73.0.22
   ```

> **Lưu ý**: nếu `vbaquangbinh.com` cũng là domain public thật (website/email ra Internet), bản ghi `quiz` này **chỉ tồn tại trong DNS nội bộ** của ngân hàng — không đăng ký ra ngoài, không ảnh hưởng gì tới domain public. Bên ngoài mạng nội bộ (kể cả dùng đúng URL) sẽ không phân giải được, đây là hành vi đúng của DNS nội bộ (split-horizon), không phải lỗi.

Từ bước này về sau, mọi chỗ trong tài liệu dùng `quiz.vbaquangbinh.com` làm địa chỉ truy cập chính thức — thay cho việc gõ thẳng IP máy ảo.

### ✅ Checklist Giai đoạn 3
- [ ] Đã ngắt Internet, cắm lại mạng nội bộ, máy ảo vẫn lên mạng bình thường qua switch cũ
- [ ] Máy ảo có IP tĩnh đúng dải mạng ngân hàng
- [ ] `ufw allow 80,443/tcp` đã chạy (nếu ufw đang bật)
- [ ] Đã xác nhận với bộ phận mạng: các chi nhánh truy cập được cổng 80/443 tới IP máy ảo
- [ ] Nếu máy chủ đã có Apache/webserver khác: đã đặt IP/tên riêng cho 3800quiz và đã báo bộ phận mạng về IP mới trên cùng cổng switch (mục 3.5)
- [ ] Đã tạo bản ghi A `quiz.vbaquangbinh.com` trên DC ghi được, đã replicate về RODC, `nslookup` trả đúng IP máy ảo

---

## Giai đoạn 4 — Kiểm thử nội bộ (trước khi công bố HTTPS)

Xác nhận toàn bộ chuỗi đã chạy đúng bằng cổng kiểm thử nội bộ, **chạy trong chính máy ảo** (cổng này chỉ nghe trên `127.0.0.1` của máy ảo, không lộ ra mạng):

```bash
curl -s http://127.0.0.1:8080/api/health
# Kỳ vọng: {"status":"ok","timestamp":"..."}

curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
# Kỳ vọng: 200
```

Nếu cả hai đều đúng, toàn bộ hệ thống (Caddy → Web → API → Database) đã thông suốt và chỉ còn thiếu bước cài chứng chỉ cho client.

### ✅ Checklist Giai đoạn 4
- [ ] `/api/health` trả về `status: ok`
- [ ] Trang chủ trả về `200`

---

## Giai đoạn 5 — Kích hoạt HTTPS nội bộ

Máy chủ không có Internet nên **không dùng được Let's Encrypt**. `Caddyfile` đã cấu hình sẵn `tls internal`: Caddy tự làm CA (Certificate Authority) riêng của nó và tự cấp chứng chỉ cho `SITE_ADDRESS`, hoàn toàn offline — việc này đã tự xảy ra ngay từ lần đầu container `caddy` khởi động ở Giai đoạn 2 (không cần Internet cho việc này, `tls internal` luôn chạy offline).

Việc còn lại là làm cho trình duyệt của người dùng **tin tưởng** CA nội bộ đó.

### 5.1. Lấy chứng chỉ gốc ra khỏi container

```bash
docker cp quiz3800_proxy:/data/caddy/pki/authorities/local/root.crt ./3800quiz-root-ca.crt
```

### 5.2. Cài chứng chỉ gốc vào máy client

**Nếu máy client trong domain Active Directory của ngân hàng** (khuyến nghị — tự động, không phải đi từng máy):
- Group Policy Management → tạo/sửa GPO → Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies → **Trusted Root Certification Authorities** → Import → chọn `3800quiz-root-ca.crt`.
- Chạy `gpupdate /force` trên một máy thử để xác nhận trước khi áp dụng toàn công ty.

**Nếu không có domain/GPO** (cài tay từng máy): double-click file `.crt` → Install Certificate → **Local Machine** → Place all certificates in the following store → **Trusted Root Certification Authorities**.

**Điện thoại/máy tính bảng** (dùng cho Đấu trường): chuyển file `.crt` qua email nội bộ/Zalo nội bộ/USB rồi cài theo hướng dẫn của từng hệ điều hành (Cài đặt → Bảo mật → Cài đặt từ bộ nhớ trên Android; Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị trên iOS) — nếu ngân hàng quản lý thiết bị bằng MDM, đẩy qua MDM sẽ nhanh hơn nhiều so với cài tay từng máy.

### 5.3. Nghiệm thu HTTPS

```bash
curl -s https://quiz.vbaquangbinh.com/api/health   # nếu curl báo lỗi chứng chỉ, thêm --cacert 3800quiz-root-ca.crt để loại trừ nguyên nhân "chưa cài root CA"
```
Mở trình duyệt trên một máy **đã cài chứng chỉ gốc** tới `https://quiz.vbaquangbinh.com` — phải thấy ổ khoá bình thường, không cảnh báo. Trên máy **chưa cài**, trình duyệt sẽ cảnh báo "Not secure"/"Chứng chỉ không đáng tin" — đây là hành vi đúng, không phải lỗi hệ thống.

> ⚠️ **Mất volume `caddy_data` là mất luôn CA gốc** — Caddy sẽ tự sinh CA mới, nhưng `root.crt` đã cài trên mọi máy client sẽ không còn khớp, phải làm lại bước 5.1–5.2 cho toàn bộ máy. Sao lưu volume này cùng lịch sao lưu database (xem Giai đoạn 8).

### ✅ Checklist Giai đoạn 5
- [ ] Đã xuất `3800quiz-root-ca.crt`
- [ ] Đã cài vào Trusted Root — qua GPO (nếu có domain) hoặc cài tay
- [ ] `https://quiz.vbaquangbinh.com/api/health` trả về đúng kết quả, không cảnh báo chứng chỉ trên máy đã cài

---

## Giai đoạn 6 — Đổi mật khẩu mặc định & dọn tài khoản mẫu

1. Mở `https://quiz.vbaquangbinh.com`, đăng nhập `admin` / `Abcd@1234`.
2. Hệ thống bắt buộc đổi mật khẩu ngay lần đăng nhập đầu — đặt mật khẩu mạnh, lưu vào kho mật khẩu ngân hàng.
3. **Chưa vội xoá** tài khoản `nhanvien01` / `Staff@1234` — để dành cho việc kiểm thử ở Giai đoạn 7, sau đó **vô hiệu hoá** nó qua trang quản trị người dùng (tài khoản demo có mật khẩu công khai trong mã nguồn).

### ✅ Checklist Giai đoạn 6
- [ ] Đã đổi mật khẩu `admin`, lưu vào kho mật khẩu
- [ ] Đã ghi nhớ sẽ vô hiệu hoá `nhanvien01` sau Giai đoạn 7

---

## Giai đoạn 7 — Kiểm thử toàn diện trước khi bàn giao

Làm tuần tự trên **thiết bị thật, trong mạng nội bộ** — một điện thoại và một máy tính, không chỉ trên máy chủ.

### Hạ tầng
- [ ] `docker compose -f docker-compose.prod.yml --env-file .env.prod ps` → cả 4 container `(healthy)`
- [ ] Trình duyệt (trên máy đã cài chứng chỉ gốc) hiện ổ khoá bình thường, không cảnh báo
- [ ] Từ một máy khác trong mạng: kết nối thử tới cổng `13011` của IP máy ảo → **thất bại** (API không lộ trực tiếp ra ngoài, chỉ qua Caddy)
- [ ] Khởi động lại máy chủ Windows một lần, xác nhận máy ảo tự bật lại và cả 4 container tự chạy lại không cần thao tác tay

### Xác thực
- [ ] Đăng nhập `admin` bằng mật khẩu mới → vào được
- [ ] Đăng nhập `nhanvien01` → bị ép đổi mật khẩu ngay từ đầu
- [ ] Gõ sai mật khẩu → báo lỗi tiếng Việt rõ ràng
- [ ] Thử sai mật khẩu 6 lần liên tiếp trong 1 phút → lần thứ 6 bị chặn (rate-limit đăng nhập, xem mục 0.4)

### Import Excel — kiểm tra giới hạn dung lượng file
| Kích thước file thử | Kỳ vọng |
|---|---|
| ~2 MB | Import thành công |
| ~12 MB | Báo lỗi "file quá lớn" từ hệ thống (không phải lỗi trắng trang) |
| ~30 MB | Báo lỗi 413 rõ ràng, **không phải** trang "đang bảo trì" |

- [ ] Import ngân hàng câu hỏi, thử tính năng sửa câu ngay trên bảng xem trước
- [ ] Import danh sách cán bộ
- [ ] Xuất bảng điểm ra Excel → **kiểm tra cột thời gian hiển thị đúng giờ Việt Nam** (nếu lệch 7 tiếng, báo lại ngay)

### Làm bài kiểm tra
- [ ] Làm bài, lưu giữa chừng, bấm F5 tải lại trang → giữ nguyên câu trả lời và thời gian còn lại
- [ ] Thử một bộ đề có bật "Phản hồi tức thì" → chọn đáp án hiện đúng/sai ngay và tự chuyển câu
- [ ] Nộp bài → hiện điểm, cộng điểm thưởng đúng

### Đấu trường (tính năng dễ vỡ nhất — kiểm tra kỹ)
- [ ] Mở phòng trên máy tính, quét mã QR bằng điện thoại **dùng Wi-Fi nội bộ** → vào được phòng (không dùng 4G để thử được — máy chủ không có IP public, điện thoại dùng 4G không có đường vào mạng nội bộ trừ khi có VPN riêng)
- [ ] Nếu điện thoại chưa cài chứng chỉ gốc, xác nhận nó vẫn chấp nhận cảnh báo và join được phòng, hoặc đã cài chứng chỉ trước (xem Giai đoạn 5.2)
- [ ] Nhiều người chơi cùng lúc, bấm chuông trả lời → cập nhật real-time trên mọi màn hình
- [ ] Mở phòng, để yên 5 phút không thao tác gì, sau đó thao tác tiếp → vẫn hoạt động bình thường
- [ ] Thử lại từ một chi nhánh/VLAN khác (nếu có) — nếu chi nhánh đó không kết nối được, cần báo bộ phận mạng kiểm tra route/tường lửa nội bộ hoặc thiết bị an ninh có chặn WebSocket không

### Sau khi mọi thứ ở trên đều đạt
- [ ] Vô hiệu hoá tài khoản `nhanvien01` qua trang quản trị

---

## Giai đoạn 8 — Thiết lập sao lưu tự động

Trong máy ảo Ubuntu:

```bash
bash /opt/3800quiz/scripts/register-backup-cron.sh
```

Lệnh này đăng ký một cron job chạy **hằng ngày lúc 02:00**, tự sao lưu toàn bộ cơ sở dữ liệu vào `/var/backups/3800quiz`, tự xoá bản cũ quá 14 ngày (giữ riêng bản đầu mỗi tháng trong 12 tháng), và tự kiểm tra file sao lưu có đọc được hay không sau mỗi lần chạy. Script tự chạy thử ngay sau khi đăng ký — kiểm tra kết quả:

```bash
tail -n 10 /var/backups/3800quiz/backup.log
```

> ⚠️ **Bản sao lưu nằm cùng máy ảo chưa phải là bản sao lưu thật sự.** Mở file `scripts/backup-db.sh`, tìm phần "Sao chép ra kho ngoài" ở cuối file, bỏ dấu `#` và điền đường dẫn ổ mạng nội bộ của ngân hàng (mount sẵn qua `fstab`/`autofs` — máy này không có Internet nên không dùng được kho lưu trữ đám mây).

> ⚠️ Cũng nên sao lưu định kỳ volume `caddy_data` (chứa CA nội bộ — xem cảnh báo ở Giai đoạn 5), ví dụ: `docker run --rm -v quiz3800_caddy_data:/data -v /var/backups/3800quiz:/backup alpine tar czf /backup/caddy_data_$(date +%F).tar.gz -C / data` (tên volume có tiền tố `quiz3800_` theo `name:` trong `docker-compose.prod.yml` — gõ sai tên thì Docker âm thầm tạo volume rỗng mới và sao lưu không có gì, kiểm tra bằng `docker volume ls`).

### ✅ Checklist Giai đoạn 8
- [ ] Cron job đã đăng ký thành công (`crontab -l` thấy dòng gọi `backup-db.sh`)
- [ ] `backup.log` xác nhận chạy thành công lần đầu
- [ ] Đã cấu hình sao chép ra kho lưu trữ ngoài máy ảo
- [ ] Đã thêm việc sao lưu volume `caddy_data`
- [ ] Đã đặt lịch nhắc diễn tập phục hồi thử mỗi quý (xem Phụ lục A)

---

## Giai đoạn 9 — Go-live

Chỉ chuyển sang dùng thật khi **toàn bộ checklist Giai đoạn 1–8 đã đánh dấu xong**.

- [ ] Thông báo địa chỉ `https://quiz.vbaquangbinh.com` cho các chi nhánh, kèm hướng dẫn cài chứng chỉ gốc cho máy chưa nằm trong domain/GPO
- [ ] Bàn giao mật khẩu `admin` mới cho người phụ trách vận hành lâu dài (không phải người triển khai)
- [ ] Ghi lại vào sổ tay vận hành: vị trí file `.env.prod` (chứa bí mật), vị trí bản sao lưu, lịch backup, cách xem log (Phụ lục C), và **quy trình nối Internet tạm thời khi cần cập nhật** (Phụ lục A)
- [ ] Đặt lịch kiểm tra định kỳ (gợi ý: hằng tuần) chạy nhanh checklist "Hạ tầng" ở Giai đoạn 7

**Chúc mừng — hệ thống đã sẵn sàng phục vụ.** Các phụ lục dưới đây dùng cho vận hành về sau, không cần đọc ngay.

---

## Phụ lục A — Vận hành: cập nhật phiên bản & rollback

### Cập nhật lên bản mới

Đúng theo mô hình đã chọn (Giai đoạn 0.3): mỗi lần cập nhật, **nối Internet tạm thời lại vào máy chủ**, làm việc, xong thì ngắt — không cần máy trung gian, không cần `docker save`/`docker load`.

**1. Nối Internet tạm thời**: đổi dây từ mạng nội bộ sang Internet (như Giai đoạn 2.1), rồi trong máy ảo chuyển card mạng sang nhận IP tạm — script tự gỡ IP tĩnh, chờ có mạng, kiểm tra vào được GitHub chưa:
```bash
sudo bash scripts/prod-set-static-ip.sh dhcp
```

**2. Trong máy ảo Ubuntu, tại `/opt/3800quiz`:**
```bash
# 1. BẮT BUỘC sao lưu trước — Prisma không có "migration đảo chiều"
bash scripts/backup-db.sh

# 2. Gắn nhãn image hiện tại để còn đường lùi
sudo docker image tag quiz3800/api:latest quiz3800/api:prev
sudo docker image tag quiz3800/web:latest quiz3800/web:prev

# 3. Lấy mã nguồn mới, build (chưa đụng gì tới hệ thống đang chạy)
git pull --ff-only
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod build

# 4. Cửa sổ bảo trì ngắn — Caddy vẫn chạy nên người dùng thấy trang
#    "Đang bảo trì" thân thiện thay vì lỗi trình duyệt trần trụi
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod stop api web

# 5. Chạy migration bằng bản mã nguồn MỚI
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api npx prisma migrate deploy

# 6. Bật lại
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

**3. Ngắt Internet, cắm lại mạng nội bộ**: đổi dây về lại mạng nội bộ (như Giai đoạn 3.1) — xong việc là ngắt ngay, không để treo qua đêm. Trong máy ảo, quay lại đúng IP tĩnh đã ghi nhớ ở Giai đoạn 3.2 (không cần gõ lại IP/gateway/DNS):
```bash
sudo bash scripts/prod-set-static-ip.sh
```

> ⚠️ Bắt buộc có `--build` ở bước 3 — `docker compose restart` sẽ không lấy mã nguồn mới vì image được build sẵn từ trước.
> ⚠️ **Tuyệt đối không cập nhật khi đang có kỳ thi diễn ra.**
> 🛑 **Nếu bước 5 (`migrate deploy`) báo lỗi**: dừng ngay, KHÔNG chạy `up -d`. Hệ thống đang tắt (`api`/`web` đã stop) nên chưa có ai bị ảnh hưởng bởi schema nửa vời — làm ngay theo mục **Rollback** bên dưới rồi mới thử lại. Vẫn có thể ngắt Internet ngay cả khi đang rollback — rollback không cần mạng.

### Nghiệm thu sau khi cập nhật

```bash
curl -s https://quiz.vbaquangbinh.com/api/health
```

- [ ] `/api/health` trả `status: ok`
- [ ] Trang chủ tải được, đăng nhập thử bằng một tài khoản thường (không phải admin)
- [ ] Mở thử một phòng **Đấu trường**, xác nhận WebSocket vẫn kết nối được — F12 → tab Network → lọc "WS" → trạng thái phải là **101** (đây là phần dễ vỡ nhất mỗi khi đổi bản, xem Phụ lục B)
- [ ] Thử trực tiếp đúng tính năng vừa nâng cấp trong bản này

> 💡 **Lưu ý cache của web (PWA)**: người dùng đang mở sẵn tab từ trước có thể vẫn thấy giao diện/bản cũ một lúc — web dùng chế độ nhắc cập nhật (`registerType: 'prompt'`), họ cần bấm "Cập nhật" khi hộp thoại hiện lên hoặc tự tải lại trang. Nếu tính năng mới cần dùng ngay, nhắc các chi nhánh F5 lại trang.

### ✅ Checklist Phụ lục A — Cập nhật lên bản mới
- [ ] Đã nối Internet tạm thời, đã chạy `prod-set-static-ip.sh dhcp` trong máy ảo
- [ ] Đã sao lưu trước khi cập nhật (`scripts/backup-db.sh`)
- [ ] Đã gắn nhãn `:prev` cho image `api` và `web` hiện tại
- [ ] `git pull` + `docker compose build` chạy xong không lỗi
- [ ] `prisma migrate deploy` báo thành công — **không lỗi thì mới đi tiếp** (nếu lỗi → Rollback ngay)
- [ ] Cả 4 container `Up (healthy)` sau `up -d`
- [ ] Đã làm xong mục "Nghiệm thu sau khi cập nhật" ở trên
- [ ] Đã ngắt Internet, cắm lại mạng nội bộ, đã chạy lại `prod-set-static-ip.sh` (không tham số) trong máy ảo
- [ ] Đã thông báo cho các chi nhánh nếu có thay đổi giao diện đáng chú ý (kèm nhắc F5 nếu cần)

### Rollback

**Chỉ đổi mã nguồn, không đổi cấu trúc dữ liệu** (trường hợp thường gặp — không cần Internet):
```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod stop api web
sudo docker image tag quiz3800/api:prev quiz3800/api:latest
sudo docker image tag quiz3800/web:prev quiz3800/web:latest
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

**Bản mới có thay đổi cấu trúc dữ liệu** (bắt buộc phục hồi từ bản sao lưu — cũng không cần Internet):
```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod stop api web
bash scripts/restore-db.sh <đường-dẫn-bản-dump-trước-khi-update>
sudo docker image tag quiz3800/api:prev quiz3800/api:latest
sudo docker image tag quiz3800/web:prev quiz3800/web:latest
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### Diễn tập phục hồi (khuyến nghị mỗi quý)

```bash
bash scripts/restore-db.sh <một-bản-dump-bất-kỳ>
```
Bản sao lưu chưa từng được phục hồi thử thì chưa phải là bản sao lưu đáng tin.

---

## Phụ lục B — Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `prisma migrate deploy` báo lỗi **P3005** | Chạy nhầm trên DB đã có dữ liệu/cấu trúc cũ | Xác nhận đang thao tác đúng máy ảo/volume PROD, không phải một bản dev còn sót lại |
| Container `api` khởi động rồi tắt liên tục (`Restarting`), log báo `Thiếu JWT_SECRET hợp lệ` | `.env.prod` còn chữ mẫu `THAY_BANG_...`, để trống hoặc khoá quá ngắn | Chạy lại `prod-setup-app.sh` (xem ghi chú 🔁 ở Giai đoạn 2.3) — script tự sinh lại bí mật còn chữ mẫu và đồng bộ mật khẩu vào Postgres. API cố ý từ chối chạy với khoá không an toàn |
| `prod-setup-app.sh` dừng ngay sau dòng "Đang tạo .env.prod...", trở về dấu nhắc lệnh mà không báo lỗi | Bản script cũ (trước 11/09/2026) bị lỗi SIGPIPE ở dòng sinh mật khẩu | `cd /opt/3800quiz && git pull` để lấy bản đã sửa, rồi chạy lại script — không cần xoá gì |
| Máy ảo ping gateway báo `From 192.168.1.x ... Destination Host Unreachable`; `ip route` vẫn còn `default via 192.168.1.1 ... proto dhcp` | IP tĩnh chưa được áp dụng — máy ảo vẫn giữ IP DHCP của Internet tạm. Switch ảo không mất kết nối khi đổi dây ở máy chủ thật nên máy ảo không tự bỏ IP cũ | Chạy `prod-set-static-ip.sh` (Giai đoạn 3.2) — script tắt DHCP, xoá IP cũ còn bám, tự ping gateway để xác nhận |
| Windows ping được IP máy ảo nhưng máy khác trong LAN thì không | IP đó bị đặt nhầm cho card `vEthernet (LAN-Tam)` của Windows — Windows đang tự trả lời chính nó (kiểm tra: `Get-NetIPAddress -AddressFamily IPv4`) | Gỡ IP khỏi Windows: máy chủ 2 card → `Set-VMSwitch -Name "LAN-Tam" -AllowManagementOS $false` (xem 3.1); máy chủ 1 card → chỉ gỡ đúng IP đó: `Remove-NetIPAddress -IPAddress <IP> -Confirm:$false`. IP máy ảo chỉ đặt bên trong Ubuntu (3.2) |
| Trình duyệt báo "Not secure"/chứng chỉ không đáng tin | Máy đó chưa cài chứng chỉ gốc `3800quiz-root-ca.crt` | Xem Giai đoạn 5.2 — cài qua GPO (máy trong domain) hoặc cài tay |
| Đấu trường không kết nối được, mọi thứ khác vẫn bình thường | Thiết bị bảo mật mạng nội bộ chặn nâng cấp WebSocket | Mở DevTools trên trình duyệt (F12) → tab Network → lọc "WS" → phải thấy trạng thái **101**. Nếu chi nhánh này không được mà chi nhánh khác được, báo bộ phận mạng kiểm tra thiết bị của riêng chi nhánh đó |
| Import file báo lỗi **413** | File vượt quá 25MB | Chia nhỏ file trước khi import |
| Import file hiện trang "đang bảo trì" | API thực sự đang gặp sự cố (không phải do file lớn) | `docker logs quiz3800_api` để xem chi tiết |
| Đăng nhập báo "Thử đăng nhập quá nhiều lần" dù đúng mật khẩu | Đã vượt 5 lần thử/phút từ cùng IP (rate-limit chống brute-force) | Đợi 1 phút rồi thử lại — đây là hành vi cố ý, không phải lỗi |
| Máy chủ khởi động lại xong nhưng máy ảo/container không tự chạy | Automatic Start Action chưa đặt đúng | Hyper-V Manager → VM Settings → Automatic Start Action = Always start automatically (xem Giai đoạn 2.4) |
| Cột thời gian trong file Excel xuất ra bị lệch 7 tiếng | Biến `TZ` chưa được nạp đúng | Kiểm tra `.env.prod` có `TZ=Asia/Ho_Chi_Minh`, chạy `docker compose ... up -d api` |
| `prod-setup-vm.ps1` báo không tìm thấy link ISO | Chưa đặt sẵn file `.iso` trong `D:\quiz\`, mà trang `releases.ubuntu.com` cũng đổi cấu trúc hoặc bị mạng chặn | Tải tay ISO tại `https://ubuntu.com/download/server`, đặt file vào `D:\quiz\` (script tự nhận diện) rồi chạy lại script |
| `crontab -l` không thấy dòng backup, hoặc backup không tự chạy lúc 02:00 | Cron chạy dưới user khác, hoặc dịch vụ `cron` chưa bật | `sudo systemctl status cron`; đăng ký lại bằng đúng user đã `usermod -aG docker` (xem Giai đoạn 8) |

### Lệnh chẩn đoán nhanh (chạy trong máy ảo Ubuntu)

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail 100 api
docker logs --tail 50 quiz3800_proxy
curl -s http://127.0.0.1:8080/api/health   # kiểm tra bỏ qua HTTPS/chứng chỉ, chỉ test nội bộ
```

---

## Phụ lục C — Tham chiếu nhanh

### Container & port

| Container | Vai trò | Port ra ngoài |
|---|---|---|
| `quiz3800_proxy` | Caddy — cổng vào duy nhất | 80, 443 (và `127.0.0.1:8080` chỉ để test nội bộ, trong máy ảo) |
| `quiz3800_web` | Giao diện web | Không mở ra ngoài |
| `quiz3800_api` | NestJS + Socket.IO | Không mở ra ngoài |
| `quiz3800_db` | PostgreSQL | Không mở ra ngoài |

### File quan trọng

| File | Vị trí | Vai trò |
|---|---|---|
| `scripts/prod-setup-vm.ps1` | `D:\quiz\scripts\` (Windows) | Dựng máy ảo Ubuntu tự động (Giai đoạn 2.2) |
| `scripts/prod-setup-app.sh` | Mã nguồn (trong VM) | Cài Docker + build + khởi tạo ứng dụng tự động (Giai đoạn 2.3) |
| `scripts/prod-set-static-ip.sh` | Mã nguồn (trong VM) | Đặt IP tĩnh qua netplan tự động (Giai đoạn 3.2) |
| `scripts/migrate-docker-dataroot.sh` | Mã nguồn (trong VM) | Chuyển dữ liệu Docker (Postgres...) sang ổ SCSI mới — chạy 1 lần khi ổ hệ điều hành đang gắn IDE |
| `docker-compose.prod.yml` | `/opt/3800quiz` (trong VM) | Cấu hình toàn bộ hệ thống production |
| `Caddyfile` | `/opt/3800quiz` (trong VM) | Cấu hình reverse proxy + HTTPS nội bộ (`tls internal`) |
| `.env.prod` | `/opt/3800quiz` (trong VM) | **Bí mật** — mật khẩu DB, khoá JWT (không commit, không chia sẻ qua kênh không an toàn) |
| `scripts/backup-db.sh` | `/opt/3800quiz/scripts` (trong VM) | Sao lưu thủ công/tự động |
| `scripts/restore-db.sh` | `/opt/3800quiz/scripts` (trong VM) | Phục hồi từ bản sao lưu |
| `scripts/register-backup-cron.sh` | `/opt/3800quiz/scripts` (trong VM) | Đăng ký lịch sao lưu tự động (cron) |
| `3800quiz-root-ca.crt` | xuất ra ở Giai đoạn 5.1 | Chứng chỉ gốc CA nội bộ — cần cài trên mọi máy client |
| `/var/backups/3800quiz/` | trong VM | Nơi lưu các bản sao lưu |

### Tài khoản

| Username | Mật khẩu ban đầu | Vai trò | Ghi chú |
|---|---|---|---|
| `admin` | `Abcd@1234` | ADMIN | Bắt buộc đổi ngay lần đăng nhập đầu (Giai đoạn 6) |
| `nhanvien01` | `Staff@1234` | STAFF | Chỉ dùng để kiểm thử — vô hiệu hoá sau Giai đoạn 7 |

### Lệnh dùng hằng ngày (chạy trong máy ảo Ubuntu)

```bash
# Xem trạng thái
docker compose -f docker-compose.prod.yml --env-file .env.prod ps

# Xem log
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api

# Sao lưu ngay lập tức (ngoài lịch tự động)
bash scripts/backup-db.sh
```

---

## Phụ lục D — Phương án thay thế: build ảnh Docker ở máy khác, chuyển qua USB

**Chỉ dùng khi** Internet tạm thời trên PROD quá chậm/chập chờn khiến bước build Docker ở Giai đoạn 2.3 kéo dài bất thường (hàng chục phút trở lên cho `npm ci`, hoặc bị treo giữa chừng do rớt gói). Đây **không phải cách mặc định** — tài liệu chính (Giai đoạn 2) cố tình chọn build trực tiếp trên PROD để tránh đúng việc quét virus USB + chuyển ảnh cồng kềnh này (xem mục 0.3). Chỉ chuyển sang Phụ lục D khi cách chính gặp khó khăn thật sự.

**Máy dùng để build**: máy Windows hay **macOS đều được** — chỉ cần có Docker Desktop (hoặc **OrbStack trên macOS**, dùng chung `docker`/`docker buildx` CLI, hỗ trợ đầy đủ build đa kiến trúc y hệt Docker Desktop — dự án này vốn đã dùng OrbStack cho môi trường dev nên máy dev Mac đang có sẵn, không cần cài thêm gì) và Internet nhanh (VD máy dev đang có sẵn mã nguồn mới nhất). Không nhất thiết phải là máy Windows.

> ⚠️ **Nếu build trên Mac Apple Silicon (M1/M2/M3/M4, chip ARM)**: máy PROD chạy kiến trúc `linux/amd64` (Windows Server + Hyper-V + Ubuntu, không phải ARM), khác hẳn kiến trúc gốc `arm64` của Mac — **bắt buộc** chỉ định `--platform linux/amd64` khi build, thiếu tham số này sẽ ra ảnh ARM không chạy được trên PROD. Máy Windows hoặc Mac Intel vốn đã là `amd64` nên không bắt buộc, nhưng nên chỉ định rõ cho chắc chắn.

### D.1. Build + đóng gói trên máy dev (OrbStack)

```bash
cd /opt/Projects/3800quiz          # đúng thư mục mã nguồn trên máy dev
git status                         # đảm bảo working tree sạch, không thiếu commit chưa push
git pull --ff-only                 # dùng đúng bản mới nhất, khớp commit đã push lên PROD sẽ clone

# Xác nhận Docker CLI đang trỏ vào OrbStack, không phải Docker Desktop (nếu có cài cả 2)
docker context ls                  # dòng đang active (dấu *) phải là "orbstack"
docker context use orbstack        # chỉ cần chạy nếu dòng active KHÔNG phải orbstack

# Build trực tiếp bằng docker buildx (không qua docker compose để khỏi cần .env.prod ở máy này)
# --platform linux/amd64 bắt buộc trên Mac Apple Silicon — xem cảnh báo phía trên
docker buildx build --platform linux/amd64 -t quiz3800/api:latest -f apps/api/Dockerfile apps/api --load
docker buildx build --platform linux/amd64 -t quiz3800/web:latest -f apps/web/Dockerfile apps/web --load

# Xác nhận đã có đúng 2 ảnh, ĐÚNG kiến trúc amd64 (tên/tag phải khớp CHÍNH XÁC docker-compose.prod.yml)
docker images | grep quiz3800
docker inspect --format '{{.Os}}/{{.Architecture}}' quiz3800/api:latest quiz3800/web:latest
# Kỳ vọng cả 2 dòng: linux/amd64

# Đóng gói cả 2 ảnh vào 1 file, lưu ra thư mục dễ tìm để copy vào USB
mkdir -p ~/Desktop/quiz3800-deploy
docker save quiz3800/api:latest quiz3800/web:latest -o ~/Desktop/quiz3800-deploy/quiz3800-images.tar

# Xem dung lượng thật (thử thực tế: khoảng 200MB) để biết USB cần trống bao nhiêu
ls -lh ~/Desktop/quiz3800-deploy/quiz3800-images.tar
```

> Không cần nén gzip thêm: Docker bản mới đã nén sẵn từng lớp bên trong file `.tar`, thử thực tế gzip chỉ giảm từ 203MB xuống 201MB. (Script vẫn nhận file `.tar.gz` nếu lỡ nén.)

### D.2. Chuyển file qua USB vào PROD

1. Copy `quiz3800-images.tar` từ `~/Desktop/quiz3800-deploy/` vào USB — làm đúng quy trình quét virus USB nội bộ của ngân hàng trước khi cắm vào máy chủ PROD (xem mục 0.3).
2. Cắm USB vào máy chủ Windows Server, copy file vào `D:\quiz\quiz3800-images.tar`.
3. Hyper-V không có sẵn cách gắn USB thẳng vào máy ảo — chuyển tiếp file từ Windows sang Ubuntu qua mạng nội bộ (SSH đã cài ở Giai đoạn 2.3), dùng OpenSSH client có sẵn trên Windows:
   ```powershell
   # Không biết IP máy ảo thì lấy qua Hyper-V, không cần vào console:
   Get-VM quiz3800-host | Select-Object -ExpandProperty NetworkAdapters | Select-Object IPAddresses

   scp D:\quiz\quiz3800-images.tar <username-đã-tạo-ở-2.3>@<IP-máy-ảo>:/tmp/
   ```

### D.3. Nạp ảnh và chạy trong Ubuntu

Dùng đúng script của Giai đoạn 2.3, chỉ thêm `IMAGES_TAR=` trước lệnh — script tự cài Docker, **nạp 2 ảnh từ file thay cho bước build**, rồi làm tiếp y hệt (sinh bí mật, khởi tạo DB, bật 4 container, in bí mật cần lưu):

```bash
df -h /    # ổ đĩa cần trống ít nhất gấp đôi dung lượng file ảnh
sudo apt-get update && sudo apt-get install -y git
git clone <đường-dẫn-repo-thật>/3800quiz.git /tmp/3800quiz-scripts
IMAGES_TAR=/tmp/quiz3800-images.tar bash /tmp/3800quiz-scripts/scripts/prod-setup-app.sh <đường-dẫn-repo-thật>/3800quiz.git
```

- Vẫn cần Internet tạm thời để cài Docker Engine và tải 2 ảnh nhỏ `postgres:16-alpine`/`caddy:2-alpine` — nhưng không còn `npm ci`, nên chỉ mất vài phút.
- Lỗi giữa chừng thì chạy lại theo ghi chú 🔁 ở Giai đoạn 2.3 (ảnh đã nạp rồi nên dùng `SKIP_BUILD=1`, không cần `IMAGES_TAR` nữa).
- Chạy xong có thể xoá file tạm: `rm /tmp/quiz3800-images.tar`.

Sau bước D.3, quay lại đúng Giai đoạn 2.4 trở đi của tài liệu chính (kiểm tra, ngắt Internet, chuyển sang mạng nội bộ...) — không có gì khác biệt nữa.
