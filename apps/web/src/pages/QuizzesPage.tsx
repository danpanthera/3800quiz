import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Tag, Typography, Badge, Button, Space, Popconfirm, message,
  Modal, Form, Input, InputNumber, Switch, Drawer, Select, theme,
  Tooltip, Divider,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, ThunderboltOutlined, MinusCircleOutlined, CopyOutlined } from '@ant-design/icons'
import ManageTable from '../components/ManageTable'
import { useDeviceType } from '../hooks/useDeviceType'
import api, { getErrorMessage } from '../lib/api'

interface Quiz {
  id: string; title: string; description?: string; topic?: string
  durationMin: number; passScore?: number; isActive: boolean; instantFeedback?: boolean
  maxAttempts?: number
  _count: { questions: number; assignments: number }
}
interface Subject { id: string; name: string; _count?: { questions: number } }
interface QuestionOption { content: string; isCorrect: boolean }
interface Question { id: string; content: string; questionType: string; points: number; options: QuestionOption[]; subject?: { name: string } }

type QuizFormValues = Omit<Quiz, 'id' | '_count'>
interface SubjectSlot { subjectId?: string; count: number }
interface PickFormValues { subjectSlots: SubjectSlot[]; replaceAll: boolean }
interface SubjectRatio { subjectId?: string; percent: number }
interface QuizCreateFormValues extends QuizFormValues {
  autoPickEnabled?: boolean
  totalQuestionCount?: number
  subjectRatios?: SubjectRatio[]
}

/**
 * Quy đổi tỷ lệ % mỗi lĩnh vực thành số câu cụ thể, tổng luôn khớp chính xác
 * `total` (không lệch do làm tròn) — dùng phương pháp phần dư lớn nhất
 * (Largest Remainder Method): làm tròn xuống trước, phần thiếu chia cho các
 * dòng có phần thập phân bị cắt lớn nhất.
 */
function phanBoTheoTyLe(total: number, ratios: SubjectRatio[]): number[] {
  const raw = ratios.map((r) => (total * (r.percent || 0)) / 100)
  const counts = raw.map(Math.floor)
  let conThieu = total - counts.reduce((a, b) => a + b, 0)
  const thuTuPhanDu = raw
    .map((v, i) => ({ i, phanDu: v - counts[i] }))
    .sort((a, b) => b.phanDu - a.phanDu)
  for (let k = 0; k < thuTuPhanDu.length && conThieu > 0; k++, conThieu--) {
    counts[thuTuPhanDu[k].i]++
  }
  return counts
}

