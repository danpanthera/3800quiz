import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input, Select, Space, Tag, Typography } from 'antd'
import ManageTable from '../components/ManageTable'
import api from '../lib/api'

const { Text } = Typography

interface ViolationRow {
  id: string
  type: string
  occurredAt: string
  attemptId: string
  userId: string
  userName: string
  username: string
  quizId: string
  quizTitle: string
  attemptStatus: 'IN_PROGRESS' | 'GRADED'
  totalViolationsInAttempt: number
}

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  TAB_HIDDEN: { label: 'Rời tab / thu nhỏ cửa sổ', color: 'warning' },
  FULLSCREEN_EXIT: { label: 'Thoát toàn màn hình', color: 'orange' },
  COPY_ATTEMPT: { label: 'Cố sao chép đề bài', color: 'error' },
}

export default function AttemptViolationsPage() {
  const [searchName, setSearchName] = useState('')
  const [filterType, setFilterType] = useState<string>()

  const { data: rows = [], isLoading } = useQuery<ViolationRow[]>({
    queryKey: ['attempt-violations', filterType],
    queryFn: () => api.get('/admin/attempt-violations', { params: { type: filterType } }).then((r) => r.data),
  })

  const filtered = useMemo(() => {
    const q = searchName.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.userName.toLowerCase().includes(q) || r.username.toLowerCase().includes(q),
    )
  }, [rows, searchName])

  const columns = [
    {
      title: 'Thời gian',
      dataIndex: 'occurredAt',
      width: 170,
      sorter: (a: ViolationRow, b: ViolationRow) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (v: string) => new Date(v).toLocaleString('vi-VN'),
    },
    { title: 'Cán bộ', dataIndex: 'userName' },
    { title: 'Bộ đề', dataIndex: 'quizTitle', ellipsis: true },
    {
      title: 'Loại vi phạm',
      dataIndex: 'type',
      render: (v: string) => <Tag color={TYPE_LABEL[v]?.color ?? 'default'}>{TYPE_LABEL[v]?.label ?? v}</Tag>,
    },
    {
      title: 'Tổng vi phạm trong bài',
      dataIndex: 'totalViolationsInAttempt',
      width: 160,
      align: 'center' as const,
      sorter: (a: ViolationRow, b: ViolationRow) => a.totalViolationsInAttempt - b.totalViolationsInAttempt,
    },
    {
      title: 'Trạng thái bài làm',
      dataIndex: 'attemptStatus',
      width: 140,
      render: (v: string) => <Tag color={v === 'GRADED' ? 'success' : 'processing'}>{v === 'GRADED' ? 'Đã nộp' : 'Đang làm dở'}</Tag>,
    },
  ]

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Typography.Title level={1}>Giám sát vi phạm khi làm bài</Typography.Title>
        </div>
      </header>

      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          placeholder="Tìm theo tên cán bộ..."
          style={{ width: 260 }}
          allowClear
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
        />
        <Select
          placeholder="Loại vi phạm"
          style={{ width: 240 }}
          allowClear
          value={filterType}
          onChange={setFilterType}
          options={Object.entries(TYPE_LABEL).map(([value, { label }]) => ({ value, label }))}
        />
      </Space>

      <ManageTable<ViolationRow>
        rowKey="id"
        loading={isLoading}
        dataSource={filtered}
        columns={columns}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
        size="small"
        scroll={{ x: 'max-content' }}
        cardHeading={(r) => <Text strong>{r.userName}</Text>}
        cardBadge={(r) => <Tag color={TYPE_LABEL[r.type]?.color ?? 'default'}>{TYPE_LABEL[r.type]?.label ?? r.type}</Tag>}
        cardMeta={[
          { label: 'Thời gian', render: (r) => new Date(r.occurredAt).toLocaleString('vi-VN') },
          { label: 'Bộ đề', render: (r) => r.quizTitle },
          { label: 'Tổng vi phạm trong bài', render: (r) => r.totalViolationsInAttempt },
          { label: 'Trạng thái bài làm', render: (r) => (r.attemptStatus === 'GRADED' ? 'Đã nộp' : 'Đang làm dở') },
        ]}
        emptyText="Chưa ghi nhận vi phạm nào khớp bộ lọc"
      />
    </div>
  )
}
