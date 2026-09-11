# ============================================================================
# 3800Quiz — Dựng máy ảo Ubuntu qua Hyper-V NGAY TRÊN MÁY CHỦ PROD
# (dùng khi PROD đang được cắm Internet tạm thời — xem DEPLOYMENT.md Giai đoạn 2)
#
# Script này tự động hoá mọi việc làm được từ PowerShell: bật Hyper-V, chuẩn bị
# ISO Ubuntu, tạo Virtual Switch, tạo máy ảo, khởi động máy ảo. Việc CÀI ĐẶT
# Ubuntu (màn hình cài đặt tương tác) KHÔNG tự động hoá được — vẫn phải làm tay
# qua cửa sổ Connect của Hyper-V sau khi script chạy xong.
#
# Nếu đã tải sẵn ISO Ubuntu Server 24.04 (VD ubuntu-24.04.4-live-server-amd64.iso):
# đặt file đó trực tiếp vào $VmPath (mặc định D:\quiz) TRƯỚC khi chạy — script
# tự tìm thấy và dùng luôn, không cần Internet cho bước này. Không có sẵn thì
# script tự tải bản LTS mới nhất về (cần Internet).
#
# Chạy với quyền Administrator:
#   .\prod-setup-vm.ps1 -NetAdapterName "Ethernet"
#
# Nếu Hyper-V CHƯA được bật trước đó, máy cần khởi động lại — script sẽ báo
# và dừng; chạy lại đúng lệnh này sau khi khởi động lại xong.
# ============================================================================
[CmdletBinding()]
param(
    [string]$VmName         = 'quiz3800-host',
    [string]$VmPath         = 'D:\quiz',
    [Parameter(Mandatory = $true)]
    [string]$NetAdapterName,                  # tên card mạng đang cắm Internet tạm thời — xem Get-NetAdapter
    [string]$SwitchName     = 'LAN-Tam',
    [int]   $MemoryGB       = 4,
    [int]   $vCPU           = 2,
    [int]   $DiskGB         = 80,
    # Để trống thì script tự tìm file .iso có sẵn ngay trong $VmPath (VD đã tải
    # tay ubuntu-24.04.4-live-server-amd64.iso vào D:\quiz) — chỉ tự tải về nếu
    # không tìm thấy file nào. Muốn chỉ định đích danh thì truyền tham số này.
    [string]$IsoPath        = ''
)

$ErrorActionPreference = 'Stop'

function Ghi([string]$msg) { Write-Host "[prod-setup-vm] $msg" -ForegroundColor Cyan }

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Cần chạy PowerShell với quyền Administrator.'
}

# ── 1. Bật Hyper-V nếu chưa có ──────────────────────────────────────────────
$hyperv = Get-WindowsFeature -Name Hyper-V
if (-not $hyperv.Installed) {
    Ghi 'Đang bật vai trò Hyper-V — máy sẽ cần khởi động lại...'
    Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
    Ghi 'Đã yêu cầu khởi động lại. Sau khi máy lên lại, CHẠY LẠI đúng lệnh này để tiếp tục.'
    exit 0
}
Ghi 'Hyper-V đã sẵn sàng.'

# ── 2. Tạo thư mục làm việc ──────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $VmPath | Out-Null

# ── 3. Xác định file ISO: dùng file đã có sẵn trong $VmPath, hoặc tự tải về ──
if (-not $IsoPath) {
    $existingIso = Get-ChildItem -Path $VmPath -Filter '*.iso' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingIso) {
        $IsoPath = $existingIso.FullName
        Ghi "Đã tìm thấy ISO có sẵn: $IsoPath"
    } else {
        $IsoPath = "$VmPath\ubuntu-24.04-live-server-amd64.iso"
    }
}

