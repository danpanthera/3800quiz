# Đăng nhập bằng tài khoản AD (LDAP qua RODC)

Hướng dẫn bật tính năng "cán bộ đăng nhập bằng đúng mật khẩu Windows/AD của họ" cho **7800Quiz** và **3800Quiz** — 2 dự án dùng chung kiến trúc này gần như y hệt, chỉ khác vài giá trị cấu hình (địa chỉ RODC, tên container...). File này đặt ở gốc cả 2 repo, nội dung giống nhau.

Đúc kết từ lần triển khai thật đầu tiên trên PROD 7800quiz (2026-09-15) — mọi lỗi/cách sửa trong mục Xử lý sự cố đều là lỗi **thật đã gặp**, không phải suy đoán.

## 1. Mô hình — hiểu đúng trước khi làm

**Không phải "đồng bộ mật khẩu"** — bất khả thi, AD không cho đọc mật khẩu người dùng ra ngoài dưới bất kỳ hình thức nào.

Đây là **LDAP bind pass-through**: mỗi lần cán bộ đăng nhập, ứng dụng gửi thẳng đúng username/password họ vừa gõ lên máy chủ RODC của ngân hàng để chính RODC tự xác thực. Ứng dụng không lưu, không đồng bộ, không cache mật khẩu AD ở đâu cả — kết quả bind đúng/sai của đúng lần gọi đó là kết quả xác thực, dùng xong bỏ ngay.

**Mô hình lai theo từng người** (cột `authSource` trên `User`: `LOCAL` hoặc `AD`):
- `LOCAL` (mặc định): xác thực như từ trước giờ, so khớp `passwordHash` lưu trong DB.
- `AD`: xác thực bằng bind pass-through, `passwordHash` trong DB là chuỗi ngẫu nhiên vô nghĩa, không bao giờ được dùng.

**Fail-closed**: nếu RODC không phản hồi được (mất mạng, hết giờ, DNS lỗi...), tài khoản AD báo lỗi "không kết nối được máy chủ xác thực" — **tuyệt đối không được lùi về so khớp mật khẩu nội bộ**, vì mật khẩu nội bộ của tài khoản AD là chuỗi ngẫu nhiên vô nghĩa nên việc "lùi về" thực chất là khoá chết tài khoản, không phải mở đường tắt.

Vẫn giữ **admin cục bộ cứu hộ** (`authSource=LOCAL`) — nếu RODC sập cả ngày, ít nhất người quản trị vẫn vào được hệ thống.

Bật/tắt theo **từng cán bộ**, không phải toàn hệ thống — ô "Đăng nhập bằng AD" ngay trên trang **Quản lý cán bộ**, cạnh ô "User AD". Cần điền User AD (chính là tên đăng nhập AD, ví dụ `nguyenvana`) thì bật mới có tác dụng.

## 2. 3 điều kiện bắt buộc trước khi bật cho ai đó thật

Đừng bật tính năng này cho tài khoản thật nào (kể cả admin) trước khi có đủ 3 điều kiện:

1. **Kết quả script dò cổng** (mục 3 dưới đây) — biết chắc cổng LDAPS có mở, DNS có phân giải được, chứng chỉ do CA nào cấp.
2. **Văn bản/email chấp thuận của bộ phận An ninh thông tin** — ứng dụng sẽ gửi mật khẩu Windows thật của cán bộ lên máy chủ AD, cần được duyệt trước.
3. **Ít nhất 1 tài khoản AD thật để test** — không phải tài khoản quan trọng, để tránh rủi ro tự khoá khi thử sai vài lần.

## 3. Bước 1 — Dò cổng LDAP trên RODC

Chạy **trong máy ảo Ubuntu của PROD** (không phải máy dev):

```bash
bash scripts/kiem-tra-ldap-rodc.sh
```

