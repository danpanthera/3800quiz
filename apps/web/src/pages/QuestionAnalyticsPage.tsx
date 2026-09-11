import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Progress, Select, Space, Tag, Typography } from 'antd'
import ManageTable from '../components/ManageTable'
import api from '../lib/api'

const { Text } = Typography

interface Quiz { id: string; title: string }
interface Subject { id: string; name: string }

interface QuestionAnalyticsRow {
  id: string
  content: string
  questionType: string
  quizId: string
  quizTitle: string | null
  subjectName: string | null
  totalAttempts: number
  correctCount: number
  correctRate: number | null
  discrimination: number | null
}

function danhGiaCauHoi(row: QuestionAnalyticsRow) {
  if (row.correctRate !== null && row.correctRate <= 30) return { label: 'Quá khó', color: 'error' }
  if (row.correctRate !== null && row.correctRate >= 95) return { label: 'Quá dễ', color: 'blue' }
  if (row.discrimination !== null && row.discrimination < 20) return { label: 'Cần xem lại', color: 'warning' }
  return null
}

export default function QuestionAnalyticsPage() {
  const [filterQuiz, setFilterQuiz] = useState<string>()
  const [filterSubject, setFilterSubject] = useState<string>()

  const { data: quizzes = [] } = useQuery<Quiz[]>({
    queryKey: ['quizzes-for-filter'],
    queryFn: () => api.get('/admin/quizzes').then((r) => r.data),
  })
  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ['subjects'],
    queryFn: () => api.get('/admin/subjects').then((r) => r.data),
  })

  const { data: rows = [], isLoading } = useQuery<QuestionAnalyticsRow[]>({
    queryKey: ['question-analytics', filterQuiz, filterSubject],
    queryFn: () =>
      api
        .get('/admin/question-analytics', { params: { quizId: filterQuiz, subjectId: filterSubject } })
        .then((r) => r.data),
  })

  const quizOptions = useMemo(() => quizzes.map((q) => ({ value: q.id, label: q.title })), [quizzes])
  const subjectOptions = useMemo(() => subjects.map((s) => ({ value: s.id, label: s.name })), [subjects])

  const columns = [
    { title: 'Bộ đề', dataIndex: 'quizTitle', render: (v: string | null) => v ?? '—', ellipsis: true },
    { title: 'Lĩnh vực', dataIndex: 'subjectName', width: 130, render: (v: string | null) => v ?? '—' },
    { title: 'Nội dung câu hỏi', dataIndex: 'content', ellipsis: true },
    {
      title: 'Số lượt làm',
      dataIndex: 'totalAttempts',
      width: 100,
      align: 'center' as const,
      sorter: (a: QuestionAnalyticsRow, b: QuestionAnalyticsRow) => a.totalAttempts - b.totalAttempts,
    },
    {
      title: 'Tỷ lệ đúng',
      dataIndex: 'correctRate',
      width: 180,
      sorter: (a: QuestionAnalyticsRow, b: QuestionAnalyticsRow) => (a.correctRate ?? 0) - (b.correctRate ?? 0),
      render: (v: number | null) =>
        v !== null ? (
          <Space>
            <Progress percent={v} size="small" style={{ width: 100 }} status={v <= 30 ? 'exception' : 'normal'} />
            <Text>{v}%</Text>
          </Space>
        ) : '—',
    },
    {
      title: 'Độ phân biệt',
      dataIndex: 'discrimination',
      width: 110,
      align: 'center' as const,
      render: (v: number | null) => (v !== null ? `${v}%` : <Text type="secondary">Chưa đủ dữ liệu</Text>),
    },
    {
      title: 'Đánh giá',
      key: 'assessment',
      width: 120,
      render: (_: unknown, r: QuestionAnalyticsRow) => {
        const a = danhGiaCauHoi(r)
        return a ? <Tag color={a.color}>{a.label}</Tag> : <Tag color="success">Ổn</Tag>
      },
    },
  ]

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Typography.Title level={1}>Phân tích câu hỏi toàn hệ thống</Typography.Title>
        </div>
      </header>

      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          placeholder="Bộ đề"
          style={{ width: 240 }}
          allowClear
          value={filterQuiz}
          onChange={setFilterQuiz}
          options={quizOptions}
          showSearch
          filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        />
        <Select
          placeholder="Lĩnh vực"
          style={{ width: 200 }}
          allowClear
          value={filterSubject}
          onChange={setFilterSubject}
          options={subjectOptions}
        />
      </Space>

      <ManageTable<QuestionAnalyticsRow>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        columns={columns}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
        size="small"
        scroll={{ x: 'max-content' }}
        cardHeading={(r) => <Text strong>{r.content}</Text>}
        cardBadge={(r) => {
          const a = danhGiaCauHoi(r)
          return a ? <Tag color={a.color}>{a.label}</Tag> : <Tag color="success">Ổn</Tag>
        }}
        cardMeta={[
          { label: 'Bộ đề', render: (r) => r.quizTitle ?? '—' },
          { label: 'Lĩnh vực', render: (r) => r.subjectName ?? '—' },
          { label: 'Số lượt làm', render: (r) => r.totalAttempts },
          { label: 'Tỷ lệ đúng', render: (r) => (r.correctRate !== null ? `${r.correctRate}%` : '—') },
          { label: 'Độ phân biệt', render: (r) => (r.discrimination !== null ? `${r.discrimination}%` : 'Chưa đủ dữ liệu') },
        ]}
        emptyText="Chưa có câu hỏi nào phát sinh dữ liệu làm bài"
      />
    </div>
  )
}
