import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button, Form, InputNumber, Modal, Popconfirm, Select, Space, Switch, Tag, Typography, message,
} from 'antd'
import { PlayCircleOutlined, PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import ManageTable from '../components/ManageTable'
import api, { getErrorMessage } from '../lib/api'

const { Text, Title } = Typography

interface Quiz { id: string; title: string }
interface Department { id: string; name: string }
interface ScheduleRow {
  id: string
  quizId: string
  departmentId: string | null
  recurrence: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  dayOfWeek: number | null
  dayOfMonth: number | null
  durationDays: number
  isActive: boolean
  lastRunAt: string | null
  quiz: { title: string }
  department: { name: string } | null
}

const RECURRENCE_LABEL: Record<string, string> = { DAILY: 'Mỗi ngày', WEEKLY: 'Mỗi tuần', MONTHLY: 'Mỗi tháng' }
const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Thứ Hai' }, { value: 2, label: 'Thứ Ba' }, { value: 3, label: 'Thứ Tư' },
  { value: 4, label: 'Thứ Năm' }, { value: 5, label: 'Thứ Sáu' }, { value: 6, label: 'Thứ Bảy' },
  { value: 0, label: 'Chủ Nhật' },
]

export default function AssignmentSchedulesPage() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const recurrence = Form.useWatch('recurrence', form)

  const { data: rows = [], isLoading } = useQuery<ScheduleRow[]>({
    queryKey: ['assignment-schedules'],
    queryFn: () => api.get('/admin/assignment-schedules').then((r) => r.data),
  })
  const { data: quizzes = [] } = useQuery<Quiz[]>({
    queryKey: ['quizzes'],
    queryFn: () => api.get('/admin/quizzes').then((r) => r.data),
  })
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (values: unknown) => api.post('/admin/assignment-schedules', values),
    onSuccess: () => {
      message.success('Đã tạo lịch giao bài tự động')
      void qc.invalidateQueries({ queryKey: ['assignment-schedules'] })
      setModalOpen(false)
      form.resetFields()
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể tạo lịch')),
  })
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/admin/assignment-schedules/${id}/active`, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['assignment-schedules'] }),
  })
  const runNowMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/assignment-schedules/${id}/run-now`),
    onSuccess: (r) => {
      message.success(`Đã tạo ${(r.data as { count: number }).count} phân công mới`)
      void qc.invalidateQueries({ queryKey: ['assignment-schedules'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể chạy lịch')),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/assignment-schedules/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['assignment-schedules'] }),
  })

  const describeRecurrence = (r: ScheduleRow) => {
    if (r.recurrence === 'WEEKLY') return `Mỗi tuần vào ${WEEKDAY_OPTIONS.find((w) => w.value === r.dayOfWeek)?.label ?? '?'}`
    if (r.recurrence === 'MONTHLY') return `Mỗi tháng vào ngày ${r.dayOfMonth}`
    return 'Mỗi ngày'
  }

  const columns: ColumnsType<ScheduleRow> = [
    { title: 'Bộ đề', dataIndex: ['quiz', 'title'], ellipsis: true },
    { title: 'Đối tượng', render: (_: unknown, r: ScheduleRow) => r.department?.name ?? 'Toàn bộ cán bộ' },
    { title: 'Chu kỳ', render: (_: unknown, r: ScheduleRow) => describeRecurrence(r) },
    { title: 'Mở trong', dataIndex: 'durationDays', render: (v: number) => `${v} ngày` },
    {
      title: 'Lần chạy gần nhất',
      dataIndex: 'lastRunAt',
      render: (v: string | null) => (v ? new Date(v).toLocaleString('vi-VN') : 'Chưa chạy lần nào'),
    },
    {
      title: 'Hoạt động',
      dataIndex: 'isActive',
      render: (v: boolean, r: ScheduleRow) => (
        <Switch checked={v} onChange={(checked) => toggleMutation.mutate({ id: r.id, isActive: checked })} />
      ),
    },
    {
      title: 'Thao tác',
      render: (_: unknown, r: ScheduleRow) => (
        <Space>
          <Button size="small" icon={<PlayCircleOutlined />} loading={runNowMutation.isPending} onClick={() => runNowMutation.mutate(r.id)}>
            Chạy ngay
          </Button>
          <Popconfirm title="Xoá lịch này?" onConfirm={() => deleteMutation.mutate(r.id)}>
            <Button size="small" danger>Xoá</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Title level={1}>Lịch giao bài tự động</Title>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Tạo lịch mới</Button>
      </header>
      <Text type="secondary">Hệ thống tự kiểm tra mỗi giờ và tự tạo phân công mới khi tới hạn — không cần thao tác thủ công lặp lại.</Text>

      <ManageTable<ScheduleRow>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        columns={columns}
        cardHeading={(r) => <Text strong>{r.quiz.title}</Text>}
        cardBadge={(r) => <Tag color={r.isActive ? 'success' : 'default'}>{r.isActive ? 'Đang bật' : 'Đã tắt'}</Tag>}
        cardMeta={[
          { label: 'Đối tượng', render: (r) => r.department?.name ?? 'Toàn bộ cán bộ' },
          { label: 'Chu kỳ', render: describeRecurrence },
          { label: 'Mở trong', render: (r) => `${r.durationDays} ngày` },
        ]}
        cardActions={(r) => (
          <Space>
            <Button size="small" onClick={() => runNowMutation.mutate(r.id)}>Chạy ngay</Button>
            <Popconfirm title="Xoá lịch này?" onConfirm={() => deleteMutation.mutate(r.id)}>
              <Button size="small" danger>Xoá</Button>
            </Popconfirm>
          </Space>
        )}
        emptyText="Chưa có lịch giao bài tự động nào"
      />

      <Modal
        title="Tạo lịch giao bài tự động"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields() }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)} initialValues={{ recurrence: 'WEEKLY', dayOfWeek: 1, durationDays: 7 }}>
          <Form.Item name="quizId" label="Bộ đề" rules={[{ required: true, message: 'Chọn bộ đề' }]}>
            <Select options={quizzes.map((q) => ({ value: q.id, label: q.title }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="departmentId" label="Phòng ban (bỏ trống = toàn bộ cán bộ)">
            <Select allowClear options={departments.map((d) => ({ value: d.id, label: d.name }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="recurrence" label="Chu kỳ" rules={[{ required: true }]}>
            <Select options={Object.entries(RECURRENCE_LABEL).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          {recurrence === 'WEEKLY' && (
            <Form.Item name="dayOfWeek" label="Vào thứ" rules={[{ required: true }]}>
              <Select options={WEEKDAY_OPTIONS} />
            </Form.Item>
          )}
          {recurrence === 'MONTHLY' && (
            <Form.Item name="dayOfMonth" label="Vào ngày (1-31)" rules={[{ required: true }]}>
              <InputNumber min={1} max={31} style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item name="durationDays" label="Mở bài trong bao nhiêu ngày" rules={[{ required: true }]}>
            <InputNumber min={1} max={90} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