Script chỉ đọc, không sửa gì, chạy lại bao nhiêu lần cũng an toàn. Trả lời 4 câu hỏi:
1. Cổng LDAP/LDAPS nào mở, thử từ cả máy ảo lẫn **từ trong container API** (đường đi thật của ứng dụng — container nằm sau NAT của Docker, khác hẳn máy ảo).
2. Container có phân giải được **tên miền** RODC không (không chỉ IP — xem mục Xử lý sự cố bên dưới, lỗi `ENOTFOUND`).
3. DNS máy ảo đang dùng server nào.
4. Nếu cổng 636 (LDAPS) mở: chứng chỉ do CA nào cấp — quyết định có cần nạp CA gốc vào container không.

Giá trị mặc định của script (ghi ngay đầu file, sửa bằng biến môi trường nếu khác):

| | 7800quiz | 3800quiz |
|---|---|---|
| RODC_IP | `10.58.0.11` (đã xác nhận) | `10.73.0.11` (đã xác nhận) |
| RODC_FQDN | `7800-RODC-01.corp.agribank.com.vn` (đã xác nhận) | `3800-RODC-01.corp.agribank.com.vn` (đã xác nhận tên máy, **chưa** chạy script để xác nhận cổng/chứng chỉ) |
| CONTAINER | `quiz7800_api` | `quiz3800_api` |

Gửi toàn bộ kết quả cho người phát triển đọc trước khi đi tiếp.

## 4. Bước 2 — Cho container tin cậy chứng chỉ RODC

Nếu cổng 636 (LDAPS) mở, chứng chỉ RODC do CA nội bộ ngân hàng cấp (ví dụ `CN=CA-AD`) — container Node **mặc định không tin CA này** (khác máy Windows đã join domain, tự nhận qua GPO).

### 4.1. Xuất chứng chỉ CA gốc

Trên **1 máy Windows đã join domain** (bất kỳ máy nào, không cần là máy chủ PROD):
1. `mmc.exe` → File → Add/Remove Snap-in → **Certificates** → **Computer account** → Local computer.
2. Certificates (Local Computer) → **Trusted Root Certification Authorities** → Certificates.
3. Tìm đúng CA đã thấy ở bước dò cổng (ví dụ `CA-AD`) → chuột phải → All Tasks → Export.
4. Chọn **Base-64 encoded X.509 (.CER)** — **không** chọn PKCS #7 hay có private key.
5. Lưu file, ví dụ `agribank-ca-ad.crt`.

### 4.2. Chép sang máy ảo PROD

```bash
ssh <user>@<ip-may-ao> "mkdir -p /opt/<7800quiz|3800quiz>/certs"
scp agribank-ca-ad.crt <user>@<ip-may-ao>:/opt/<7800quiz|3800quiz>/certs/
```

> ⚠️ Thư mục `certs/` nằm trong `.gitignore` nên `git pull` không tự tạo ra nó — nếu quên `mkdir -p` trước, `scp` sẽ báo "No such file or directory".

### 4.3. Khai báo trong `.env.prod`

```bash
grep -q '^LDAP_CA_CERT_PATH=' .env.prod || echo 'LDAP_CA_CERT_PATH=/app/certs/agribank-ca-ad.crt' >> .env.prod
```

(7800quiz dùng chung biến `MAIL_CA_CERT_PATH` vì CA này cũng được dùng để trust `smtp.agribank.com.vn` — cùng 1 CA, cùng 1 lần trust cho cả 2 việc. 3800quiz chưa có tính năng mail nên dùng riêng `LDAP_CA_CERT_PATH`.)

### 4.4. Khởi động lại container để nạp biến mới

```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api
```

> ⚠️ **Bắt buộc `up -d`, không phải `restart`** — `restart` chỉ khởi động lại tiến trình với cấu hình MÔI TRƯỜNG CŨ đã nạp từ lúc container được tạo, không đọc lại `.env.prod`. Đây là lỗi thật đã gặp — sửa `.env.prod` xong dùng `restart` thì vẫn lỗi y hệt.

### 4.5. Xác minh

