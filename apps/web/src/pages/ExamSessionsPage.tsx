import { useState } from 'react'
import {
  Button, Table, Space, Modal, Form, Input, Select, InputNumber,
  Switch, Popconfirm, Typography, message, Tag, Drawer,
  Statistic, Row, Col, Progress, Empty, DatePicker,
  Tabs, Badge, Tooltip,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  PlayCircleOutlined, StopOutlined, TrophyOutlined, BarChartOutlined,
  DownloadOutlined, UserOutlined, HistoryOutlined,
  WarningOutlined, SafetyCertificateOutlined, CopyOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import ManageTable from '../components/ManageTable'
import api, { getErrorMessage } from '../lib/api'

interface AcademicYear { id: string; name: string }
interface ClassItem { id: string; name: string; code: string }
interface Quiz { id: string; title: string; durationMin: number }
interface ExamSession {
  id: string; name: string; status: string
  startAt: string; endAt: string
  maxAttempts: number; scoringPolicy: string
  durationMin?: number; shuffleQuestions: boolean; shuffleOptions: boolean
  showResultAfter: string; allowReview: boolean
  quizId: string; classId: string
  quiz?: { id: string; title: string; durationMin: number }
  class?: { id: string; name: string; code: string }
}
// Dữ liệu Form modal tạo/sửa đợt thi — "range" là RangePicker, tách thành startAt/endAt khi submit
type ExamSessionFormValues = Omit<ExamSession, 'id' | 'status' | 'quiz' | 'class' | 'startAt' | 'endAt'> & {
  range: [dayjs.Dayjs, dayjs.Dayjs]
}
// Body thực gửi lên API sau khi tách range → startAt/endAt (dùng chung cho create/update)
type ExamSessionBody = Omit<ExamSession, 'id' | 'status' | 'quiz' | 'class'>
interface GradebookEntry {
  user: { id: string; fullName: string; username: string }
  attempts: number; finalScore: number | null; isPassed: boolean | null
  lastSubmittedAt: string | null
}
interface LeaderboardEntry extends GradebookEntry { rank: number }
interface AttemptEntry {
  attempt: number; id: string; score: number | null; isPassed: boolean | null; submittedAt: string; status: string
}
interface QuestionStat {
  index: number; id: string; content: string; questionType: string
  options: { id: string; content: string; isCorrect: boolean }[]
  totalAttempts: number; correctCount: number; wrongCount: number; correctRate: number | null
}
interface NotAttemptedUser { id: string; fullName: string; username: string; email: string }
interface CertificateData {
  studentName: string; username: string; quizTitle: string; sessionName: string; className: string
  score: number | null; passScore: number; submittedAt: string; issuedAt: string
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Nháp', color: 'default' },
  OPEN: { label: 'Đang mở', color: 'green' },
  CLOSED: { label: 'Đã đóng', color: 'red' },
}
const SCORING_OPTIONS = [
  { value: 'HIGHEST', label: 'Điểm cao nhất' }, { value: 'FIRST', label: 'Lần đầu tiên' },
  { value: 'LAST', label: 'Lần cuối cùng' }, { value: 'AVERAGE', label: 'Trung bình' },
]
const SHOW_RESULT_OPTIONS = [
  { value: 'IMMEDIATE', label: 'Ngay sau khi nộp' },
  { value: 'AFTER_DEADLINE', label: 'Sau khi hết hạn đợt thi' },
  { value: 'NEVER', label: 'Không hiện' },
]

function openCertificatePrint(cert: CertificateData) {
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
<title>Chứng nhận — ${cert.studentName}</title>
<style>
  body{font-family:"Times New Roman",serif;margin:0;padding:40px;background:#f9f7f0}
  .cert{border:8px double #c8a84b;padding:48px 56px;max-width:720px;margin:0 auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.15)}
  .org{font-size:13px;text-transform:uppercase;letter-spacing:3px;color:#888;margin-bottom:4px}
  .logo{font-size:64px;margin:12px 0}
  .title{font-size:34px;font-weight:bold;color:#8b0000;margin:8px 0 4px;letter-spacing:1px}
  .line{border:none;border-top:2px solid #c8a84b;width:60%;margin:16px auto}
  .label{font-size:15px;color:#555;margin:0}
  .name{font-size:28px;font-weight:bold;color:#1a237e;margin:10px 0;display:inline-block;border-bottom:2px solid #c8a84b;padding-bottom:4px}
  .quiz{font-size:17px;font-style:italic;color:#333;margin:12px 0 4px}
  .score{font-size:52px;font-weight:bold;color:#2e7d32;margin:8px 0 0}
  .score-label{font-size:15px;color:#666;margin:0 0 16px}
  .meta{font-size:13px;color:#777;margin:6px 0}
  .sigs{display:flex;justify-content:space-around;margin-top:52px}
  .sig{text-align:center;font-size:13px}
  .sig-line{border-top:1px solid #555;width:180px;margin:0 auto 6px}
  @media print{body{padding:0;background:#fff}.cert{box-shadow:none;border-color:#c8a84b}}
</style></head><body>
<div class="cert">
  <div class="org">Agribank Chi nhánh Quảng Bình · Phòng Đào tạo &amp; Phát triển</div>
  <div class="logo">🏆</div>
  <div class="title">CHỨNG NHẬN HOÀN THÀNH</div>
  <hr class="line"/>
  <p class="label">Trân trọng chứng nhận học viên</p>
  <div class="name">${cert.studentName}</div>
  <p class="label" style="margin-top:12px">đã hoàn thành xuất sắc bài kiểm tra</p>
  <div class="quiz">"${cert.quizTitle}"</div>
  <p class="meta">Đợt thi: <strong>${cert.sessionName}</strong> &nbsp;|&nbsp; Lớp: <strong>${cert.className}</strong></p>
  <div class="score">${cert.score !== null ? cert.score.toFixed(1) : '—'}<span style="font-size:22px;color:#888">/${cert.passScore}</span></div>
  <p class="score-label">điểm số đạt yêu cầu</p>
  <p class="meta">Ngày thi: ${new Date(cert.submittedAt).toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'})}</p>
  <p class="meta">Ngày cấp chứng nhận: <strong>${new Date(cert.issuedAt).toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'})}</strong></p>
  <div class="sigs">
    <div class="sig"><div class="sig-line"></div>Trưởng phòng Đào tạo</div>
    <div class="sig"><div class="sig-line"></div>Học viên</div>
  </div>
</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`
  const w = window.open('', '_blank', 'width=820,height=700')
  if (w) { w.document.write(html); w.document.close() }
}

export default function ExamSessionsPage() {
  const qc = useQueryClient()
  const [form] = Form.useForm()
  const [filterYear, setFilterYear] = useState<string | undefined>()
  const [filterClass, setFilterClass] = useState<string | undefined>()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ExamSession | null>(null)
  const [gradebookId, setGradebookId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('gradebook')
  const [attemptUser, setAttemptUser] = useState<{ id: string; fullName: string } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [certLoading, setCertLoading] = useState<string | null>(null)

  const { data: years = [] } = useQuery<AcademicYear[]>({
    queryKey: ['academic-years'],
    queryFn: () => api.get('/admin/academic-years').then((r) => r.data),
  })
  const { data: classes = [] } = useQuery<ClassItem[]>({
    queryKey: ['classes', filterYear],
    queryFn: () => api.get('/admin/classes', { params: filterYear ? { academicYearId: filterYear } : {} }).then((r) => r.data),
  })
  const { data: quizzes = [] } = useQuery<Quiz[]>({
    queryKey: ['admin-quizzes'],
    queryFn: () => api.get('/admin/quizzes').then((r) => r.data),
  })
  const { data: sessions = [], isLoading } = useQuery<ExamSession[]>({
    queryKey: ['exam-sessions', filterClass],
    queryFn: () => api.get('/admin/exam-sessions', { params: filterClass ? { classId: filterClass } : {} }).then((r) => r.data),
  })
  const { data: gradebook = [], isFetching: gradebookLoading } = useQuery<GradebookEntry[]>({
    queryKey: ['gradebook', gradebookId],
    queryFn: () => api.get(`/admin/exam-sessions/${gradebookId}/gradebook`).then((r) => r.data),
    enabled: !!gradebookId,
  })
  const { data: leaderboard = [], isFetching: lbLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ['leaderboard', gradebookId],
    queryFn: () => api.get(`/admin/exam-sessions/${gradebookId}/leaderboard`).then((r) => r.data),
    enabled: !!gradebookId,
  })
  const { data: attempts = [], isFetching: attemptsLoading } = useQuery<AttemptEntry[]>({
    queryKey: ['attempts', gradebookId, attemptUser?.id],
    queryFn: () => api.get(`/admin/exam-sessions/${gradebookId}/attempts/${attemptUser!.id}`).then((r) => r.data),
    enabled: !!gradebookId && !!attemptUser,
  })
  const { data: questionStats = [], isFetching: statsLoading } = useQuery<QuestionStat[]>({
    queryKey: ['question-stats', gradebookId],
    queryFn: () => api.get(`/admin/exam-sessions/${gradebookId}/question-stats`).then((r) => r.data),
    enabled: !!gradebookId && activeTab === 'analysis',
  })
  const { data: notAttempted = [], isFetching: naLoading } = useQuery<NotAttemptedUser[]>({
    queryKey: ['not-attempted', gradebookId],
    queryFn: () => api.get(`/admin/exam-sessions/${gradebookId}/not-attempted`).then((r) => r.data),
    enabled: !!gradebookId && activeTab === 'not-attempted',
  })

  const createMut = useMutation({
    mutationFn: (body: ExamSessionBody) => api.post('/admin/exam-sessions', body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exam-sessions'] }); closeModal(); message.success('Đã tạo đợt thi') },
    onError: () => message.error('Lỗi khi tạo đợt thi'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & ExamSessionBody) => api.put(`/admin/exam-sessions/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exam-sessions'] }); closeModal(); message.success('Đã cập nhật') },
    onError: () => message.error('Lỗi khi cập nhật'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/exam-sessions/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exam-sessions'] }); message.success('Đã xóa') },
  })
  const setStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.put(`/admin/exam-sessions/${id}`, { status }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exam-sessions'] }); message.success('Đã cập nhật trạng thái') },
  })

  function openCreate() { setEditing(null); form.resetFields(); setModalOpen(true) }
  function openEdit(row: ExamSession) {
    setEditing(row)
    form.setFieldsValue({
      name: row.name, quizId: row.quizId, classId: row.classId,
      range: [dayjs(row.startAt), dayjs(row.endAt)],
      maxAttempts: row.maxAttempts, scoringPolicy: row.scoringPolicy,
      durationMin: row.durationMin, shuffleQuestions: row.shuffleQuestions,
      shuffleOptions: row.shuffleOptions, showResultAfter: row.showResultAfter,
      allowReview: row.allowReview,
    })
    setModalOpen(true)
  }
  function closeModal() { setModalOpen(false); setEditing(null); form.resetFields() }
  function openGradebook(row: ExamSession) { setGradebookId(row.id); setActiveTab('gradebook'); setAttemptUser(null) }
  function onFinish(values: ExamSessionFormValues) {
    const { range, ...rest } = values
    const body = { ...rest, startAt: range[0].toISOString(), endAt: range[1].toISOString() }
    if (editing) updateMut.mutate({ id: editing.id, ...body })
    else createMut.mutate(body)
  }

  async function handleExport() {
    if (!gradebookId) return
    setExporting(true)
    try {
      const res = await api.get(`/admin/exam-sessions/${gradebookId}/export`, { responseType: 'blob' })
      const cd = res.headers['content-disposition'] ?? ''
      const match = cd.match(/filename\*=UTF-8''(.+)/) ?? cd.match(/filename="(.+)"/)
      const filename = match ? decodeURIComponent(match[1]) : 'BangDiem.xlsx'
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
      message.success('Đã tải xuống file Excel')
    } catch { message.error('Lỗi khi export') } finally { setExporting(false) }
  }

  async function handleCertificate(userId: string) {
    if (!gradebookId) return
    setCertLoading(userId)
    try {
      const res = await api.get(`/admin/exam-sessions/${gradebookId}/certificate/${userId}`)
      openCertificatePrint(res.data as CertificateData)
    } catch (e) {
      message.error(getErrorMessage(e, 'Học viên chưa đạt để cấp chứng nhận'))
    } finally { setCertLoading(null) }
  }

  async function copyNotAttemptedList() {
    const text = notAttempted.map((u) => `${u.fullName} (${u.username})`).join('\n')
    await navigator.clipboard.writeText(text)
    message.success(`Đã copy ${notAttempted.length} học viên`)
  }

  const gradebookSession = sessions.find((s) => s.id === gradebookId)
  const completed = gradebook.filter((g) => g.attempts > 0).length
  const passed = gradebook.filter((g) => g.isPassed).length
  const total = gradebook.length
  const sortedByDifficulty = [...questionStats].sort((a, b) => (a.correctRate ?? 101) - (b.correctRate ?? 101))

  const renderExamSessionActions = (row: ExamSession) => (
    <Space>
      <Button size="small" icon={<BarChartOutlined />} onClick={() => openGradebook(row)}>Bảng điểm</Button>
      {row.status === 'DRAFT' && (
        <Popconfirm title="Mở đợt thi?" onConfirm={() => setStatusMut.mutate({ id: row.id, status: 'OPEN' })}>
          <Button size="small" type="primary" icon={<PlayCircleOutlined />} />
        </Popconfirm>
      )}
      {row.status === 'OPEN' && (
        <Popconfirm title="Đóng đợt thi?" onConfirm={() => setStatusMut.mutate({ id: row.id, status: 'CLOSED' })}>
          <Button size="small" danger icon={<StopOutlined />} />
        </Popconfirm>
      )}
      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
      <Popconfirm title="Xóa đợt thi?" onConfirm={() => deleteMut.mutate(row.id)}>
        <Button size="small" danger icon={<DeleteOutlined />} />
      </Popconfirm>
    </Space>
  )

  // ── Các cột bảng ────────────────────────────────────────────────────────
  const columns = [
    {
      title: 'Tên đợt thi', dataIndex: 'name',
      render: (v: string, row: ExamSession) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => openGradebook(row)}>{v}</Button>
      ),
    },
    { title: 'Bộ đề', dataIndex: ['quiz', 'title'], ellipsis: true },
    {
      title: 'Lớp', dataIndex: ['class', 'name'], width: 130,
      render: (v: string, row: ExamSession) => <span>{v} <Tag style={{ fontSize: 10 }}>{row.class?.code}</Tag></span>,
    },
    {
      title: 'Thời gian', width: 200,
      render: (_: unknown, row: ExamSession) => (
        <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
          <span>Từ: {dayjs(row.startAt).format('DD/MM/YYYY HH:mm')}</span>
          <span>Đến: {dayjs(row.endAt).format('DD/MM/YYYY HH:mm')}</span>
        </Space>
      ),
    },
    { title: 'Số lần', dataIndex: 'maxAttempts', width: 80, render: (v: number) => v === 0 ? '∞' : v },
    {
      title: 'Trạng thái', dataIndex: 'status', width: 110,
      render: (v: string) => <Tag color={STATUS_MAP[v]?.color}>{STATUS_MAP[v]?.label}</Tag>,
    },
    {
      title: '', width: 200,
      render: (_: unknown, row: ExamSession) => renderExamSessionActions(row),
    },
  ]

  const gradebookColumns = [
    { title: '#', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
    {
      title: 'Họ tên', dataIndex: ['user', 'fullName'],
      render: (v: string, r: GradebookEntry) => (
        <Button type="link" style={{ padding: 0 }} icon={<HistoryOutlined />} onClick={() => setAttemptUser(r.user)}>{v}</Button>
      ),
    },
    { title: 'Username', dataIndex: ['user', 'username'], width: 120 },
    { title: 'Số lần', dataIndex: 'attempts', width: 80, render: (v: number) => v === 0 ? <Tag>Chưa thi</Tag> : v },
    {
      title: 'Điểm', dataIndex: 'finalScore', width: 80,
      render: (v: number | null) => v === null ? '—' : <Typography.Text strong>{v.toFixed(1)}</Typography.Text>,
    },
    {
      title: 'Kết quả', dataIndex: 'isPassed', width: 90,
      render: (v: boolean | null) => v === null ? '—' : v ? <Tag color="green">Đạt</Tag> : <Tag color="red">Chưa đạt</Tag>,
    },
    {
      title: 'Lần cuối', dataIndex: 'lastSubmittedAt', width: 110,
      render: (v: string | null) => v ? dayjs(v).format('DD/MM HH:mm') : '—',
    },
    {
      title: '', width: 80,
      render: (_: unknown, r: GradebookEntry) => r.isPassed ? (
        <Tooltip title="Cấp chứng nhận">
          <Button size="small" icon={<SafetyCertificateOutlined />} type="dashed"
            loading={certLoading === r.user.id}
            onClick={() => handleCertificate(r.user.id)} />
        </Tooltip>
      ) : null,
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Quản lý Đợt thi</Typography.Title>
        <Space>
          <Select allowClear placeholder="Lọc theo năm học" style={{ width: 160 }}
            value={filterYear} onChange={(v) => { setFilterYear(v); setFilterClass(undefined) }}
            options={years.map((y) => ({ value: y.id, label: y.name }))} />
          <Select allowClear placeholder="Lọc theo lớp" style={{ width: 180 }}
            value={filterClass} onChange={setFilterClass}
            options={classes.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Tạo đợt thi</Button>
        </Space>
      </div>

      <ManageTable<ExamSession>
        rowKey="id"
        loading={isLoading}
        dataSource={sessions}
        columns={columns}
        cardHeading={(row) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => openGradebook(row)}>{row.name}</Button>
        )}
        cardBadge={(row) => <Tag color={STATUS_MAP[row.status]?.color}>{STATUS_MAP[row.status]?.label}</Tag>}
        cardMeta={[
          { label: 'Bộ đề', render: (row) => row.quiz?.title ?? '—' },
          { label: 'Lớp', render: (row) => <span>{row.class?.name} <Tag style={{ fontSize: 10 }}>{row.class?.code}</Tag></span> },
          {
            label: 'Thời gian', render: (row) => (
              <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
                <span>Từ: {dayjs(row.startAt).format('DD/MM/YYYY HH:mm')}</span>
                <span>Đến: {dayjs(row.endAt).format('DD/MM/YYYY HH:mm')}</span>
              </Space>
            ),
          },
          { label: 'Số lần', render: (row) => row.maxAttempts === 0 ? '∞' : row.maxAttempts },
        ]}
        cardActions={renderExamSessionActions}
      />

      {/* ── Modal tạo/sửa ───────────────────────────────────────────────── */}
      <Modal title={editing ? 'Chỉnh sửa đợt thi' : 'Tạo đợt thi mới'}
        open={modalOpen} onCancel={closeModal} onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending}
        width={600} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={onFinish}
          initialValues={{ maxAttempts: 1, scoringPolicy: 'HIGHEST', showResultAfter: 'IMMEDIATE', allowReview: true, shuffleQuestions: false, shuffleOptions: false }}>
          <Form.Item label="Tên đợt thi" name="name" rules={[{ required: true }]}>
            <Input placeholder="vd: Kiểm tra định kỳ tháng 5/2026" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Bộ đề" name="quizId" rules={[{ required: true }]}>
                <Select placeholder="Chọn bộ đề" options={quizzes.map((q) => ({ value: q.id, label: q.title }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Lớp thi" name="classId" rules={[{ required: true }]}>
                <Select placeholder="Chọn lớp" options={classes.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Thời gian thi" name="range" rules={[{ required: true }]}>
            <DatePicker.RangePicker showTime style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="Số lần thi tối đa" name="maxAttempts" extra="0 = không giới hạn">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Tính điểm theo" name="scoringPolicy">
                <Select options={SCORING_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Override thời gian (phút)" name="durationMin" extra="Để trống = dùng của bộ đề">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Hiện kết quả" name="showResultAfter">
            <Select options={SHOW_RESULT_OPTIONS} />
          </Form.Item>
          <Row gutter={24}>
            <Col><Form.Item name="shuffleQuestions" valuePropName="checked" label="Xáo câu hỏi"><Switch /></Form.Item></Col>
            <Col><Form.Item name="shuffleOptions" valuePropName="checked" label="Xáo đáp án"><Switch /></Form.Item></Col>
            <Col><Form.Item name="allowReview" valuePropName="checked" label="Cho xem lại bài"><Switch /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* ── Drawer bảng điểm ──────────────────────────────────────────────── */}
      <Drawer
        title={<Space><TrophyOutlined />{gradebookSession?.name}</Space>}
        open={!!gradebookId}
        onClose={() => { setGradebookId(null); setAttemptUser(null) }}
        size="large"
        extra={<Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>Export Excel</Button>}
      >
        {total > 0 && (
          <>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={8}><Statistic title="Tổng học viên" value={total} /></Col>
              <Col span={8}><Statistic title="Đã làm bài" value={completed} suffix={`/ ${total}`} /></Col>
              <Col span={8}>
                <Statistic title="Đạt" value={passed} suffix={`/ ${total}`}
                  valueStyle={{ color: total > 0 && passed / total >= 0.5 ? '#3f8600' : '#cf1322' }} />
              </Col>
            </Row>
            <div style={{ marginBottom: 16 }}>
              <Typography.Text type="secondary">Tỷ lệ hoàn thành</Typography.Text>
              <Progress percent={total > 0 ? Math.round((completed / total) * 100) : 0} status="active" />
            </div>
          </>
        )}

        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'gradebook',
            label: <Space><UserOutlined />Bảng điểm</Space>,
            children: gradebook.length === 0 && !gradebookLoading ? (
              <Empty description="Chưa có dữ liệu" />
            ) : (
              <Table rowKey={(r) => r.user.id} loading={gradebookLoading} size="small"
                dataSource={[...gradebook].sort((a, b) => (b.finalScore ?? -1) - (a.finalScore ?? -1))}
                pagination={false} scroll={{ x: 'max-content' }} columns={gradebookColumns} />
            ),
          },
          {
            key: 'leaderboard',
            label: <Space><TrophyOutlined />Leaderboard</Space>,
            children: leaderboard.length === 0 && !lbLoading ? <Empty description="Chưa có ai nộp bài" /> : (
              <Table rowKey={(r) => r.user.id} loading={lbLoading} size="small"
                dataSource={leaderboard} pagination={false} scroll={{ x: 'max-content' }}
                columns={[
                  {
                    title: 'Hạng', dataIndex: 'rank', width: 60,
                    render: (v: number) => ({ 1: '🥇', 2: '🥈', 3: '🥉' } as Record<number,string>)[v]
                      ? <span style={{ fontSize: 20 }}>{{ 1: '🥇', 2: '🥈', 3: '🥉' }[v]}</span>
                      : <Typography.Text type="secondary">#{v}</Typography.Text>,
                  },
                  { title: 'Họ tên', dataIndex: ['user', 'fullName'] },
                  { title: 'Username', dataIndex: ['user', 'username'], width: 120 },
                  { title: 'Điểm', dataIndex: 'finalScore', width: 90, render: (v: number) => <Typography.Text strong style={{ color: '#1677ff' }}>{v.toFixed(1)}</Typography.Text> },
                  { title: 'Số lần', dataIndex: 'attempts', width: 80 },
                  { title: 'Kết quả', dataIndex: 'isPassed', width: 90, render: (v: boolean | null) => v ? <Tag color="green">Đạt</Tag> : <Tag color="red">Chưa đạt</Tag> },
                ]} />
            ),
          },
          {
            key: 'analysis',
            label: <Space><BarChartOutlined />Phân tích câu hỏi</Space>,
            children: questionStats.length === 0 && !statsLoading ? <Empty description="Chưa có dữ liệu" /> : (
              <>
                {sortedByDifficulty.length > 0 && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fff7e6', borderRadius: 6, border: '1px solid #ffd591' }}>
                    <Space><WarningOutlined style={{ color: '#fa8c16' }} />
                      <Typography.Text>Câu khó nhất: <strong>Câu {sortedByDifficulty[0]?.index}</strong> — tỷ lệ đúng chỉ <strong>{sortedByDifficulty[0]?.correctRate ?? 0}%</strong></Typography.Text>
                    </Space>
                  </div>
                )}
                <Table rowKey="id" loading={statsLoading} size="small"
                  dataSource={questionStats} pagination={false} scroll={{ x: 'max-content' }}
                  columns={[
                    { title: '#', dataIndex: 'index', width: 40 },
                    {
                      title: 'Câu hỏi', dataIndex: 'content', ellipsis: true,
                      render: (v: string, r: QuestionStat) => (
                        <Tooltip title={<div>{r.options.map((o) => (
                          <div key={o.id}>{o.isCorrect ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />} {o.content}</div>
                        ))}</div>} placement="right">
                          <span style={{ cursor: 'help' }}>{v}</span>
                        </Tooltip>
                      ),
                    },
                    { title: 'Loại', dataIndex: 'questionType', width: 90, render: (v: string) => <Tag>{v === 'SINGLE' ? 'Một đáp án' : 'Nhiều đáp án'}</Tag> },
                    { title: 'Lượt trả lời', dataIndex: 'totalAttempts', width: 110 },
                    { title: 'Đúng', dataIndex: 'correctCount', width: 60, render: (v: number) => <Typography.Text type="success">{v}</Typography.Text> },
                    { title: 'Sai', dataIndex: 'wrongCount', width: 60, render: (v: number) => <Typography.Text type="danger">{v}</Typography.Text> },
                    {
                      title: '% Đúng', dataIndex: 'correctRate', width: 130,
                      render: (v: number | null) => v === null ? <Typography.Text type="secondary">N/A</Typography.Text> : (
                        <Space direction="vertical" size={2} style={{ width: '100%' }}>
                          <Progress percent={v} size="small" strokeColor={v >= 70 ? '#52c41a' : v >= 40 ? '#faad14' : '#ff4d4f'}
                            format={(p) => `${p}%`} />
                        </Space>
                      ),
                    },
                  ]} />
              </>
            ),
          },
          {
            key: 'not-attempted',
            label: (
              <Badge count={activeTab !== 'not-attempted' && notAttempted.length > 0 ? notAttempted.length : 0} size="small" offset={[6, -2]}>
                <Space><WarningOutlined />Chưa làm</Space>
              </Badge>
            ),
            children: (
              <>
                {notAttempted.length > 0 && (
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography.Text type="warning">
                      <WarningOutlined /> {notAttempted.length} học viên chưa nộp bài
                    </Typography.Text>
                    <Button icon={<CopyOutlined />} size="small" onClick={copyNotAttemptedList}>
                      Copy danh sách
                    </Button>
                  </div>
                )}
                {notAttempted.length === 0 && !naLoading
                  ? <Empty description="Tất cả học viên đã làm bài 🎉" />
                  : (
                    <Table rowKey="id" loading={naLoading} size="small"
                      dataSource={notAttempted} pagination={false} scroll={{ x: 'max-content' }}
                      columns={[
                        { title: '#', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
                        { title: 'Họ tên', dataIndex: 'fullName' },
                        { title: 'Username', dataIndex: 'username', width: 130 },
                        { title: 'Email', dataIndex: 'email', ellipsis: true },
                      ]} />
                  )}
              </>
            ),
          },
        ]} />
      </Drawer>

      {/* ── Modal lịch sử thi ─────────────────────────────────────────────── */}
      <Modal
        title={<Space><HistoryOutlined />Lịch sử thi — {attemptUser?.fullName}</Space>}
        open={!!attemptUser} onCancel={() => setAttemptUser(null)} footer={null} width={580}
      >
        {attempts.length === 0 && !attemptsLoading
          ? <Empty description="Học viên này chưa nộp bài nào" />
          : (
            <Table rowKey="id" loading={attemptsLoading} size="small" dataSource={attempts} pagination={false} scroll={{ x: 'max-content' }}
              columns={[
                { title: 'Lần', dataIndex: 'attempt', width: 60 },
                { title: 'Điểm', dataIndex: 'score', width: 80, render: (v: number | null) => v !== null ? <Typography.Text strong>{v.toFixed(1)}</Typography.Text> : '—' },
                { title: 'Kết quả', dataIndex: 'isPassed', width: 100, render: (v: boolean | null) => v === null ? '—' : v ? <Tag color="green">Đạt</Tag> : <Tag color="red">Chưa đạt</Tag> },
                { title: 'Trạng thái', dataIndex: 'status', width: 110 },
                { title: 'Thời điểm nộp', dataIndex: 'submittedAt', render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm:ss') },
              ]} />
          )}
      </Modal>
    </div>
  )
}
