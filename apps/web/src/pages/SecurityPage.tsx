import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Button, Card, Input, List, Popconfirm, Space, Tag, Typography, message,
} from 'antd'
import { DesktopOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import api, { getErrorMessage } from '../lib/api'

const { Title, Text, Paragraph } = Typography

interface TotpStatus { enabled: boolean; pendingSetup: boolean }
interface TotpSetup { secret: string; otpauthUrl: string }
interface SessionRow {
  id: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  lastSeenAt: string
  isCurrent: boolean
}

// Rút gọn chuỗi User-Agent dài loằng ngoằng thành tên trình duyệt/hệ điều hành dễ đọc.
function moTaThietBi(userAgent: string | null): string {
  if (!userAgent) return 'Không rõ thiết bị'
  const trinhDuyet = /Edg\//.test(userAgent) ? 'Edge'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : /Firefox\//.test(userAgent) ? 'Firefox' : 'Trình duyệt khác'
  const heDieuHanh = /Windows/.test(userAgent) ? 'Windows'
    : /Android/.test(userAgent) ? 'Android'
    : /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Mac OS/.test(userAgent) ? 'macOS' : 'Hệ điều hành khác'
  return `${trinhDuyet} trên ${heDieuHanh}`
}

export default function SecurityPage() {
  const qc = useQueryClient()
  const [setupData, setSetupData] = useState<TotpSetup | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')

  const statusQuery = useQuery<TotpStatus>({
    queryKey: ['2fa-status'],
    queryFn: () => api.get('/me/2fa/status').then((r) => r.data),
  })
  const sessionsQuery = useQuery<SessionRow[]>({
    queryKey: ['my-sessions'],
    queryFn: () => api.get('/me/sessions').then((r) => r.data),
  })

  const setupMutation = useMutation({
    mutationFn: () => api.post('/me/2fa/setup').then((r) => r.data as TotpSetup),
    onSuccess: (data) => setSetupData(data),
    onError: (e) => message.error(getErrorMessage(e, 'Không thể bắt đầu thiết lập')),
  })
  const confirmMutation = useMutation({
    mutationFn: () => api.post('/me/2fa/confirm', { code }),
    onSuccess: () => {
      message.success('Đã bật xác thực 2 lớp')
      setSetupData(null)
      setCode('')
      void qc.invalidateQueries({ queryKey: ['2fa-status'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Mã xác thực không đúng')),
  })
  const disableMutation = useMutation({
    mutationFn: () => api.post('/me/2fa/disable', { password }),
    onSuccess: () => {
      message.success('Đã tắt xác thực 2 lớp')
      setPassword('')
      void qc.invalidateQueries({ queryKey: ['2fa-status'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể tắt xác thực 2 lớp')),
  })
  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/me/sessions/${id}`),
    onSuccess: () => {
      message.success('Đã đăng xuất thiết bị đó')
      void qc.invalidateQueries({ queryKey: ['my-sessions'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể đăng xuất phiên này')),
  })
  const revokeOthersMutation = useMutation({
    mutationFn: () => api.post('/me/sessions/revoke-others'),
    onSuccess: (r) => {
      message.success((r.data as { message: string }).message)
      void qc.invalidateQueries({ queryKey: ['my-sessions'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể đăng xuất các thiết bị khác')),
  })

  const enabled = statusQuery.data?.enabled

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Title level={1}>Bảo mật tài khoản</Title>
        </div>
      </header>

      {/* ── Xác thực 2 lớp ── */}
      <Card
        title={<Space><SafetyCertificateOutlined /> Xác thực 2 lớp (2FA)</Space>}
        extra={<Tag color={enabled ? 'success' : 'default'}>{enabled ? 'Đang bật' : 'Đang tắt'}</Tag>}
        bordered={false}
      >
        <Paragraph type="secondary">
          Khi bật, mỗi lần đăng nhập ngoài mật khẩu sẽ cần thêm mã 6 chữ số đổi mỗi 30 giây trong
          ứng dụng xác thực trên điện thoại (Google Authenticator, Microsoft Authenticator...).
        </Paragraph>

        {enabled ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>Nhập mật khẩu đăng nhập để tắt xác thực 2 lớp:</Text>
            <Space.Compact style={{ width: '100%', maxWidth: 420 }}>
              <Input.Password
                placeholder="Mật khẩu hiện tại"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button danger loading={disableMutation.isPending} disabled={!password} onClick={() => disableMutation.mutate()}>
                Tắt 2FA
              </Button>
            </Space.Compact>
          </Space>
        ) : setupData ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Alert
              type="info"
              showIcon
              message="Thêm tài khoản vào ứng dụng xác thực"
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text>Cách 1 — nhập thủ công mã bí mật dưới đây (chọn loại "Time based"):</Text>
                  <Text code copyable style={{ fontSize: 16, letterSpacing: 1 }}>{setupData.secret}</Text>
                  <Text type="secondary">Cách 2 — dán đường dẫn sau vào ứng dụng nếu ứng dụng hỗ trợ:</Text>
                  <Text code copyable style={{ wordBreak: 'break-all', fontSize: 12 }}>{setupData.otpauthUrl}</Text>
                </Space>
              }
            />
            <Text>Sau khi thêm xong, nhập mã 6 chữ số đang hiện để xác nhận:</Text>
            <Space.Compact style={{ width: '100%', maxWidth: 320 }}>
              <Input placeholder="123456" maxLength={6} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button type="primary" loading={confirmMutation.isPending} disabled={code.length !== 6} onClick={() => confirmMutation.mutate()}>
                Xác nhận bật
              </Button>
            </Space.Compact>
          </Space>
        ) : (
          <Button type="primary" loading={setupMutation.isPending} onClick={() => setupMutation.mutate()}>
            {statusQuery.data?.pendingSetup ? 'Thiết lập lại 2FA' : 'Bật xác thực 2 lớp'}
          </Button>
        )}
      </Card>

      {/* ── Phiên đăng nhập ── */}
      <Card
        title={<Space><DesktopOutlined /> Thiết bị đang đăng nhập</Space>}
        extra={
          <Popconfirm title="Đăng xuất khỏi tất cả thiết bị khác?" onConfirm={() => revokeOthersMutation.mutate()}>
            <Button size="small" danger>Đăng xuất thiết bị khác</Button>
          </Popconfirm>
        }
        bordered={false}
      >
        <List
          loading={sessionsQuery.isLoading}
          dataSource={sessionsQuery.data ?? []}
          locale={{ emptyText: 'Không có phiên đăng nhập nào' }}
          renderItem={(s) => (
            <List.Item
              actions={
                s.isCurrent
                  ? [<Tag key="cur" color="success">Thiết bị này</Tag>]
                  : [
                      <Popconfirm key="revoke" title="Đăng xuất thiết bị này?" onConfirm={() => revokeMutation.mutate(s.id)}>
                        <Button size="small" danger>Đăng xuất</Button>
                      </Popconfirm>,
                    ]
              }
            >
              <List.Item.Meta
                title={moTaThietBi(s.userAgent)}
                description={
                  <Space direction="vertical" size={0}>
                    <Text type="secondary">IP: {s.ipAddress ?? 'không rõ'}</Text>
                    <Text type="secondary">
                      Đăng nhập: {new Date(s.createdAt).toLocaleString('vi-VN')} · Hoạt động gần nhất:{' '}
                      {new Date(s.lastSeenAt).toLocaleString('vi-VN')}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  )
}
