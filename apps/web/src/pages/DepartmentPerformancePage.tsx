import { useQuery } from '@tanstack/react-query'
import { Progress, Space, Tag, Typography } from 'antd'
import ManageTable from '../components/ManageTable'
import api from '../lib/api'

const { Text } = Typography

interface DepartmentPerformanceRow {
  id: string
  name: string
  parentId: string | null
  totalSubmissions: number
  avgScore: number | null
  passRate: number | null
}

export default function DepartmentPerformancePage() {
  const { data: rows = [], isLoading } = useQuery<DepartmentPerformanceRow[]>({
    queryKey: ['department-performance'],
    queryFn: () => api.get('/admin/department-performance').then((r) => r.data),
  })

  const columns = [
    {
      title: 'Đơn vị',
      dataIndex: 'name',
      render: (v: string, r: DepartmentPerformanceRow) => (r.parentId ? v : <Text strong>{v}</Text>),
    },
    {
      title: 'Số bài nộp',
      dataIndex: 'totalSubmissions',
      width: 110,
      align: 'center' as const,
      sorter: (a: DepartmentPerformanceRow, b: DepartmentPerformanceRow) => a.totalSubmissions - b.totalSubmissions,
    },
    {
      title: 'Điểm trung bình',
      dataIndex: 'avgScore',
      sorter: (a: DepartmentPerformanceRow, b: DepartmentPerformanceRow) => (a.avgScore ?? 0) - (b.avgScore ?? 0),
      render: (v: number | null) => v !== null ? (
        <Space>
          <Progress percent={v} size="small" style={{ width: 140 }} status={v < 60 ? 'exception' : 'normal'} />
          <Text>{v}%</Text>
        </Space>
      ) : '—',
    },
    {
      title: 'Tỷ lệ đạt',
      dataIndex: 'passRate',
      render: (v: number | null) => v !== null ? (
        <Space>
          <Progress percent={v} size="small" strokeColor={v >= 60 ? '#52c41a' : '#faad14'} style={{ width: 140 }} />
          <Text>{v}%</Text>
        </Space>
      ) : '—',
    },
  ]

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Typography.Title level={1}>So sánh hiệu suất theo chi nhánh/phòng ban</Typography.Title>
        </div>
      </header>

      <Typography.Paragraph type="secondary">
        Chỉ hiện các đơn vị đã có ít nhất 1 bài thi được chấm, sắp điểm trung bình thấp nhất lên đầu.
      </Typography.Paragraph>

      <ManageTable<DepartmentPerformanceRow>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        columns={columns}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
        size="small"
        scroll={{ x: 'max-content' }}
        cardHeading={(r) => <Text strong>{r.name}</Text>}
        cardBadge={(r) => r.avgScore !== null && r.avgScore < 60 ? <Tag color="error">Cần chú ý</Tag> : null}
        cardMeta={[
          { label: 'Số bài nộp', render: (r) => r.totalSubmissions },
          { label: 'Điểm trung bình', render: (r) => (r.avgScore !== null ? `${r.avgScore}%` : '—') },
          { label: 'Tỷ lệ đạt', render: (r) => (r.passRate !== null ? `${r.passRate}%` : '—') },
        ]}
        emptyText="Chưa có dữ liệu bài thi để so sánh"
      />
    </div>
  )
}
