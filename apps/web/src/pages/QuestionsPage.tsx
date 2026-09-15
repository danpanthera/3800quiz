import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Layout, Menu, Button, Table, Space, Tag, Popconfirm, message,
  Modal, Form, Input, Select, Upload, Typography, Divider, Tooltip,
  Drawer, Radio, Checkbox, Alert, Badge, Switch, theme,
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined,
  UploadOutlined, InboxOutlined, WarningOutlined, CheckCircleOutlined, SettingOutlined,
} from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload/interface'
import type { ColumnType } from 'antd/es/table'
import ManageTable from '../components/ManageTable'
import { useDeviceType } from '../hooks/useDeviceType'
import api, { getErrorMessage } from '../lib/api'

const { Sider, Content } = Layout
const { Title, Text } = Typography

interface Subject { id: string; name: string; description?: string; _count?: { questions: number } }
interface QuestionOption { id?: string; content: string; isCorrect: boolean; orderIndex: number }
interface Question {
  id: string; content: string; imageUrl?: string; explanation?: string
  questionType: 'SINGLE' | 'MULTIPLE' | 'ORDERING'
  points: number; subjectId?: string
  options: QuestionOption[]
  subject?: { id: string; name: string }
}

interface SubjectFormValues { name: string; description?: string }
interface QuestionFormValues {
  content: string; imageUrl?: string; explanation?: string
  subjectId: string; questionType: 'SINGLE' | 'MULTIPLE' | 'ORDERING'; points: number
  options: QuestionOption[]
}

interface DupMatch { id: string; content: string; score: number; level: 'exact' | 'high' | 'medium' }
interface DupResult { index: number; text: string; matches: DupMatch[] }
interface SpellWarning { word: string; suggestions: string[] }
interface SpellResult { rowIndex: number; warnings: SpellWarning[] }

interface PreviewRow {
  rowNumber: number
  content: string
  optionTexts: (string | null)[]
  correctIndex: number
  explanation: string | null
  duplicateLevel: 'exact' | 'high' | 'medium' | null
  duplicateMatch: { id: string; content: string; score: number } | null
  spellingWarnings: SpellWarning[]
  edited?: boolean // admin đã sửa dòng này trên modal xem trước, khác nội dung gốc trong file Excel
}

// Giá trị form sửa nhanh 1 dòng trong bảng xem trước
interface RowEditFormValues {
  content: string
  opt0?: string
  opt1?: string
  opt2?: string
  opt3?: string
  correctIndex: number
  explanation?: string
}

