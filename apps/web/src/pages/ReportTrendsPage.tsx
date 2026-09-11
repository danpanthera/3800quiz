import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Progress, Segmented, Space, Typography } from 'antd'
import ManageTable from '../components/ManageTable'
import api from '../lib/api'

const { Text } = Typography

interface TrendRow {
  period: string
  totalSubmissions: number
  avgScore: number
  passRate: number
}

export default function ReportTrendsPage() {
  const [groupBy, setGroupBy] = useState<'week' | 'month'>('week')

  const { data: rows = [], isLoading } = useQuery<TrendRow[]>({
    queryKey: ['report-trends', groupBy],
    queryFn: () => api.get('/admin/reports/trends', { params: { groupBy } }).then((r) => r.data),
  })

  const columns = [
    { title: groupBy === 'week' ? 'Tuần' : 'Tháng', dataIndex: 'period', width: 120 },
    { title: 'Số bài nộp', dataIndex: 'totalSubmissions', width: 110, align: 'center' as const },
    {
      title: 'Điểm trung bình',
      dataIndex: 'avgScore',
      render: (v: number) => (
        <Space>
          <Progress percent={v} size="small" style={{ width: 160 }} />
          <Text>{v}%</Text>
        </Space>
      ),
    },
    {
      title: 'Tỷ lệ đạt',
      dataIndex: 'passRate',
      render: (v: number) => (
        <Space>
          <Progress percent={v} size="small" strokeColor={v >= 60 ? '#52c41a' : '#faad14'} style={{ width: 160 }} />
          <Text>{v}%</Text>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Typography.Title level={1}>Xu hướng điểm & tỷ lệ đạt</Typography.Title>
        </div>
      </header>

      <Segmented
        value={groupBy}
        onChange={(v) => setGroupBy(v as typeof groupBy)}
        options={[
          { label: 'Theo tuần', value: 'week' },
          { label: 'Theo tháng', value: 'month' },
        ]}
        style={{ marginBottom: 16 }}
      />

      <ManageTable<TrendRow>
        rowKey="period"
        loading={isLoading}
        dataSource={rows}
        columns={columns}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        cardHeading={(r) => <Text strong>{r.period}</Text>}
        cardMeta={[
          { label: 'Số bài nộp', render: (r) => r.totalSubmissions },
          { label: 'Điểm trung bình', render: (r) => `${r.avgScore}%` },
          { label: 'Tỷ lệ đạt', render: (r) => `${r.passRate}%` },
        ]}
        emptyText="Chưa có bài thi nào đã chấm để thống kê"
      />
    </div>
  )
}
