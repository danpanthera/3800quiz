import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tabs, Tag, Space, Select, Typography, Card, Badge, Avatar, Tooltip } from 'antd'
import { TrophyOutlined, StarOutlined, HistoryOutlined, UserOutlined } from '@ant-design/icons'
import ManageTable from '../components/ManageTable'
import api from '../lib/api'

const { Title, Text } = Typography

type LeaderboardRow = {
  rank: number
  userId: string
  fullName: string
  department?: string
  xp: number
  level?: number
  levelName?: string | null
}

type BadgeStat = {
  id: string
  code: string
  name: string
  category: string
  iconSlug: string
  xpBonus: number
  awardedCount: number
}

type XpTx = {
  id: string
  userId: string
  amount: number
  source: string
  note?: string
  referenceId?: string
  createdAt: string
}

const CATEGORY_COLOR: Record<string, string> = {
  EXAM: 'blue',
  STREAK: 'orange',
  ARENA: 'red',
  PROGRESS: 'green',
  LEVEL: 'purple',
  SPEED: 'gold',
  MASTERY: 'cyan',
  SPECIAL: 'magenta',
}

const PERIOD_OPTIONS = [
  { label: 'Tất cả', value: 'all' },
  { label: 'Tháng này', value: 'month' },
  { label: 'Tuần này', value: 'week' },
]

