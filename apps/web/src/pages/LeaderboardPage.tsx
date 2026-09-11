import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Segmented, Tag, Typography } from 'antd'
import { TrophyOutlined } from '@ant-design/icons'
import ManageTable from '../components/ManageTable'
import api from '../lib/api'
import { useAuth } from '../lib/useAuth'

const { Text } = Typography

interface LeaderboardRow {
  rank: number
  userId: string
  fullName: string
  department?: string
  xp: number
  level: number
  levelName?: string | null
}

const MEDAL_COLOR: Record<number, string> = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' }

export default function LeaderboardPage() {
  const { user } = useAuth()
  const [period, setPeriod] = useState<'all' | 'month' | 'week'>('all')

  const { data: rows = [], isLoading } = useQuery<LeaderboardRow[]>({
    queryKey: ['my-leaderboard', period],
    queryFn: () => api.get('/me/leaderboard', { params: { period } }).then((r) => r.data),
  })

  const columns = [
    {
      title: 'Hạng',
      dataIndex: 'rank',
      width: 80,
      render: (v: number) => (
        <Text strong style={{ color: MEDAL_COLOR[v] }}>
          {MEDAL_COLOR[v] ? <TrophyOutlined /> : null} #{v}
        </Text>
      ),
    },
    {
      title: 'Họ tên',
      dataIndex: 'fullName',
      render: (v: string, r: LeaderboardRow) =>
        r.userId === user?.id ? <Text strong>{v} <Tag color="green">Bạn</Tag></Text> : v,
    },
    { title: 'Phòng ban', dataIndex: 'department', render: (v?: string) => v ?? '—' },
    {
      title: 'Cấp độ',
      dataIndex: 'levelName',
      width: 140,
      render: (levelName: string | null | undefined, r: LeaderboardRow) => levelName ?? `Cấp ${r.level}`,
    },
    { title: 'XP', dataIndex: 'xp', width: 100, sorter: (a: LeaderboardRow, b: LeaderboardRow) => a.xp - b.xp },
  ]

  return (
    <div className="page-stack">
      {/* Tự chứa CSS ngay trong trang — không đụng index.css (đang được sửa
          song song bởi phiên khác) chỉ để tô đậm dòng của chính mình. */}
      <style>{'.leaderboard-row-me { background: rgba(37, 99, 235, 0.06); }'}</style>
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Typography.Title level={1}>Bảng xếp hạng</Typography.Title>
        </div>
      </header>

      <Segmented
        value={period}
        onChange={(v) => setPeriod(v as typeof period)}
        options={[
          { label: 'Toàn thời gian', value: 'all' },
          { label: 'Tháng này', value: 'month' },
          { label: 'Tuần này', value: 'week' },
        ]}
        style={{ marginBottom: 16 }}
      />

      <ManageTable<LeaderboardRow>
        rowKey="userId"
        loading={isLoading}
        dataSource={rows}
        columns={columns}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
        size="small"
        rowClassName={(r) => (r.userId === user?.id ? 'leaderboard-row-me' : '')}
        cardHeading={(r) => <Text strong>#{r.rank} · {r.fullName}</Text>}
        cardBadge={(r) => (r.userId === user?.id ? <Tag color="green">Bạn</Tag> : null)}
        cardMeta={[
          { label: 'Phòng ban', render: (r) => r.department ?? '—' },
          { label: 'Cấp độ', render: (r) => r.levelName ?? `Cấp ${r.level}` },
          { label: 'XP', render: (r) => r.xp },
        ]}
        emptyText="Chưa có dữ liệu xếp hạng"
      />
    </div>
  )
}