export default function QuestionsPage() {
  const { token } = theme.useToken()
  const qc = useQueryClient()
  const { screens } = useDeviceType()
  const isCardView = !screens.md
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null)
  const [subjectDrawerOpen, setSubjectDrawerOpen] = useState(false)

  // ── Sider lĩnh vực có thể kéo giãn độ rộng (chỉ áp dụng ở view Sider, tablet ngang/desktop) ──
  const [siderWidth, setSiderWidth] = useState(240)
  // isResizing: state (đọc an toàn lúc render, tắt transition CSS khi đang kéo).
  // isResizingRef: ref song song, chỉ dùng trong closure mousemove gắn trực tiếp vào window.
  const [isResizing, setIsResizing] = useState(false)
  const isResizingRef = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onSiderResizeStart = useCallback((e: React.MouseEvent) => {
    isResizingRef.current = true
    setIsResizing(true)
    startX.current = e.clientX
    startW.current = siderWidth
    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      // Sider nằm bên trái — kéo sang phải (clientX tăng) để tăng độ rộng, ngược chiều Drawer bên phải
      const delta = ev.clientX - startX.current
      setSiderWidth(Math.max(180, Math.min(480, startW.current + delta)))
    }
    const onUp = () => {
      isResizingRef.current = false
      setIsResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [siderWidth])
  const [subjectModalOpen, setSubjectModalOpen] = useState(false)
  const [editSubject, setEditSubject] = useState<Subject | null>(null)
  const [questionDrawerOpen, setQuestionDrawerOpen] = useState(false)
  const [editQuestion, setEditQuestion] = useState<Question | null>(null)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importFile, setImportFile] = useState<UploadFile | null>(null)
  const [importing, setImporting] = useState(false)
  const [subjectForm] = Form.useForm()
  const [questionForm] = Form.useForm()
  const questionTypeWatch = Form.useWatch('questionType', questionForm)

  // ── Trạng thái kiểm tra trùng lặp + chính tả khi thêm câu hỏi thủ công ──
  const [dupWarnings, setDupWarnings] = useState<DupMatch[]>([])
  const [spellWarnings, setSpellWarnings] = useState<SpellWarning[]>([])
  const [checking, setChecking] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Trạng thái xem trước khi import ─────────────────────────────────────
  const [previewStep, setPreviewStep] = useState<'upload' | 'preview'>('upload')
  const [previewData, setPreviewData] = useState<PreviewRow[]>([])
  const [previewErrors, setPreviewErrors] = useState<string[]>([])
  const [previewing, setPreviewing] = useState(false)
  // Danh sách sheet của file đang chọn — hỏi người dùng chọn sheet khi file có > 1 sheet
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState<string | undefined>()
  const [loadingSheets, setLoadingSheets] = useState(false)
  // Mặc định TẮT: giữ hành vi cũ (tự động bỏ qua câu trùng/gần trùng). Admin bật
  // lên nếu chủ đích muốn import cả những câu đã bị đánh dấu trùng.
  const [importDuplicates, setImportDuplicates] = useState(false)

  // ── Sửa nhanh 1 dòng trong bảng xem trước (vd để khắc phục cảnh báo chính tả) ──
  const [editingRow, setEditingRow] = useState<PreviewRow | null>(null)
  const [savingRowEdit, setSavingRowEdit] = useState(false)
  const [rowEditForm] = Form.useForm<RowEditFormValues>()

  const checkContent = useCallback(async (text: string) => {
    if (!text || text.trim().length < 5) { setDupWarnings([]); setSpellWarnings([]); return }
    setChecking(true)
    try {
      const [dupRes, spellRes] = await Promise.all([
        api.post('/admin/bank-questions/check-duplicates', { texts: [text] }),
        api.post('/admin/bank-questions/check-spelling', { texts: [text] }),
      ])
      setDupWarnings((dupRes.data as DupResult[])[0]?.matches ?? [])
      setSpellWarnings((spellRes.data as SpellResult[])[0]?.warnings ?? [])
    } catch { /* bỏ qua lỗi */ } finally { setChecking(false) }
  }, [])

  const onContentBlur = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => checkContent(text), 300)
  }, [checkContent])

  // Reset cảnh báo khi Drawer đóng — cập nhật ngay trong lúc render thay vì dùng useEffect
  // (theo khuyến nghị của React cho việc "điều chỉnh state theo thay đổi của prop")
  const [wasDrawerOpen, setWasDrawerOpen] = useState(questionDrawerOpen)
  if (questionDrawerOpen !== wasDrawerOpen) {
    setWasDrawerOpen(questionDrawerOpen)
    if (!questionDrawerOpen) { setDupWarnings([]); setSpellWarnings([]) }
  }

  // ── Lĩnh vực ─────────────────────────────────────────────────────────
  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ['subjects'],
    queryFn: () => api.get('/admin/subjects').then((r) => r.data),
  })

  const createSubjectMutation = useMutation({
    mutationFn: (data: SubjectFormValues) => api.post('/admin/subjects', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subjects'] }); setSubjectModalOpen(false); subjectForm.resetFields() },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi tạo lĩnh vực')),
  })

  const updateSubjectMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & SubjectFormValues) =>
      api.put(`/admin/subjects/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subjects'] }); setSubjectModalOpen(false); setEditSubject(null); subjectForm.resetFields() },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi sửa lĩnh vực')),
  })

  const deleteSubjectMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/subjects/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subjects'] }) },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi xóa lĩnh vực')),
  })

  // ── Ngân hàng câu hỏi ────────────────────────────────────────────────
  const { data: questions = [], isLoading } = useQuery<Question[]>({
    queryKey: ['bank-questions', selectedSubjectId],
    queryFn: () =>
      api.get('/admin/bank-questions', { params: selectedSubjectId ? { subjectId: selectedSubjectId } : {} })
        .then((r) => r.data),
  })

  const createQuestionMutation = useMutation({
    mutationFn: (data: QuestionFormValues) => api.post('/admin/bank-questions', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-questions'] })
      qc.invalidateQueries({ queryKey: ['subjects'] })
      setQuestionDrawerOpen(false); questionForm.resetFields()
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi tạo câu hỏi')),
  })

  const updateQuestionMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<QuestionFormValues>) => api.put(`/admin/bank-questions/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-questions'] })
      setQuestionDrawerOpen(false); setEditQuestion(null); questionForm.resetFields()
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi sửa câu hỏi')),
  })

  const deleteQuestionMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/bank-questions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-questions'] })
      qc.invalidateQueries({ queryKey: ['subjects'] })
      message.success('Đã xóa')
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi xóa câu hỏi')),
  })

  const deleteAllQuestionsMutation = useMutation({
    mutationFn: (subjectId: string | null) =>
      api.delete('/admin/bank-questions', {
        params: subjectId ? { subjectId } : {},
      }),
    onSuccess: (res) => {
      const deleted = Number(res.data?.deleted ?? 0)
      qc.invalidateQueries({ queryKey: ['bank-questions'] })
      qc.invalidateQueries({ queryKey: ['subjects'] })
      message.success(
        deleted > 0
          ? `Đã xóa ${deleted} câu hỏi khỏi ngân hàng`
          : 'Không có câu hỏi nào để xóa',
      )
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi xóa toàn bộ câu hỏi')),
  })

  // ── Các hàm xử lý ────────────────────────────────────────────────────
  const openNewSubjectModal = () => { setEditSubject(null); subjectForm.resetFields(); setSubjectModalOpen(true) }
  const openEditSubjectModal = (s: Subject) => {
    setEditSubject(s); subjectForm.setFieldsValue({ name: s.name, description: s.description }); setSubjectModalOpen(true)
  }
  const handleSubjectSubmit = (values: SubjectFormValues) => {
    if (editSubject) updateSubjectMutation.mutate({ id: editSubject.id, ...values })
    else createSubjectMutation.mutate(values)
  }

  const openNewQuestion = () => {
    setEditQuestion(null)
    questionForm.setFieldsValue({
      subjectId: selectedSubjectId ?? subjects[0]?.id,
      questionType: 'SINGLE',
      points: 1,
      options: [
        { content: '', isCorrect: true, orderIndex: 1 },
        { content: '', isCorrect: false, orderIndex: 2 },
        { content: '', isCorrect: false, orderIndex: 3 },
        { content: '', isCorrect: false, orderIndex: 4 },
      ],
    })
    setQuestionDrawerOpen(true)
  }

  const openEditQuestion = (q: Question) => {
    setEditQuestion(q)
    questionForm.setFieldsValue({
      content: q.content, imageUrl: q.imageUrl, explanation: q.explanation,
      subjectId: q.subjectId, questionType: q.questionType, points: q.points,
      options: q.options,
    })
    setQuestionDrawerOpen(true)
  }

  const handleQuestionSubmit = (values: QuestionFormValues) => {
    // Thứ tự hiển thị/đúng (câu ORDERING) lấy theo vị trí cuối cùng trong danh sách,
    // không phụ thuộc orderIndex khởi tạo ban đầu — để nút ↑↓ có tác dụng thật.
    const options = (values.options ?? []).map((opt, idx) => ({ ...opt, orderIndex: idx + 1 }))
    if (editQuestion) {
      updateQuestionMutation.mutate({
        id: editQuestion.id,
        content: values.content, imageUrl: values.imageUrl, explanation: values.explanation,
        subjectId: values.subjectId, points: values.points,
        questionType: values.questionType, options,
      })
    } else {
      createQuestionMutation.mutate({ ...values, options })
    }
  }

  // Import thẳng từ dữ liệu previewData (đã qua bước xem trước, có thể admin đã
  // sửa một số dòng) — KHÔNG upload lại file Excel gốc, vì file gốc không còn
  // khớp với nội dung đã sửa trên modal.
  const handleImport = async () => {
    if (!selectedSubjectId) { message.error('Vui lòng chọn lĩnh vực'); return }
    if (previewData.length === 0) { message.error('Không có câu hỏi để import'); return }
    setImporting(true)
    try {
      const res = await api.post('/admin/bank-questions/import/confirm', {
        subjectId: selectedSubjectId,
        importDuplicates,
        rows: previewData.map((r) => ({
          rowNumber: r.rowNumber,
          content: r.content,
          optionTexts: r.optionTexts,
          correctIndex: r.correctIndex,
          explanation: r.explanation,
        })),
      })
      const imported = res.data.imported ?? 0
      const skipped = res.data.skipped ?? 0
      message.success(`Import thành công ${imported} câu hỏi${skipped > 0 ? `, bỏ qua ${skipped} câu trùng` : ''}`)
      if (res.data.errors?.length) message.warning(`${res.data.errors.length} dòng lỗi`)
      qc.invalidateQueries({ queryKey: ['bank-questions'] })
      qc.invalidateQueries({ queryKey: ['subjects'] })
      closeImportModal()
    } catch (e) {
      message.error(getErrorMessage(e, 'Lỗi import'))
    } finally { setImporting(false) }
  }

  const handlePreviewImport = async () => {
    if (!importFile || !selectedSubjectId) {
      message.error('Vui lòng chọn lĩnh vực và file Excel'); return
    }
    setPreviewing(true)
    try {
      const formData = new FormData()
      formData.append('file', importFile.originFileObj as File)
      formData.append('subjectId', selectedSubjectId)
      formData.append('dryRun', 'true')
      if (selectedSheet) formData.append('sheetName', selectedSheet)
      const res = await api.post('/admin/bank-questions/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreviewData(res.data.preview ?? [])
      setPreviewErrors(res.data.errors ?? [])
      setPreviewStep('preview')
    } catch (e) {
      message.error(getErrorMessage(e, 'Lỗi kiểm tra file'))
    } finally { setPreviewing(false) }
  }

  // Chọn file xong: hỏi ngay server file có bao nhiêu sheet — chỉ hiện lựa chọn khi > 1 sheet
  const handleFileSelected = async (file: UploadFile | null) => {
    setImportFile(file)
    setSheetNames([])
    setSelectedSheet(undefined)
    if (!file?.originFileObj) return
    setLoadingSheets(true)
    try {
      const formData = new FormData()
      formData.append('file', file.originFileObj as File)
      const res = await api.post('/admin/bank-questions/import/sheets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const names: string[] = res.data.sheetNames ?? []
      setSheetNames(names)
      setSelectedSheet(names[0])
    } catch (e) {
      message.error(getErrorMessage(e, 'Không đọc được danh sách sheet trong file'))
    } finally { setLoadingSheets(false) }
  }

  // ── Sửa nhanh 1 dòng trong bảng xem trước ───────────────────────────────
  const openRowEdit = (row: PreviewRow) => {
    setEditingRow(row)
    rowEditForm.setFieldsValue({
      content: row.content,
      opt0: row.optionTexts[0] ?? '',
      opt1: row.optionTexts[1] ?? '',
      opt2: row.optionTexts[2] ?? '',
      opt3: row.optionTexts[3] ?? '',
      correctIndex: row.correctIndex,
      explanation: row.explanation ?? '',
    })
  }

  const closeRowEdit = () => { setEditingRow(null); rowEditForm.resetFields() }

  // Giữ nguyên kiểu viết hoa của từ gốc khi thay bằng gợi ý — tránh áp dụng gợi ý
  // cho từ đầu câu (vd "Ngânn") lại biến thành chữ thường ("ngân"), sai chính tả kiểu khác.
  const matchCase = (original: string, replacement: string) => {
    if (original === original.toUpperCase() && original !== original.toLowerCase()) {
      return replacement.toUpperCase()
    }
    if (original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1)
    }
    return replacement
  }

  // Bấm 1 gợi ý chính tả: thay thế toàn bộ từ đó trong ô nội dung đang sửa (không
  // phân biệt hoa/thường khi tìm, chỉ khớp trọn từ — tránh thay nhầm vào giữa từ khác).
  const applySuggestion = (word: string, suggestion: string) => {
    const current = (rowEditForm.getFieldValue('content') as string | undefined) ?? ''
    if (!current) return
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu')
    rowEditForm.setFieldsValue({
      content: current.replace(re, (_m, before: string, matched: string) => `${before}${matchCase(matched, suggestion)}`),
    })
  }

  const handleSaveRowEdit = async () => {
    if (!editingRow) return
    const values = await rowEditForm.validateFields()
    const optionTexts = [values.opt0, values.opt1, values.opt2, values.opt3].map(
      (v) => (v?.trim() ? v.trim() : null),
    )
    if (optionTexts.filter(Boolean).length < 2) { message.error('Cần ít nhất 2 đáp án'); return }
    if (!optionTexts[values.correctIndex]) { message.error('Đáp án đúng đang trỏ tới một ô trống'); return }

    const content = values.content.trim()
    const explanation = values.explanation?.trim() || null

    setSavingRowEdit(true)
    let duplicateLevel = editingRow.duplicateLevel
    let duplicateMatch = editingRow.duplicateMatch
    let spellingWarnings = editingRow.spellingWarnings
    try {
      const [dupRes, spellRes] = await Promise.all([
        api.post('/admin/bank-questions/check-duplicates', { texts: [content] }),
        api.post('/admin/bank-questions/check-spelling', { texts: [content] }),
      ])
      const topMatch = (dupRes.data as DupResult[])[0]?.matches[0] ?? null
      duplicateLevel = topMatch?.level ?? null
      duplicateMatch = topMatch ? { id: topMatch.id, content: topMatch.content, score: topMatch.score } : null
      spellingWarnings = (spellRes.data as SpellResult[])[0]?.warnings ?? []
    } catch {
      // Không kiểm tra lại được thì vẫn lưu nội dung đã sửa, chỉ giữ nguyên cảnh báo cũ
    } finally {
      setSavingRowEdit(false)
    }

    const rowNumber = editingRow.rowNumber
    setPreviewData((prev) => prev.map((r) => (
      r.rowNumber === rowNumber
        ? { ...r, content, optionTexts, correctIndex: values.correctIndex, explanation, duplicateLevel, duplicateMatch, spellingWarnings, edited: true }
        : r
    )))
    message.success('Đã cập nhật câu hỏi')
    closeRowEdit()
  }

  const closeImportModal = () => {
    setImportModalOpen(false); setImportFile(null)
    setPreviewStep('upload'); setPreviewData([]); setPreviewErrors([])
    setSheetNames([]); setSelectedSheet(undefined); setImportDuplicates(false)
    closeRowEdit()
  }

  // ── Các cột ──────────────────────────────────────────────────────────
  const columns = [
    {
      title: 'Câu hỏi', dataIndex: 'content', ellipsis: true,
      render: (v: string) => <Tooltip title={v}><span>{v}</span></Tooltip>,
    },
    {
      title: 'Lĩnh vực', dataIndex: ['subject', 'name'], width: 160,
      render: (v: string) => v ? <Tag color="cyan">{v}</Tag> : '-',
    },
    {
      title: 'Loại', dataIndex: 'questionType', width: 110,
      render: (v: string) => {
        const label = v === 'SINGLE' ? 'Chọn 1' : v === 'MULTIPLE' ? 'Chọn nhiều' : 'Sắp xếp'
        const color = v === 'SINGLE' ? 'blue' : v === 'MULTIPLE' ? 'purple' : 'gold'
        return <Tag color={color}>{label}</Tag>
      },
    },
    { title: 'Điểm', dataIndex: 'points', width: 70 },
    {
      title: '', width: 100,
      render: (_: unknown, r: Question) => renderQuestionActions(r),
    },
  ]

  const subjectMenu = (
    <>
      <div style={{ padding: '16px 12px 8px' }}>
        <Title level={5} style={{ margin: 0 }}>Lĩnh vực</Title>
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <Button icon={<PlusOutlined />} size="small" block onClick={openNewSubjectModal}>
          Tạo lĩnh vực
        </Button>
      </div>
      <Menu
        mode="inline"
        selectedKeys={selectedSubjectId ? [selectedSubjectId] : ['__all__']}
        onClick={({ key }) => { setSelectedSubjectId(key === '__all__' ? null : key); setSubjectDrawerOpen(false) }}
        items={[
          {
            key: '__all__',
            label: `Tất cả (${subjects.reduce((s, x) => s + (x._count?.questions ?? 0), 0)})`,
          },
          ...subjects.map((s) => ({
            key: s.id,
            label: (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Tooltip title={s.name} mouseEnterDelay={0.5}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                </Tooltip>
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  <Tag style={{ marginRight: 0 }}>{s._count?.questions ?? 0}</Tag>
                  <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEditSubjectModal(s)} />
                  <Popconfirm title="Xóa lĩnh vực?" onConfirm={() => deleteSubjectMutation.mutate(s.id)}>
                    <Button type="text" icon={<DeleteOutlined />} size="small" danger />
                  </Popconfirm>
                </Space>
              </div>
            ),
          })),
        ]}
      />
    </>
  )

  const renderQuestionActions = (r: Question) => (
    <Space>
      <Button icon={<EditOutlined />} size="small" onClick={() => openEditQuestion(r)} />
      <Popconfirm title="Xóa câu hỏi?" onConfirm={() => deleteQuestionMutation.mutate(r.id)}>
        <Button icon={<DeleteOutlined />} size="small" danger />
      </Popconfirm>
    </Space>
  )

  const selectedSubject = selectedSubjectId ? subjects.find((s) => s.id === selectedSubjectId) ?? null : null
  const deleteAllDescription = selectedSubject
    ? `Bạn có chắc muốn xóa toàn bộ ${questions.length} câu hỏi của lĩnh vực "${selectedSubject.name}"? Hành động này không thể hoàn tác.`
    : `Bạn có chắc muốn xóa sạch ${questions.length} câu hỏi trong ngân hàng câu hỏi? Hành động này không thể hoàn tác.`

  return (
    <Layout style={{ minHeight: '100%', background: 'transparent' }}>
      {/* Thanh bên lĩnh vực — chỉ hiện từ tablet ngang/desktop, phone dùng Select + Drawer bên dưới */}
      {!isCardView && (
        <Sider
          width={siderWidth}
          style={{
            background: '#fff', borderRight: '1px solid #f0f0f0', borderRadius: 8,
            position: 'relative', transition: isResizing ? 'none' : undefined,
          }}
        >
          {subjectMenu}
          {/* Kéo để đổi độ rộng — tên lĩnh vực dài dễ bị cắt chữ ở độ rộng mặc định */}
          <div
            onMouseDown={onSiderResizeStart}
            style={{
              position: 'absolute', top: 0, bottom: 0, right: -3, width: 6,
              cursor: 'col-resize', zIndex: 10, background: 'transparent',
            }}
            title="Kéo để thay đổi độ rộng"
          />
        </Sider>
      )}

      {/* Nội dung chính */}
      <Content style={{ padding: isCardView ? 0 : '0 0 0 16px' }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 8, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Title level={5} style={{ margin: 0 }}>
            {selectedSubjectId ? subjects.find((s) => s.id === selectedSubjectId)?.name : 'Tất cả câu hỏi'}
            <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 14, marginLeft: 8 }}>
              ({questions.length} câu)
            </Text>
          </Title>
          <Space wrap>
            <Popconfirm
              title="Xóa toàn bộ câu hỏi?"
              description={deleteAllDescription}
              okText="Xóa toàn bộ"
              cancelText="Hủy"
              okButtonProps={{ danger: true, loading: deleteAllQuestionsMutation.isPending }}
              onConfirm={() => deleteAllQuestionsMutation.mutate(selectedSubjectId)}
              disabled={questions.length === 0}
            >
              <Button
                icon={<DeleteOutlined />}
                danger
                disabled={questions.length === 0}
                loading={deleteAllQuestionsMutation.isPending}
              >
                Xóa toàn bộ
              </Button>
            </Popconfirm>
            <Button
              icon={<UploadOutlined />}
              onClick={() => {
                if (!selectedSubjectId) { message.warning('Chọn lĩnh vực trước khi import'); return }
                setImportModalOpen(true)
              }}
            >
              Import Excel
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNewQuestion}>
              Thêm câu hỏi
            </Button>
          </Space>
        </div>

        {isCardView && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Select
              style={{ flex: 1, minWidth: 0 }}
              value={selectedSubjectId ?? '__all__'}
              onChange={(v) => setSelectedSubjectId(v === '__all__' ? null : v)}
              options={[
                { value: '__all__', label: `Tất cả (${subjects.reduce((s, x) => s + (x._count?.questions ?? 0), 0)})` },
                ...subjects.map((s) => ({ value: s.id, label: `${s.name} (${s._count?.questions ?? 0})` })),
              ]}
            />
            <Tooltip title="Quản lý lĩnh vực">
              <Button icon={<SettingOutlined />} onClick={() => setSubjectDrawerOpen(true)} aria-label="Quản lý lĩnh vực" />
            </Tooltip>
          </div>
        )}

        <ManageTable<Question>
          rowKey="id" dataSource={questions} columns={columns} loading={isLoading}
          pagination={{ showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'], defaultPageSize: 50 }}
          expandable={{
            expandedRowRender: (r) => (
              <div style={{ padding: '4px 0' }}>
                {r.options
                  .slice()
                  .sort((a, b) => a.orderIndex - b.orderIndex)
                  .map((o, i) => (
                    <div key={i} style={{ padding: '3px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.questionType === 'ORDERING'
                        ? <Tag>{i + 1}</Tag>
                        : (o.isCorrect ? <Tag color="green">✔</Tag> : <Tag color="default">✗</Tag>)}
                      {o.content}
                    </div>
                  ))}
              </div>
            ),
          }}
          cardHeading={(q) => <Title level={5} style={{ margin: 0 }}>{q.content}</Title>}
          cardBadge={(q) => {
            const label = q.questionType === 'SINGLE' ? 'Chọn 1' : q.questionType === 'MULTIPLE' ? 'Chọn nhiều' : 'Sắp xếp'
            const color = q.questionType === 'SINGLE' ? 'blue' : q.questionType === 'MULTIPLE' ? 'purple' : 'gold'
            return <Tag color={color}>{label}</Tag>
          }}
          cardMeta={[
            { label: 'Lĩnh vực', render: (q) => q.subject?.name ? <Tag color="cyan">{q.subject.name}</Tag> : '-' },
            { label: 'Điểm', render: (q) => q.points },
          ]}
          cardExtra={(q) => (
            <div>
              {q.options.slice().sort((a, b) => a.orderIndex - b.orderIndex).map((o, i) => (
                <div key={i} style={{ padding: '3px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {q.questionType === 'ORDERING'
                    ? <Tag>{i + 1}</Tag>
                    : (o.isCorrect ? <Tag color="green">✔</Tag> : <Tag color="default">✗</Tag>)}
                  {o.content}
                </div>
              ))}
            </div>
          )}
          cardActions={renderQuestionActions}
        />

        <Drawer
          title="Lĩnh vực"
          placement="left"
          size={280}
          open={isCardView && subjectDrawerOpen}
          onClose={() => setSubjectDrawerOpen(false)}
        >
          {subjectMenu}
        </Drawer>
      </Content>

      {/* Modal: Lĩnh vực */}
      <Modal
        title={editSubject ? 'Sửa lĩnh vực' : 'Tạo lĩnh vực'}
        open={subjectModalOpen}
        onCancel={() => { setSubjectModalOpen(false); setEditSubject(null); subjectForm.resetFields() }}
        onOk={() => subjectForm.submit()}
        confirmLoading={createSubjectMutation.isPending || updateSubjectMutation.isPending}
      >
        <Form form={subjectForm} layout="vertical" onFinish={handleSubjectSubmit}>
          <Form.Item name="name" label="Tên lĩnh vực" rules={[{ required: true }]}>
            <Input placeholder="VD: Nghiệp vụ Tín dụng" />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Drawer: Câu hỏi */}
      <Drawer
        title={editQuestion ? 'Sửa câu hỏi' : 'Thêm câu hỏi vào ngân hàng'}
        size="large"
        open={questionDrawerOpen}
        onClose={() => { setQuestionDrawerOpen(false); setEditQuestion(null); questionForm.resetFields() }}
        extra={
          <Button
            type="primary"
            onClick={() => questionForm.submit()}
            loading={createQuestionMutation.isPending || updateQuestionMutation.isPending}
          >
            Lưu
          </Button>
        }
      >
        <Form form={questionForm} layout="vertical" onFinish={handleQuestionSubmit}>
          <Form.Item name="subjectId" label="Lĩnh vực" rules={[{ required: true }]}>
            <Select options={subjects.map((s) => ({ value: s.id, label: s.name }))} placeholder="Chọn lĩnh vực" />
          </Form.Item>
          <Form.Item name="content" label="Nội dung câu hỏi" rules={[{ required: true }]}>
            <Input.TextArea
              rows={3}
              spellCheck
              lang="vi"
              onBlur={(e) => onContentBlur(e.target.value)}
            />
          </Form.Item>
          <Form.Item name="imageUrl" label="Ảnh minh hoạ (URL, không bắt buộc)">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.imageUrl !== cur.imageUrl}>
            {({ getFieldValue }) => {
              const url = getFieldValue('imageUrl')
              return url ? <img src={url} alt="" className="quiz-question-image" style={{ marginBottom: 16, maxHeight: 180 }} /> : null
            }}
          </Form.Item>

          {/* Cảnh báo trùng lặp */}
          {!editQuestion && dupWarnings.length > 0 && (
            <Alert
              type={dupWarnings[0].level === 'exact' ? 'error' : 'warning'}
              showIcon
              icon={<WarningOutlined />}
              style={{ marginBottom: 12 }}
              message={dupWarnings[0].level === 'exact' ? 'Câu hỏi đã tồn tại trong ngân hàng!' : 'Câu hỏi tương tự đã có trong ngân hàng'}
              description={
                <div>
                  {dupWarnings.map((m, i) => (
                    <div key={i} style={{ fontSize: 12, marginTop: 4 }}>
                      <Tag color={m.level === 'exact' ? 'red' : 'orange'}>
                        {m.level === 'exact' ? 'Trùng' : `${Math.round(m.score * 100)}%`}
                      </Tag>
                      {m.content}
                    </div>
                  ))}
                </div>
              }
            />
          )}

          {/* Cảnh báo lỗi chính tả */}
          {!editQuestion && spellWarnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Có thể có lỗi chính tả"
              description={
                <Space size={4} wrap>
                  {spellWarnings.map((w, i) => (
                    <Tooltip key={i} title={w.suggestions.length ? `Gợi ý: ${w.suggestions.join(', ')}` : 'Không có gợi ý'}>
                      <Tag color="orange" style={{ cursor: 'help' }}>{w.word}</Tag>
                    </Tooltip>
                  ))}
                </Space>
              }
            />
          )}

          {checking && <Text type="secondary" style={{ fontSize: 12 }}>Đang kiểm tra…</Text>}

          <Form.Item name="questionType" label="Loại">
            <Radio.Group>
              <Radio value="SINGLE">Chọn 1</Radio>
              <Radio value="MULTIPLE">Chọn nhiều</Radio>
              <Radio value="ORDERING">Sắp xếp thứ tự</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="explanation" label="Giải thích đáp án đúng">
            <Input.TextArea rows={2} spellCheck lang="vi" />
          </Form.Item>
          <Form.Item name="points" label="Điểm" rules={[{ required: true }]}>
            <Input type="number" style={{ width: 100 }} />
          </Form.Item>
          <Divider>{questionTypeWatch === 'ORDERING' ? 'Thứ tự đúng (sắp từ trên xuống)' : 'Đáp án'}</Divider>
          {questionTypeWatch === 'ORDERING' && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              Nhập nội dung theo đúng thứ tự — dùng nút ↑↓ để sắp lại nếu cần. Hệ thống sẽ xáo vị trí hiển thị
              cho từng người làm bài, thứ tự bạn nhập ở đây là đáp án đúng.
            </Text>
          )}
          <Form.List name="options">
            {(fields, { move }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {fields.map((field, idx) => (
                  <div key={field.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {questionTypeWatch === 'ORDERING' ? (
                      <span className="quiz-option-letter">{idx + 1}</span>
                    ) : (
                      <Form.Item name={[field.name, 'isCorrect']} valuePropName="checked" style={{ margin: 0 }}>
                        <Checkbox />
                      </Form.Item>
                    )}
                    <Form.Item name={[field.name, 'content']} style={{ flex: 1, margin: 0 }} rules={[{ required: true, message: ' ' }]}>
                      <Input placeholder={`Đáp án ${String.fromCharCode(65 + idx)}`} spellCheck lang="vi" />
                    </Form.Item>
                    {questionTypeWatch === 'ORDERING' && (
                      <Space size={4}>
                        <Button size="small" disabled={idx === 0} onClick={() => move(idx, idx - 1)}>↑</Button>
                        <Button size="small" disabled={idx === fields.length - 1} onClick={() => move(idx, idx + 1)}>↓</Button>
                      </Space>
                    )}
                  </div>
                ))}
              </Space>
            )}
          </Form.List>
        </Form>
      </Drawer>

      {/* Modal: Nhập Excel */}
      <Modal
        title={previewStep === 'upload' ? 'Import câu hỏi từ Excel' : 'Kiểm tra trước khi import'}
        open={importModalOpen}
        onCancel={closeImportModal}
        width={previewStep === 'preview' ? 900 : 520}
        footer={
          previewStep === 'upload' ? (
            <Space>
              <Button onClick={closeImportModal}>Hủy</Button>
              <Button
                loading={previewing}
                onClick={handlePreviewImport}
                disabled={!importFile || loadingSheets || (sheetNames.length > 1 && !selectedSheet)}
              >
                Kiểm tra
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setPreviewStep('upload')}>← Quay lại</Button>
              <Button
                type="primary"
                loading={importing}
                onClick={handleImport}
                icon={<CheckCircleOutlined />}
              >
                Xác nhận import {previewData.filter((r) =>
                  importDuplicates || !r.duplicateLevel || r.duplicateLevel === 'medium',
                ).length} câu
              </Button>
            </Space>
          )
        }
      >
        {previewStep === 'upload' ? (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              File không có dòng tiêu đề. Cột: A=Câu hỏi, B-E=Đáp án, F=Số TT đúng (1=B,2=C,3=D,4=E), G=Giải thích
            </Text>
            <Text strong>Lĩnh vực: </Text>
            <Text>{subjects.find((s) => s.id === selectedSubjectId)?.name ?? '—'}</Text>
            <div style={{ marginTop: 16 }}>
              <Upload.Dragger
                accept=".xlsx,.xls"
                maxCount={1}
                beforeUpload={() => false}
                onChange={({ fileList }) => handleFileSelected(fileList[0] ?? null)}
              >
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p>Kéo thả hoặc click để chọn file .xlsx</p>
              </Upload.Dragger>
            </div>
            {loadingSheets && (
              <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                Đang đọc danh sách sheet trong file...
              </Text>
            )}
            {!loadingSheets && sheetNames.length > 1 && (
              <div style={{ marginTop: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>
                  File có {sheetNames.length} sheet — chọn sheet chứa câu hỏi cần import:
                </Text>
                <Select
                  style={{ width: '100%' }}
                  value={selectedSheet}
                  onChange={setSelectedSheet}
                  options={sheetNames.map((name) => ({ value: name, label: name }))}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Các badge tổng hợp trạng thái */}
            <Space style={{ marginBottom: 12 }} wrap>
              <Badge
                count={previewData.filter((r) => !r.duplicateLevel).length}
                overflowCount={9999}
                color="green"
              >
                <Tag color="green" style={{ padding: '4px 12px' }}>🆕 Câu mới</Tag>
              </Badge>
              <Badge
                count={previewData.filter((r) => r.duplicateLevel === 'exact' || r.duplicateLevel === 'high').length}
                overflowCount={9999}
                color="red"
              >
                <Tag color="red" style={{ padding: '4px 12px' }}>
                  🔴 Trùng {importDuplicates ? '(vẫn import)' : '(sẽ bỏ qua)'}
                </Tag>
              </Badge>
              <Badge
                count={previewData.filter((r) => r.duplicateLevel === 'medium').length}
                overflowCount={9999}
                color="orange"
              >
                <Tag color="orange" style={{ padding: '4px 12px' }}>⚠️ Tương tự</Tag>
              </Badge>
              <Badge
                count={previewData.filter((r) => r.spellingWarnings.length > 0).length}
                overflowCount={9999}
                color="gold"
              >
                <Tag color="gold" style={{ padding: '4px 12px' }}>✏️ Cảnh báo chính tả</Tag>
              </Badge>
            </Space>

            {/* Mặc định tự động bỏ qua câu 🔴 Trùng để tránh trùng lặp ngân hàng câu hỏi
                — admin bật công tắc này khi chủ đích muốn import cả những câu đó (VD
                trùng do phát hiện nhầm, hoặc muốn cố ý có bản gần giống). */}
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch size="small" checked={importDuplicates} onChange={setImportDuplicates} />
              <Text>Vẫn import cả câu 🔴 Trùng, không tự động bỏ qua</Text>
            </div>

            {previewErrors.length > 0 && (
              <Alert type="error" message={`${previewErrors.length} dòng lỗi cấu trúc`}
                description={previewErrors.slice(0, 3).join('; ')} style={{ marginBottom: 12 }} />
            )}

            <Table<PreviewRow>
              dataSource={previewData}
              rowKey="rowNumber"
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              scroll={{ x: 860 }}
              rowClassName={(r) =>
                r.duplicateLevel === 'exact' || r.duplicateLevel === 'high'
                  ? 'ant-table-row-danger'
                  : ''
              }
              columns={[
                { title: 'STT', dataIndex: 'rowNumber', width: 55 },
                {
                  title: 'Câu hỏi',
                  dataIndex: 'content',
                  ellipsis: true,
                  render: (v: string, r: PreviewRow) => (
                    <Tooltip title={v}>
                      <span>
                        {r.edited && <Tag color="blue" style={{ marginRight: 4 }}>Đã sửa</Tag>}
                        {v}
                      </span>
                    </Tooltip>
                  ),
                },
                {
                  title: 'Trạng thái',
                  width: 150,
                  render: (_: unknown, r: PreviewRow) => {
                    if (!r.duplicateLevel) return <Tag color="green">🆕 Mới</Tag>
                    if (r.duplicateLevel === 'exact') return <Tag color="red">🔴 Trùng hoàn toàn</Tag>
                    if (r.duplicateLevel === 'high') return (
                      <Tooltip title={r.duplicateMatch?.content ?? ''}>
                        <Tag color="red">🔴 {Math.round((r.duplicateMatch?.score ?? 0) * 100)}% trùng</Tag>
                      </Tooltip>
                    )
                    return (
                      <Tooltip title={r.duplicateMatch?.content ?? ''}>
                        <Tag color="orange">⚠️ {Math.round((r.duplicateMatch?.score ?? 0) * 100)}% tương tự</Tag>
                      </Tooltip>
                    )
                  },
                },
                {
                  title: 'Chính tả',
                  width: 180,
                  render: (_: unknown, r: PreviewRow) => r.spellingWarnings.length === 0
                    ? <Text type="secondary">—</Text>
                    : (
                      <Space size={2} wrap>
                        {r.spellingWarnings.map((w, i) => (
                          <Tooltip key={i} title={w.suggestions.length ? `Gợi ý: ${w.suggestions.join(', ')}` : 'Không có gợi ý'}>
                            <Tag color="gold" style={{ cursor: 'help', fontSize: 11 }}>{w.word}</Tag>
                          </Tooltip>
                        ))}
                      </Space>
                    ),
                },
                {
                  title: '',
                  width: 50,
                  render: (_: unknown, r: PreviewRow) => (
                    <Tooltip title="Sửa câu hỏi này">
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        aria-label={`Sửa dòng ${r.rowNumber}`}
                        onClick={() => openRowEdit(r)}
                      />
                    </Tooltip>
                  ),
                },
              ] as ColumnType<PreviewRow>[]}
            />
            <style>{`.ant-table-row-danger td { background: ${token.colorErrorBg} !important; }`}</style>
          </>
        )}
      </Modal>

      {/* Modal: Sửa nhanh 1 câu trong bảng xem trước — mở lồng trên modal Nhập Excel,
          để admin khắc phục cảnh báo chính tả/trùng lặp ngay mà không cần sửa lại file rồi tải lên lại */}
      <Modal
        title={editingRow ? `Sửa câu hỏi — Dòng ${editingRow.rowNumber}` : 'Sửa câu hỏi'}
        open={editingRow !== null}
        onCancel={closeRowEdit}
        onOk={() => void handleSaveRowEdit()}
        confirmLoading={savingRowEdit}
        okText="Lưu thay đổi"
        cancelText="Hủy"
        width={640}
        destroyOnHidden
      >
        <Form form={rowEditForm} layout="vertical">
          <Form.Item name="content" label="Nội dung câu hỏi" rules={[{ required: true, message: 'Nhập nội dung câu hỏi' }]}>
            <Input.TextArea rows={3} spellCheck lang="vi" />
          </Form.Item>

          {editingRow && editingRow.spellingWarnings.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Nghi ngờ sai chính tả — bấm vào gợi ý để thay ngay trong nội dung:
              </Text>
              <Space direction="vertical" size={4}>
                {editingRow.spellingWarnings.map((w, i) => (
                  <Space key={i} size={4} wrap>
                    <Tag color="gold">{w.word}</Tag>
                    {w.suggestions.length === 0
                      ? <Text type="secondary" style={{ fontSize: 12 }}>không có gợi ý</Text>
                      : w.suggestions.map((s) => (
                        <Tag key={s} color="blue" style={{ cursor: 'pointer' }} onClick={() => applySuggestion(w.word, s)}>
                          → {s}
                        </Tag>
                      ))}
                  </Space>
                ))}
              </Space>
            </div>
          )}

          <Divider style={{ margin: '0 0 16px' }}>Đáp án (chọn đáp án đúng)</Divider>
          <Form.Item name="correctIndex" rules={[{ required: true, message: 'Chọn đáp án đúng' }]}>
            <Radio.Group style={{ width: '100%' }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Radio value={0} />
                  <span className="quiz-option-letter">A</span>
                  <Form.Item name="opt0" style={{ flex: 1, margin: 0 }} noStyle>
                    <Input placeholder="Đáp án A (để trống nếu không dùng)" spellCheck lang="vi" />
                  </Form.Item>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Radio value={1} />
                  <span className="quiz-option-letter">B</span>
                  <Form.Item name="opt1" style={{ flex: 1, margin: 0 }} noStyle>
                    <Input placeholder="Đáp án B (để trống nếu không dùng)" spellCheck lang="vi" />
                  </Form.Item>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Radio value={2} />
                  <span className="quiz-option-letter">C</span>
                  <Form.Item name="opt2" style={{ flex: 1, margin: 0 }} noStyle>
                    <Input placeholder="Đáp án C (để trống nếu không dùng)" spellCheck lang="vi" />
                  </Form.Item>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Radio value={3} />
                  <span className="quiz-option-letter">D</span>
                  <Form.Item name="opt3" style={{ flex: 1, margin: 0 }} noStyle>
                    <Input placeholder="Đáp án D (để trống nếu không dùng)" spellCheck lang="vi" />
                  </Form.Item>
                </div>
              </Space>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="explanation" label="Giải thích đáp án đúng (không bắt buộc)">
            <Input.TextArea rows={2} spellCheck lang="vi" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  )
}