export default function AchievementsPage() {
  const [period, setPeriod] = useState<'all' | 'month' | 'week'>('all')

  const leaderboardQ = useQuery<LeaderboardRow[]>({
    queryKey: ['leaderboard', period],
    queryFn: () => api.get(`/admin/leaderboard?period=${period}`).then((r) => r.data),
  })

  const badgeStatsQ = useQuery<BadgeStat[]>({
    queryKey: ['badge-stats'],
    queryFn: () => api.get('/admin/badge-stats').then((r) => r.data),
  })

  const xpHistoryQ = useQuery<{ items: XpTx[]; total: number }>({
    queryKey: ['xp-history-all'],
    queryFn: () => api.get('/me/xp-history?limit=100').then((r) => r.data),
  })

  const leaderboardCols = [
    {
      title: 'Hạng',
      dataIndex: 'rank',
      width: 70,
      render: (rank: number) => {
        if (rank === 1) return <Text style={{ fontSize: 20 }}>🥇</Text>
        if (rank === 2) return <Text style={{ fontSize: 20 }}>🥈</Text>
        if (rank === 3) return <Text style={{ fontSize: 20 }}>🥉</Text>
        return <Text strong>#{rank}</Text>
      },
    },
    {
      title: 'Cán bộ',
      dataIndex: 'fullName',
      render: (name: string) => (
        <Space>
          <Avatar size="small" icon={<UserOutlined />} />
          <Text strong>{name}</Text>
        </Space>
      ),
    },
    { title: 'Đơn vị', dataIndex: 'department', render: (d?: string) => d ?? '—' },
    {
      title: 'XP',
      dataIndex: 'xp',
      sorter: (a: LeaderboardRow, b: LeaderboardRow) => b.xp - a.xp,
      render: (xp: number) => <Tag color="gold">⭐ {xp.toLocaleString()} XP</Tag>,
    },
    {
      title: 'Cấp',
      dataIndex: 'levelName',
      render: (levelName: string | null | undefined, row: LeaderboardRow) =>
        row.level ? <Tag color="blue">{levelName ?? `Cấp ${row.level}`}</Tag> : '—',
    },
  ]

  const xpHistoryCols = [
    {
      title: 'Thời gian',
      dataIndex: 'createdAt',
      render: (d: string) => new Date(d).toLocaleString('vi-VN'),
      width: 180,
    },
    {
      title: 'Nguồn',
      dataIndex: 'source',
      render: (src: string) => <Tag>{src.replace('_', ' ')}</Tag>,
    },
    {
      title: 'XP',
      dataIndex: 'amount',
      render: (n: number) => <Text style={{ color: n > 0 ? '#52c41a' : '#ff4d4f' }}>+{n}</Text>,
    },
    { title: 'Ghi chú', dataIndex: 'note', render: (n?: string) => n ?? '—' },
  ]

  const items = [
    {
      key: 'leaderboard',
      label: (
        <span>
          <TrophyOutlined /> Bảng xếp hạng
        </span>
      ),
      children: (
        <Card
          bordered={false}
          extra={
            <Select
              value={period}
              onChange={setPeriod}
              options={PERIOD_OPTIONS}
              style={{ width: 130 }}
            />
          }
          title={<Title level={5} style={{ margin: 0 }}>Top XP</Title>}
        >
          <ManageTable<LeaderboardRow>
            dataSource={leaderboardQ.data ?? []}
            columns={leaderboardCols}
            rowKey="userId"
            loading={leaderboardQ.isLoading}
            pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
            size="middle"
            cardHeading={(row) => (
              <Space>
                <Avatar size="small" icon={<UserOutlined />} />
                <Text strong>{row.fullName}</Text>
              </Space>
            )}
            cardBadge={(row) => {
              if (row.rank === 1) return <Text style={{ fontSize: 20 }}>🥇</Text>
              if (row.rank === 2) return <Text style={{ fontSize: 20 }}>🥈</Text>
              if (row.rank === 3) return <Text style={{ fontSize: 20 }}>🥉</Text>
              return <Text strong>#{row.rank}</Text>
            }}
            cardMeta={[
              { label: 'Đơn vị', render: (row) => row.department ?? '—' },
              { label: 'XP', render: (row) => <Tag color="gold">⭐ {row.xp.toLocaleString()} XP</Tag> },
              { label: 'Cấp', render: (row) => row.level ? <Tag color="blue">{row.levelName ?? `Cấp ${row.level}`}</Tag> : '—' },
            ]}
          />
        </Card>
      ),
    },
    {
      key: 'badges',
      label: (
        <span>
          <StarOutlined /> Huy hiệu
        </span>
      ),
      children: (
        <Card bordered={false} title={<Title level={5} style={{ margin: 0 }}>15 Huy hiệu</Title>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {(badgeStatsQ.data ?? []).map((badge) => (
              <Card key={badge.id} size="small" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🏅</div>
                <Text strong>{badge.name}</Text>
                <br />
                <Tag color={CATEGORY_COLOR[badge.category] ?? 'default'} style={{ marginTop: 4 }}>
                  {badge.category}
                </Tag>
                {badge.xpBonus > 0 && (
                  <Tag color="gold" style={{ marginTop: 4 }}>+{badge.xpBonus} XP</Tag>
                )}
                <br />
                <Tooltip title="Số người đã đạt được">
                  <Badge
                    count={badge.awardedCount}
                    showZero
                    style={{ backgroundColor: '#1677ff', marginTop: 8 }}
                    overflowCount={9999}
                  />
                </Tooltip>
                <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                  người đạt
                </Text>
              </Card>
            ))}
          </div>
        </Card>
      ),
    },
    {
      key: 'xp-history',
      label: (
        <span>
          <HistoryOutlined /> Lịch sử XP
        </span>
      ),
      children: (
        <Card bordered={false} title={<Title level={5} style={{ margin: 0 }}>Lịch sử giao dịch XP</Title>}>
          <ManageTable<XpTx>
            dataSource={xpHistoryQ.data?.items ?? []}
            columns={xpHistoryCols}
            rowKey="id"
            loading={xpHistoryQ.isLoading}
            pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
            size="small"
            cardHeading={(row) => <Tag>{row.source.replace('_', ' ')}</Tag>}
            cardMeta={[
              { label: 'Thời gian', render: (row) => new Date(row.createdAt).toLocaleString('vi-VN') },
              { label: 'XP', render: (row) => <Text style={{ color: row.amount > 0 ? '#52c41a' : '#ff4d4f' }}>+{row.amount}</Text> },
              { label: 'Ghi chú', render: (row) => row.note ?? '—' },
            ]}
          />
        </Card>
      ),
    },
  ]

  return (
    <div>
      <Title level={3}>
        <TrophyOutlined style={{ marginRight: 8, color: '#faad14' }} />
        Thành tích & Xếp hạng
      </Title>
      <Tabs items={items} defaultActiveKey="leaderboard" />
    </div>
  )
}