```bash
sudo docker exec <container_api> node -e "const fs=require('fs');const{X509Certificate}=require('crypto');const p=process.env.NODE_EXTRA_CA_CERTS;console.log('NODE_EXTRA_CA_CERTS=',JSON.stringify(p));if(p){try{const c=new X509Certificate(fs.readFileSync(p));console.log('subject:',c.subject);console.log('issuer:',c.issuer)}catch(e){console.log('LOI:',e.message)}}"
```

Phải thấy `NODE_EXTRA_CA_CERTS` có giá trị (không phải chuỗi rỗng), và `subject`/`issuer` đúng là CA nội bộ ngân hàng (ví dụ `CN=CA-AD`, subject = issuer vì là chứng chỉ gốc tự ký).

## 5. Bước 3 — Deploy code

Tính năng này thêm 1 bảng/cột mới (migration) và 1 thư viện mới (`ldapts`) — deploy theo đúng quy trình cập nhật chuẩn đã có (Phụ lục A trong DEPLOYMENT.md):

```bash
bash scripts/backup-db.sh
sudo docker image tag <image>/api:latest <image>/api:prev
git pull --ff-only
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod build
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod stop api web
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api npx prisma migrate deploy
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Xem đầy đủ (kèm bước nối/ngắt Internet tạm thời, checklist, rollback) ở Phụ lục A của `DEPLOYMENT.md`.

## 6. Bước 4 — Bật cho 1 tài khoản test

1. Đăng nhập ADMIN, vào **Quản lý cán bộ**.
2. Tìm/sửa hồ sơ cán bộ test: điền đúng **User AD** (username AD, không phải mã CB), bật **"Đăng nhập bằng AD"**, lưu.
3. Đăng nhập thử bằng username đó + mật khẩu AD thật (khuyên dùng tab ẩn danh).

## 7. Xử lý sự cố — các lỗi thật đã gặp

### "Không kết nối được máy chủ xác thực AD, vui lòng thử lại sau" (HTTP 503)

Đây là lỗi **fail-closed** cố ý — RODC không phản hồi được vì lý do hạ tầng. Xem log để biết lý do thật:

```bash
sudo docker logs <container_api> --tail 50 | grep -A2 'LdapAuthService'
```

Các nguyên nhân thật đã gặp/cần loại trừ theo thứ tự:

1. **`unable to verify the first certificate`** — chưa trust đúng CA gốc, xem lại Bước 2. Kiểm tra nhanh bằng lệnh xác minh ở mục 4.5 — nếu `NODE_EXTRA_CA_CERTS=""` (rỗng) thì chưa khai báo đúng trong `.env.prod`, hoặc đã sửa `.env.prod` nhưng quên `up -d` (chỉ `restart`).
2. **`getaddrinfo ENOTFOUND ...`** — container không phân giải được tên miền RODC qua DNS. Kiểm tra riêng **từ trong container** (khác DNS máy ảo):
   ```bash
   sudo docker exec <container_api> node -e "require('dns').lookup('<rodc-fqdn>',(e,a)=>console.log(e?('LOI: '+e.message):('OK: '+a)))"
   ```
   Nếu lỗi thật ở đây, cách sửa gọn nhất là ghim cứng tên miền → IP trong `docker-compose.prod.yml` (`extra_hosts: ["<rodc-fqdn>:<ip>"]`) thay vì sửa DNS.
3. **`connect ETIMEDOUT` / `connect ECONNREFUSED`** — cổng 636 không mở hoặc bị chặn tường lửa từ container. Chạy lại script dò cổng ở Bước 1, đối chiếu phần "TỪ TRONG CONTAINER API".

### Đăng nhập thành công nhưng hiện màn hình "bắt đổi mật khẩu", đổi không nổi vì không biết "mật khẩu cũ"

Đây từng là lỗi thật (đã sửa trong code, ghi lại để nhớ nguyên nhân): tài khoản AD có `passwordHash` là chuỗi ngẫu nhiên không ai biết (vì không dùng để xác thực) — nếu cờ `mustChangePassword` bị bật nhầm cho tài khoản AD, người dùng bị kẹt cứng, không đời nào nhập đúng "mật khẩu cũ" được vì chính họ cũng không biết.

Nếu vẫn gặp lỗi này (ví dụ phát hiện thêm 1 chỗ khác trong code quên xử lý), gỡ kẹt ngay cho đúng 1 tài khoản mà **không cần deploy lại**:

```bash
sudo docker exec <container_api> node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.update({where:{username:'<username>'},data:{mustChangePassword:false}}).then(u=>{console.log('OK',u.username);return p.\$disconnect()}).catch(e=>{console.error(e);process.exit(1)})"
```

### Báo "sai mật khẩu" dù chắc chắn gõ đúng mật khẩu AD thật

Định dạng tên đăng nhập gửi lên AD khi bind sai. AD chấp nhận 2 kiểu, tuỳ cấu hình từng bank:
- **Down-level**: `CORP\username` (kiểu cán bộ vẫn gõ ở màn hình đăng nhập Windows) — **mặc định hiện tại**, đã xác nhận đúng ở 7800quiz.
- **UPN**: `username@corp.agribank.com.vn`.

Đổi bằng biến môi trường, không cần build lại image:

```bash
# .env.prod
LDAP_BIND_TEMPLATE=%s@corp.agribank.com.vn   # hoặc CORP\%s
```

Rồi `docker compose ... up -d api` (không phải build/migrate lại).

### Reset mật khẩu hàng loạt / bấm nhầm cho tài khoản AD

Đã tự động bỏ qua trong code — nút "Reset mật khẩu" hàng loạt ở Quản lý cán bộ tự nhận diện tài khoản `authSource=AD` và bỏ qua, không sinh mật khẩu tạm vô nghĩa cho họ. Bảng kết quả có nhãn riêng "Tài khoản AD".

## 8. Ghi chú bảo mật

- **Không bao giờ** ghi mật khẩu AD thật (kể cả của tài khoản test) vào bất kỳ file, log, hay bộ nhớ nào — chỉ gõ trực tiếp vào form đăng nhập. Nếu lỡ gõ vào chat/console không phải form đăng nhập, đổi lại mật khẩu đó sau khi test xong.
- Script dò cổng (Bước 1) và lệnh xác minh chứng chỉ (Bước 2.5) đều **chỉ đọc**, không cần mật khẩu.
- Không dùng tài khoản admin/tài khoản quan trọng để test lần đầu — dùng đúng ngưỡng "chấp nhận rủi ro khoá tài khoản AD nếu gõ sai nhiều lần" cho 1 tài khoản phụ trước.

## 9. Khác biệt giữa 2 dự án

| | 7800quiz | 3800quiz |
|---|---|---|
| Trạng thái | Đã chạy thật trên PROD, đã xác nhận bind thành công (2026-09-15) | Đã port code, **chưa** chạy thật trên PROD |
| Default "Đăng nhập bằng AD" khi tạo cán bộ mới | **Bật** (Sếp chốt 2026-09-15) | **Tắt** (giữ mật khẩu nội bộ như từ trước giờ) |
| Mật khẩu tạm khi tạo tài khoản LOCAL | Sinh ngẫu nhiên riêng từng người | Hằng số `Abcd@1234` dùng chung (⚠️ xem cảnh báo dưới) |
| Biến môi trường CA cert | `MAIL_CA_CERT_PATH` (dùng chung với mail) | `LDAP_CA_CERT_PATH` (riêng, 3800quiz chưa có tính năng mail) |

> ⚠️ **Phát hiện ngoài phạm vi tính năng AD, không tự ý sửa**: khi port code sang 3800quiz, phát hiện dự án này vẫn đang dùng mật khẩu mặc định dùng chung `Abcd@1234` khi tạo tài khoản mới — đúng lỗ hổng đã được vá riêng ở 7800quiz một phiên trước (ai biết trước User AD của một cán bộ là đăng nhập được ngay). Đây là quyết định cần bàn riêng với Sếp, không nằm trong phạm vi tính năng AD nên chưa tự ý sửa khi port.
