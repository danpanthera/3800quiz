import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Popconfirm, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { LockOutlined, UnlockOutlined } from '@ant-design/icons'
import ManageTable from '../components/ManageTable'
import api, { getErrorMessage } from '../lib/api'

const { Title, Text } = Typography

interface LockedUserRow {
  id: string
  username: string
  fullName: string
  failedLoginCount: number
  lockedUntil: string | null
  totpEnabled: boolean
  isLocked: boolean
}

interface SessionRow {
  id: string
  userId: string
  username: string | null
  fullName: string | null
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  lastSeenAt: string
}

export default function AdminSecurityPage() {
  const qc = useQueryClient()

  const lockedQuery = useQuery<LockedUserRow[]>({
    queryKey: ['admin-locked-users'],
    queryFn: () => api.get('/admin/security/locked-users').then((r) => r.data),
  })
  const sessionsQuery = useQuery<SessionRow[]>({
    queryKey: ['admin-sessions'],
    queryFn: () => api.get('/admin/security/sessions').then((r) => r.data),
  })

  const unlockMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/admin/security/users/${userId}/unlock`),
    onSuccess: () => {
      message.success('Đã mở khóa tài khoản')
      void qc.invalidateQueries({ queryKey: ['admin-locked-users'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể mở khóa tài khoản')),
  })
  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/security/sessions/${id}`),
    onSuccess: () => {
      message.success('Đã buộc đăng xuất phiên đăng nhập')
      void qc.invalidateQueries({ queryKey: ['admin-sessions'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể thu hồi phiên')),
  })

  const lockedColumns: ColumnsType<LockedUserRow> = [
    { title: 'Tài khoản', dataIndex: 'username' },
    { title: 'Họ tên', dataIndex: 'fullName' },
    {
      title: 'Trạng thái',
      render: (_, r) =>
        r.isLocked ? (
          <Tag icon={<LockOutlined />} color="error">
            Bị khóa tới {new Date(r.lockedUntil as string).toLocaleTimeString('vi-VN')}
          </Tag>
        ) : (
          <Tag color="warning">Đang có {r.failedLoginCount} lần sai</Tag>
        ),
    },
    {
      title: '2 lớp',
      dataIndex: 'totpEnabled',
      render: (v: boolean) => (v ? <Tag color="success">Đã bật</Tag> : <Tag>Chưa bật</Tag>),
    },
    {
      title: 'Thao tác',
      render: (_, r) => (
        <Popconfirm title={`Mở khóa tài khoản ${r.username}?`} onConfirm={() => unlockMutation.mutate(r.id)}>
          <Button size="small" icon={<UnlockOutlined />}>Mở khóa</Button>
        </Popconfirm>
      ),
    },
  ]

  const sessionColumns: ColumnsType<SessionRow> = [
    { title: 'Tài khoản', render: (_, r) => `${r.fullName ?? '?'} (${r.username ?? '?'})` },
    { title: 'IP', dataIndex: 'ipAddress', render: (v: string | null) => v ?? '—' },
    { title: 'Thiết bị', dataIndex: 'userAgent', ellipsis: true, render: (v: string | null) => v ?? '—' },
    {
      title: 'Đăng nhập lúc',
      dataIndex: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString('vi-VN'),
    },
    {
      title: 'Hoạt động gần nhất',
      dataIndex: 'lastSeenAt',
      sorter: (a, b) => new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime(),
      defaultSortOrder: 'descend',
      render: (v: string) => new Date(v).toLocaleString('vi-VN'),
    },
    {
      title: 'Thao tác',
      render: (_, r) => (
        <Popconfirm title="Buộc đăng xuất phiên này?" onConfirm={() => revokeMutation.mutate(r.id)}>
          <Button size="small" danger>Buộc đăng xuất</Button>
        </Popconfirm>
      ),
    },
  ]

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Title level={1}>Giám sát bảo mật</Title>
        </div>
      </header>
      <Text type="secondary">
        Tài khoản bị khóa tạm sau 5 lần đăng nhập sai liên tiếp (mở lại sau 15 phút, hoặc admin mở khóa ngay tại đây).
      </Text>

      <section>
        <Title level={4} style={{ marginTop: 24 }}>Tài khoản đang bị khóa / có lần đăng nhập sai</Title>
        <ManageTable<LockedUserRow>
          rowKey="id"
          loading={lockedQuery.isLoading}
          dataSource={lockedQuery.data ?? []}
          columns={lockedColumns}
          cardHeading={(r) => <Text strong>{r.fullName}</Text>}
          cardBadge={(r) => (r.isLocked ? <Tag color="error">Bị khóa</Tag> : <Tag color="warning">{r.failedLoginCount} lần sai</Tag>)}
          cardMeta={[
            { label: 'Tài khoản', render: (r) => r.username },
            { label: 'Xác thực 2 lớp', render: (r) => (r.totpEnabled ? 'Đã bật' : 'Chưa bật') },
          ]}
          cardActions={(r) => (
            <Popconfirm title={`Mở khóa ${r.username}?`} onConfirm={() => unlockMutation.mutate(r.id)}>
              <Button size="small">Mở khóa</Button>
            </Popconfirm>
          )}
          emptyText="Không có tài khoản nào đang bị khóa"
        />
      </section>

      <section>
        <Title level={4} style={{ marginTop: 24 }}>Phiên đăng nhập đang hoạt động toàn hệ thống</Title>
        <ManageTable<SessionRow>
          rowKey="id"
          loading={sessionsQuery.isLoading}
          dataSource={sessionsQuery.data ?? []}
          columns={sessionColumns}
          scroll={{ x: 'max-content' }}
          cardHeading={(r) => <Text strong>{r.fullName ?? r.username ?? '?'}</Text>}
          cardMeta={[
            { label: 'IP', render: (r) => r.ipAddress ?? '—' },
            { label: 'Hoạt động gần nhất', render: (r) => new Date(r.lastSeenAt).toLocaleString('vi-VN') },
          ]}
          cardActions={(r) => (
            <Popconfirm title="Buộc đăng xuất phiên này?" onConfirm={() => revokeMutation.mutate(r.id)}>
              <Button size="small" danger>Buộc đăng xuất</Button>
            </Popconfirm>
          )}
          emptyText="Không có phiên đăng nhập nào đang hoạt động"
        />
      </section>
    </div>
  )
}