if (-not (Test-Path $IsoPath)) {
    Ghi 'Không thấy ISO có sẵn — đang dò tìm link ISO Ubuntu Server 24.04 LTS mới nhất để tải về...'
    $indexUrl = 'https://releases.ubuntu.com/24.04/'
    $html = Invoke-WebRequest -Uri $indexUrl -UseBasicParsing
    $match = $html.Links | Where-Object { $_.href -match 'ubuntu-24\.04.*-live-server-amd64\.iso$' } | Select-Object -First 1
    if (-not $match) { throw "Không tìm thấy link ISO tại $indexUrl — kiểm tra tay tại trang này rồi tải thủ công vào $VmPath" }
    $isoUrl = [Uri]::new([Uri]$indexUrl, $match.href).AbsoluteUri
    Ghi "Đang tải: $isoUrl (khoảng 2.5GB, có thể mất vài phút)"
    Invoke-WebRequest -Uri $isoUrl -OutFile $IsoPath -UseBasicParsing
    Ghi "Đã tải xong: $IsoPath"
} else {
    Ghi "Dùng ISO tại $IsoPath — bỏ qua bước tải."
}

# ── 4. Tạo Virtual Switch tạm cho Internet ──────────────────────────────────
$sw = Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue
if (-not $sw) {
    $adapter = Get-NetAdapter -Name $NetAdapterName -ErrorAction SilentlyContinue
    if (-not $adapter) {
        $available = (Get-NetAdapter | Select-Object -ExpandProperty Name) -join "', '"
        throw "Không tìm thấy card mạng '$NetAdapterName' — kiểm tra lại đúng tên (phân biệt hoa/thường, giữ nguyên khoảng trắng nếu có). Card mạng hiện có trên máy: '$available'"
    }
    Ghi "Đang tạo Virtual Switch '$SwitchName' gắn với card mạng '$NetAdapterName'..."
    New-VMSwitch -Name $SwitchName -NetAdapterName $NetAdapterName -AllowManagementOS $true | Out-Null
} else {
    Ghi "Virtual Switch '$SwitchName' đã tồn tại — bỏ qua."
}

# ── 5. Tạo máy ảo ────────────────────────────────────────────────────────────
$existing = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if ($existing) {
    Ghi "Máy ảo '$VmName' đã tồn tại — bỏ qua bước tạo mới, chỉ khởi động lại."
} else {
    Ghi "Đang tạo máy ảo '$VmName' tại $VmPath\$VmName ..."
    $vhdPath = "$VmPath\$VmName\$VmName.vhdx"
    New-VM -Name $VmName -Generation 1 -MemoryStartupBytes ($MemoryGB * 1GB) `
        -NewVHDPath $vhdPath -NewVHDSizeBytes ($DiskGB * 1GB) `
        -SwitchName $SwitchName -Path $VmPath | Out-Null

    Set-VMProcessor -VMName $VmName -Count $vCPU
    Set-VMMemory -VMName $VmName -DynamicMemoryEnabled $false

    $dvd = Add-VMDvdDrive -VMName $VmName -Path $IsoPath -Passthru
    Set-VMBios -VMName $VmName -StartupOrder @('CD', 'IDE', 'LegacyNetworkAdapter', 'Floppy')

    # Tự khởi động lại cùng Windows Server (không cần ai đăng nhập)
    Set-VM -Name $VmName -AutomaticStartAction Start -AutomaticStartDelay 30

    Ghi 'Đã tạo xong máy ảo.'
}

# ── 6. Khởi động máy ảo ──────────────────────────────────────────────────────
if ((Get-VM -Name $VmName).State -ne 'Running') {
    Start-VM -Name $VmName
    Ghi "Đã khởi động máy ảo '$VmName'."
}

Ghi ''
Ghi '=== XONG PHẦN TỰ ĐỘNG HOÁ ĐƯỢC ==='
Ghi "Bước tiếp theo (làm tay, không tự động hoá được):"
Ghi "  1. Hyper-V Manager -> chuột phải '$VmName' -> Connect... -> cài Ubuntu Server như bình thường."
Ghi '     Nhớ tick "Install OpenSSH Server" ở màn hình chọn gói cài đặt.'
Ghi '  2. Sau khi cài xong và đăng nhập vào Ubuntu, chạy scripts/prod-setup-app.sh (xem DEPLOYMENT.md Giai đoạn 2.3).'