export default function QuizzesPage() {
  const { token } = theme.useToken()
  const { screens } = useDeviceType()
  const isCompactView = !screens.md
  const qc = useQueryClient()
  const [quizModalOpen, setQuizModalOpen] = useState(false)
  const [editQuiz, setEditQuiz] = useState<Quiz | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [detailQuiz, setDetailQuiz] = useState<Quiz | null>(null)
  const [pickModalOpen, setPickModalOpen] = useState(false)
  const [pickTarget, setPickTarget] = useState<Quiz | null>(null)
  const [quizForm] = Form.useForm()
  const [pickForm] = Form.useForm()

  // ── Drawer co giãn được độ rộng ───────────────────────────────────────
  const [drawerWidth, setDrawerWidth] = useState(640)
  // isResizing: state (đọc được an toàn trong lúc render, dùng để tắt transition CSS khi đang kéo).
  // isResizingRef: ref song song, chỉ dùng trong closure của listener mousemove gắn trực tiếp vào
  // window (không phải render React) — tránh closure cũ đọc nhầm giá trị isResizing đã lỗi thời.
  const [isResizing, setIsResizing] = useState(false)
  const isResizingRef = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    isResizingRef.current = true
    setIsResizing(true)
    startX.current = e.clientX
    startW.current = drawerWidth
    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = startX.current - ev.clientX
      setDrawerWidth(Math.max(360, Math.min(window.innerWidth - 100, startW.current + delta)))
    }
    const onUp = () => {
      isResizingRef.current = false
      setIsResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [drawerWidth])

  // ── Truy vấn dữ liệu ──────────────────────────────────────────────────
  const { data: quizzes = [], isLoading } = useQuery<Quiz[]>({
    queryKey: ['quizzes'],
    queryFn: () => api.get('/admin/quizzes').then((r) => r.data),
  })

  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ['subjects'],
    queryFn: () => api.get('/admin/subjects').then((r) => r.data),
  })

  const { data: quizDetail } = useQuery<{ questions: Question[] }>({
    queryKey: ['quiz-detail', detailQuiz?.id],
    queryFn: () => api.get(`/admin/quizzes/${detailQuiz!.id}`).then((r) => r.data),
    enabled: !!detailQuiz,
  })

  // ── Thao tác ghi dữ liệu ──────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: QuizFormValues) => api.post<Quiz>('/admin/quizzes', data).then((r) => r.data),
  })
  const [autoPicking, setAutoPicking] = useState(false)

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & QuizFormValues) => api.put(`/admin/quizzes/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quizzes'] }); setQuizModalOpen(false); setEditQuiz(null); quizForm.resetFields() },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/quizzes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quizzes'] }); message.success('Đã xóa bộ đề') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi xóa bộ đề')),
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/quizzes/${id}/duplicate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quizzes'] }); message.success('Đã nhân bản bộ đề (bản sao đang ở trạng thái Tắt)') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi nhân bản bộ đề')),
  })

  const pickMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & PickFormValues) => api.post(`/admin/quizzes/${id}/pick-random`, data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quizzes'] })
      qc.invalidateQueries({ queryKey: ['quiz-detail', pickTarget?.id] })
      message.success(`Đã thêm ${res.data.added} câu hỏi vào bộ đề`)
      setPickModalOpen(false); pickForm.resetFields()
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi')),
  })

  // ── Hàm xử lý sự kiện ─────────────────────────────────────────────────
  const openNew = () => {
    setEditQuiz(null)
    quizForm.resetFields()
    quizForm.setFieldsValue({
      durationMin: 30, passScore: 70, isActive: true, instantFeedback: false, maxAttempts: 1,
      autoPickEnabled: false, subjectRatios: [{ percent: 100 }],
    })
    setQuizModalOpen(true)
  }
  const openEdit = (q: Quiz) => { setEditQuiz(q); quizForm.setFieldsValue(q); setQuizModalOpen(true) }
  const openDetail = (q: Quiz) => { setDetailQuiz(q); setDetailDrawerOpen(true) }
  const openPick = (q: Quiz) => {
    setPickTarget(q)
    setPickModalOpen(true)
  }

  // Đồng bộ giá trị form khi pickTarget đổi (Modal đổi key nên bị remount, nhưng initialValues lại dùng closure cũ)
  useEffect(() => {
    if (pickTarget && pickModalOpen) {
      pickForm.setFieldsValue({
        subjectSlots: [{ subjectId: undefined, count: pickTarget._count.questions || 10 }],
        replaceAll: false,
      })
    }
  }, [pickTarget, pickModalOpen, pickForm])

  const handleQuizSubmit = async (values: QuizCreateFormValues) => {
    const { autoPickEnabled, totalQuestionCount, subjectRatios, ...quizValues } = values
    if (editQuiz) {
      updateMutation.mutate({ id: editQuiz.id, ...quizValues })
      return
    }
    try {
      const newQuiz = await createMutation.mutateAsync(quizValues)
      qc.invalidateQueries({ queryKey: ['quizzes'] })

      if (autoPickEnabled && totalQuestionCount && subjectRatios?.length) {
        setAutoPicking(true)
        const counts = phanBoTheoTyLe(totalQuestionCount, subjectRatios)
        const subjectSlots = subjectRatios
          .map((r, i) => ({ subjectId: r.subjectId, count: counts[i] }))
          .filter((s) => s.count > 0)
        try {
          const res = await api.post<{ added: number }>(`/admin/quizzes/${newQuiz.id}/pick-random`, { subjectSlots, replaceAll: false })
          message.success(`Đã tạo bộ đề và thêm ${res.data.added} câu hỏi theo tỷ lệ đã chọn`)
        } catch (e) {
          message.warning(getErrorMessage(e, 'Đã tạo bộ đề nhưng lấy câu hỏi tự động thất bại — vào "Lấy câu ngẫu nhiên" để thử lại'))
        } finally {
          setAutoPicking(false)
        }
        qc.invalidateQueries({ queryKey: ['quizzes'] })
      } else {
        message.success('Đã tạo bộ đề')
      }
      setQuizModalOpen(false)
      quizForm.resetFields()
    } catch (e) {
      message.error(getErrorMessage(e, 'Lỗi khi tạo bộ đề'))
    }
  }

  const handlePick = (values: PickFormValues) => {
    pickMutation.mutate({ id: pickTarget!.id, subjectSlots: values.subjectSlots, replaceAll: values.replaceAll })
  }

  const renderQuizActions = (quiz: Quiz) => (
    <Space size={6}>
      <Tooltip title="Xem câu hỏi">
        <Button aria-label={`Xem câu hỏi của ${quiz.title}`} icon={<EyeOutlined />} size="small" onClick={() => openDetail(quiz)} />
      </Tooltip>
      <Tooltip title="Lấy câu ngẫu nhiên">
        <Button aria-label={`Lấy câu ngẫu nhiên cho ${quiz.title}`} icon={<ThunderboltOutlined />} size="small" onClick={() => openPick(quiz)} />
      </Tooltip>
      <Tooltip title="Sửa bộ đề">
        <Button aria-label={`Sửa ${quiz.title}`} icon={<EditOutlined />} size="small" onClick={() => openEdit(quiz)} />
      </Tooltip>
      <Tooltip title="Nhân bản bộ đề">
        <Button
          aria-label={`Nhân bản ${quiz.title}`}
          icon={<CopyOutlined />}
          size="small"
          loading={duplicateMutation.isPending && duplicateMutation.variables === quiz.id}
          onClick={() => duplicateMutation.mutate(quiz.id)}
        />
      </Tooltip>
      <Popconfirm title="Xóa bộ đề?" onConfirm={() => deleteMutation.mutate(quiz.id)}>
        <Tooltip title="Xóa bộ đề">
          <Button aria-label={`Xóa ${quiz.title}`} icon={<DeleteOutlined />} size="small" danger />
        </Tooltip>
      </Popconfirm>
    </Space>
  )

  // ── Danh sách cột ─────────────────────────────────────────────────────
  const columns = [
    { title: 'Tên bộ đề', dataIndex: 'title', ellipsis: true },
    { title: 'Chuyên đề', dataIndex: 'topic', width: 160, render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : '-' },
    { title: 'Thời gian', dataIndex: 'durationMin', width: 100, render: (v: number) => `${v} phút` },
    { title: 'Câu hỏi', dataIndex: ['_count', 'questions'], width: 80 },
    { title: 'Phân công', dataIndex: ['_count', 'assignments'], width: 90 },
    {
      title: 'Trạng thái', dataIndex: 'isActive', width: 110,
      render: (v: boolean) => <Badge status={v ? 'success' : 'default'} text={v ? 'Hoạt động' : 'Tắt'} />,
    },
    {
      title: '', width: 160,
      render: (_: unknown, quiz: Quiz) => renderQuizActions(quiz),
    },
  ]

  return (
    <>
      <div className="management-page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>Quản lý bộ đề</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Tạo bộ đề</Button>
      </div>
      <ManageTable<Quiz>
        rowKey="id"
        loading={isLoading}
        dataSource={quizzes}
        columns={columns}
        cardHeading={(quiz) => (
          <>
            <Typography.Title level={5}>{quiz.title}</Typography.Title>
            {quiz.topic && <Tag color="geekblue">{quiz.topic}</Tag>}
          </>
        )}
        cardBadge={(quiz) => (
          <Badge status={quiz.isActive ? 'success' : 'default'} text={quiz.isActive ? 'Hoạt động' : 'Tắt'} />
        )}
        cardMeta={[
          { label: 'Thời gian', render: (quiz) => `${quiz.durationMin} phút` },
          { label: 'Số lần thi', render: (quiz) => (quiz.maxAttempts === 0 ? 'Không giới hạn' : `${quiz.maxAttempts ?? 1} lần`) },
          { label: 'Câu hỏi', render: (quiz) => quiz._count.questions },
          { label: 'Phân công', render: (quiz) => quiz._count.assignments },
        ]}
        cardActions={renderQuizActions}
      />

      {/* Modal: Tạo mới / Sửa bộ đề */}
      <Modal
        title={editQuiz ? 'Sửa bộ đề' : 'Tạo bộ đề mới'}
        open={quizModalOpen}
        onCancel={() => { setQuizModalOpen(false); setEditQuiz(null); quizForm.resetFields() }}
        onOk={() => quizForm.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending || autoPicking}
        width={540}
      >
        <Form form={quizForm} layout="vertical" onFinish={handleQuizSubmit}>
          <Form.Item name="title" label="Tên bộ đề" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="topic" label="Chuyên đề">
            <Input placeholder="VD: Nghiệp vụ tín dụng cơ bản" />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space size={16}>
            <Form.Item name="durationMin" label="Thời gian (phút)" rules={[{ required: true }]}>
              <InputNumber min={1} max={300} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="passScore" label="Điểm đạt (%)">
              <InputNumber min={0} max={100} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="isActive" label="Hoạt động" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item
            name="maxAttempts"
            label="Số lần thi tối đa"
            rules={[{ required: true, message: 'Nhập số lần thi tối đa' }]}
            extra="0 = không giới hạn số lần thi lại."
          >
            <InputNumber min={0} max={99} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item
            name="instantFeedback"
            label="Phản hồi tức thì (kiểu Quizizz)"
            valuePropName="checked"
            tooltip="Bật: chọn xong hiện ngay đúng/sai, tự sang câu kế, đáp án bị khoá không sửa được — hợp với đề luyện tập. TẮT cho kỳ thi chính thức vì chế độ này để lộ đáp án ngay trong lúc thi."
            extra="Chỉ bật cho đề luyện tập. Kỳ thi chính thức nên tắt để không lộ đáp án."
          >
            <Switch />
          </Form.Item>

          {!editQuiz && (
            <>
              <Divider titlePlacement="left" style={{ marginTop: 4, marginBottom: 12 }}>
                Tự động chọn câu hỏi từ ngân hàng
              </Divider>
              <Form.Item
                name="autoPickEnabled"
                label="Trộn câu hỏi theo tỷ lệ lĩnh vực"
                valuePropName="checked"
                tooltip='Bật để ngay khi tạo bộ đề, hệ thống tự lấy ngẫu nhiên câu hỏi từ ngân hàng theo tỷ lệ % mỗi lĩnh vực bạn ấn định — VD: 30% Tín dụng, 30% Kế toán, 10% Kiến thức chung, 25% CNTT, 5% Giao tiếp.'
              >
                <Switch />
              </Form.Item>

              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.autoPickEnabled !== cur.autoPickEnabled}>
                {() => !quizForm.getFieldValue('autoPickEnabled') ? null : (
                  <>
                    <Form.Item
                      name="totalQuestionCount"
                      label="Tổng số câu hỏi"
                      rules={[{ required: true, message: 'Nhập tổng số câu hỏi' }]}
                    >
                      <InputNumber min={1} max={500} style={{ width: 160 }} />
                    </Form.Item>

                    <Form.Item label="Tỷ lệ theo lĩnh vực (tổng phải đúng 100%)">
                      <Form.List
                        name="subjectRatios"
                        rules={[{
                          validator: async (_, ratios: SubjectRatio[]) => {
                            if (!ratios || ratios.length === 0) return Promise.reject(new Error('Thêm ít nhất 1 lĩnh vực'))
                            const total = ratios.reduce((s, r) => s + (r?.percent || 0), 0)
                            if (Math.round(total) !== 100) return Promise.reject(new Error(`Tổng tỷ lệ đang là ${total}% — phải đúng 100%`))
                          },
                        }]}
                      >
                        {(fields, { add, remove }, { errors }) => (
                          <>
                            {fields.map(({ key, name }) => (
                              <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                                <Form.Item name={[name, 'subjectId']} noStyle rules={[{ required: true, message: 'Chọn lĩnh vực' }]}>
                                  <Select
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="Chọn lĩnh vực"
                                    style={{ width: 260 }}
                                    options={subjects.map((s) => ({ value: s.id, label: `${s.name} (${s._count?.questions ?? 0} câu)` }))}
                                  />
                                </Form.Item>
                                <Form.Item name={[name, 'percent']} noStyle rules={[{ required: true, message: 'Nhập %' }]}>
                                  <InputNumber min={0} max={100} addonAfter="%" placeholder="Tỷ lệ" style={{ width: 110 }} />
                                </Form.Item>
                                {fields.length > 1 && (
                                  <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                                )}
                              </Space>
                            ))}
                            <Form.ErrorList errors={errors} />
                            <Button type="dashed" onClick={() => add({ percent: 0 })} icon={<PlusOutlined />} size="small">
                              Thêm lĩnh vực
                            </Button>
                          </>
                        )}
                      </Form.List>
                    </Form.Item>

                    {/* Xem trước: tổng tỷ lệ, số câu quy đổi mỗi lĩnh vực, cảnh báo thiếu câu trong ngân hàng */}
                    <Form.Item shouldUpdate noStyle>
                      {() => {
                        const total = quizForm.getFieldValue('totalQuestionCount') as number | undefined
                        const ratios = (quizForm.getFieldValue('subjectRatios') ?? []) as SubjectRatio[]
                        const tongTyLe = ratios.reduce((s, r) => s + (r?.percent || 0), 0)
                        if (!total || ratios.length === 0) return null
                        const counts = phanBoTheoTyLe(total, ratios)
                        return (
                          <div style={{ marginTop: -8, marginBottom: 12 }}>
                            <Typography.Text type={tongTyLe === 100 ? 'secondary' : 'danger'} style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                              Tổng tỷ lệ: {tongTyLe}%{tongTyLe !== 100 && ' — phải đúng 100%'}
                            </Typography.Text>
                            {ratios.map((r, i) => {
                              if (!r.subjectId) return null
                              const subj = subjects.find((s) => s.id === r.subjectId)
                              const available = subj?._count?.questions ?? 0
                              const need = counts[i]
                              const thieu = need > available
                              return (
                                <Typography.Text key={i} type={thieu ? 'danger' : 'secondary'} style={{ fontSize: 12, display: 'block' }}>
                                  {subj?.name ?? '—'}: {need} câu{thieu && ` (ngân hàng chỉ có ${available} câu — không đủ!)`}
                                </Typography.Text>
                              )
                            })}
                          </div>
                        )
                      }}
                    </Form.Item>
                  </>
                )}
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* Drawer: Chi tiết bộ đề (danh sách câu hỏi) */}
      <Drawer
        title={`Câu hỏi trong bộ đề: ${detailQuiz?.title ?? ''}`}
        open={detailDrawerOpen}
        onClose={() => { setDetailDrawerOpen(false); setDetailQuiz(null) }}
        extra={
          <Button icon={<ThunderboltOutlined />} type="primary" onClick={() => { setDetailDrawerOpen(false); openPick(detailQuiz!) }}>
            Lấy câu ngẫu nhiên
          </Button>
        }
        styles={{ wrapper: { width: isCompactView ? '100%' : drawerWidth, transition: isResizing ? 'none' : undefined } }}
      >
        {/* Tay cầm kéo để thay đổi độ rộng */}
        {!isCompactView && (
          <div
            onMouseDown={onResizeStart}
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: 5,
              cursor: 'col-resize', zIndex: 10,
              background: 'transparent',
            }}
            title="Kéo để thay đổi độ rộng"
          />
        )}
        {quizDetail?.questions?.length === 0 && (
          <Typography.Text type="secondary">Chưa có câu hỏi nào. Dùng nút "Lấy câu ngẫu nhiên" để thêm từ ngân hàng.</Typography.Text>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {(quizDetail?.questions ?? []).map((q, idx) => (
            <div
              key={q.id}
              style={{
                padding: '12px 0',
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Typography.Text strong>{idx + 1}. {q.content}</Typography.Text>
              <div style={{ marginTop: 6 }}>
                <Space size={4} wrap>
                  {q.subject && <Tag color="cyan">{q.subject.name}</Tag>}
                  <Tag color={q.questionType === 'SINGLE' ? 'blue' : 'purple'}>
                    {q.questionType === 'SINGLE' ? 'Chọn 1' : 'Chọn nhiều'}
                  </Tag>
                  {q.options.map((o, i) => (
                    <Tag key={i} color={o.isCorrect ? 'green' : 'default'}>{o.content}</Tag>
                  ))}
                </Space>
              </div>
            </div>
          ))}
        </div>
      </Drawer>

      {/* Modal: Lấy câu ngẫu nhiên */}
      <Modal
        key={pickTarget?.id ?? 'pick'}
        title={`Lấy câu hỏi ngẫu nhiên → ${pickTarget?.title ?? ''}`}
        open={pickModalOpen}
        onCancel={() => { setPickModalOpen(false); pickForm.resetFields() }}
        onOk={() => pickForm.submit()}
        confirmLoading={pickMutation.isPending}
        okText="Lấy ngẫu nhiên"
        width={560}
      >
        <Form form={pickForm} layout="vertical" onFinish={handlePick}
          initialValues={{ subjectSlots: [{ count: 10 }], replaceAll: false }}
        >
          <Form.Item label={
            <span>
              Lĩnh vực &amp; số câu cần lấy
              {pickTarget && (
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontWeight: 'normal', fontSize: 12 }}>
                  (hiện có {pickTarget._count.questions} câu)
                </Typography.Text>
              )}
            </span>
          }>
            <Form.List
              name="subjectSlots"
              rules={[{
                validator: async (_, slots) => {
                  if (!slots || slots.length === 0) return Promise.reject('Thêm ít nhất 1 dòng')
                  const total = (slots as SubjectSlot[]).reduce((s, r) => s + (r?.count || 0), 0)
                  if (total <= 0) return Promise.reject('Tổng số câu phải lớn hơn 0')
                },
              }]}
            >
              {(fields, { add, remove }, { errors }) => (
                <>
                  {fields.map(({ key, name }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item name={[name, 'subjectId']} noStyle>
                        <Select
                          allowClear
                          placeholder="Tất cả lĩnh vực"
                          style={{ width: 220 }}
                          options={subjects.map((s) => ({ value: s.id, label: s.name }))}
                        />
                      </Form.Item>
                      <Form.Item name={[name, 'count']} noStyle rules={[{ required: true, message: 'Nhập số câu' }]}>
                        <InputNumber min={1} max={500} placeholder="Số câu" style={{ width: 90 }} />
                      </Form.Item>
                      {fields.length > 1 && (
                        <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                      )}
                    </Space>
                  ))}
                  <Form.ErrorList errors={errors} />
                  <Button
                    type="dashed"
                    onClick={() => add({ subjectId: undefined, count: 1 })}
                    icon={<PlusOutlined />}
                    size="small"
                  >
                    Thêm lĩnh vực
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="replaceAll" label="Thay thế toàn bộ câu hỏi hiện tại" valuePropName="checked">
            <Switch />
          </Form.Item>
          {/* Tóm tắt kết quả dự kiến */}
          <Form.Item shouldUpdate noStyle>
            {() => {
              const slots = (pickForm.getFieldValue('subjectSlots') ?? []) as SubjectSlot[]
              const total = slots.reduce((s, r) => s + (r?.count || 0), 0)
              const replaceAll = pickForm.getFieldValue('replaceAll')
              const current = pickTarget?._count.questions ?? 0
              const after = replaceAll ? total : current + total
              if (total <= 0) return null
              return (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Sẽ lấy <strong>{total}</strong> câu ngẫu nhiên &nbsp;→&nbsp;
                  bộ đề sẽ có <strong>{after}</strong> câu
                  {!replaceAll && current > 0 && ` (${current} hiện tại + ${total} mới)`}
                </Typography.Text>
              )
            }}
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

