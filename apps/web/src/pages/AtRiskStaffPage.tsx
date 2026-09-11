import { useQuery } from '@tanstack/react-query'
import { Card, Col, Empty, Row, Table, Tag, Typography } from 'antd'
import { ClockCircleOutlined, FrownOutlined, WarningOutlined } from '@ant-design/icons'
import api from '../lib/api'

const { Text } = Typography

interface NearDeadlineRow { userId: string | null; userName: string | null; quizTitle: string; endAt: string }
interface RecentFailRow { userId: string; userName: string | null; quizTitle: string | null; score: number | null; submittedAt: string | null }
interface HighViolationRow { userId: string; userName: string | null; quizTitle: string | null; violationCount: number }

interface AtRiskData {
  nearDeadlineNoSubmission: NearDeadlineRow[]
  recentFails: RecentFailRow[]
  highViolations: HighViolationRow[]
}

export default function AtRiskStaffPage() {
  const { data, isLoading } = useQuery<AtRiskData>({
    queryKey: ['at-risk-staff'],
    queryFn: () => api.get('/admin/at-risk-staff').then((r) => r.data),
  })

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Typography.Title level={1}>Cảnh báo sớm cán bộ có nguy cơ trượt/bỏ thi</Typography.Title>
        </div>
      </header>

      <Row gutter={16}>
        <Col xs={24} lg={8}>
          <Card
            size="small"
            loading={isLoading}
            title={<span><ClockCircleOutlined /> Sắp hết hạn, chưa nộp bài ({data?.nearDeadlineNoSubmission.length ?? 0})</span>}
            style={{ marginBottom: 16 }}
          >
            {data?.nearDeadlineNoSubmission.length ? (
              <Table
                size="small"
                pagination={false}
                dataSource={data.nearDeadlineNoSubmission}
                rowKey={(r) => `${r.userId}-${r.quizTitle}`}
                columns={[
                  { title: 'Cán bộ', dataIndex: 'userName', render: (v: string | null) => v ?? '—' },
                  { title: 'Bộ đề', dataIndex: 'quizTitle', ellipsis: true },
                  { title: 'Hạn chót', dataIndex: 'endAt', render: (v: string) => new Date(v).toLocaleDateString('vi-VN') },
                ]}
              />
            ) : <Empty description="Không có ai" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            size="small"
            loading={isLoading}
            title={<span><FrownOutlined /> Trượt bài trong 30 ngày qua ({data?.recentFails.length ?? 0})</span>}
            style={{ marginBottom: 16 }}
          >
            {data?.recentFails.length ? (
              <Table
                size="small"
                pagination={false}
                dataSource={data.recentFails}
                rowKey={(r, i) => `${r.userId}-${i}`}
                columns={[
                  { title: 'Cán bộ', dataIndex: 'userName', render: (v: string | null) => v ?? '—' },
                  { title: 'Bộ đề', dataIndex: 'quizTitle', ellipsis: true, render: (v: string | null) => v ?? '—' },
                  { title: 'Điểm', dataIndex: 'score', render: (v: number | null) => <Tag color="error">{v ?? '—'}%</Tag> },
                ]}
              />
            ) : <Empty description="Không có ai" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            size="small"
            loading={isLoading}
            title={<span><WarningOutlined /> Vi phạm nhiều khi làm bài ({data?.highViolations.length ?? 0})</span>}
            style={{ marginBottom: 16 }}
          >
            {data?.highViolations.length ? (
              <Table
                size="small"
                pagination={false}
                dataSource={data.highViolations}
                rowKey={(r, i) => `${r.userId}-${i}`}
                columns={[
                  { title: 'Cán bộ', dataIndex: 'userName', render: (v: string | null) => v ?? '—' },
                  { title: 'Bộ đề', dataIndex: 'quizTitle', ellipsis: true, render: (v: string | null) => v ?? '—' },
                  { title: 'Số vi phạm', dataIndex: 'violationCount', render: (v: number) => <Tag color="warning">{v}</Tag> },
                ]}
              />
            ) : <Empty description="Không có ai" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
