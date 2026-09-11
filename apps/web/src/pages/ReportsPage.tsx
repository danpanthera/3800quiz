import { useCallback, useMemo, useState, type Key } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button, Card, Col, Input, Popconfirm, Progress, Row,
  Select, Space, Statistic, Tag, Typography, message,
} from 'antd'
import { DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { Resizable } from 'react-resizable'
import type { ResizeCallbackData } from 'react-resizable'
import 'react-resizable/css/styles.css'
import ManageTable from '../components/ManageTable'
import api from '../lib/api'

interface ReportRow {
  id: string
  userId: string
  fullName: string
  departmentId: string | null
  department: string
  parentDepartmentId: string | null
  parentDepartment: string | null
  quizTitle: string
  score: number | null
  status: string
  submittedAt: string | null
  isBestForUser: boolean
}

interface Dept {
  id: string
  name: string
  parentId: string | null
  parent: { id: string; name: string } | null
}

// Ô tiêu đề cột có thể kéo thả, cho phép admin tự chỉnh độ rộng cột
const ResizableTitle = (props: React.HTMLAttributes<HTMLElement> & {
  onResize: (e: React.SyntheticEvent, data: ResizeCallbackData) => void
  width: number
}) => {
  const { onResize, width, ...restProps } = props
  if (!width) return <th {...restProps} />
  return (
    <Resizable
      width={width}
      height={0}
      handle={
        <span
          className="react-resizable-handle"
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', right: -5, bottom: 0, zIndex: 1, width: 10, height: '100%', cursor: 'col-resize' }}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} style={{ ...restProps.style, position: 'relative' }} />
    </Resizable>
  )
}

// Chuẩn hoá chuỗi tiếng Việt để tìm kiếm không phân biệt dấu
const vn = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D')).toLowerCase()

const STATUS_COLOR: Record<string, string> = {
  GRADED: 'success',
  SYNCED: 'processing',
  PENDING_SYNC: 'warning',
  SYNC_ERROR: 'error',
}
const STATUS_LABEL: Record<string, string> = {
  GRADED: 'Đã chấm',
  SYNCED: 'Đã đồng bộ',
  PENDING_SYNC: 'Chờ đồng bộ',
  SYNC_ERROR: 'Lỗi sync',
}

// Độ rộng mặc định của từng cột (key = index trong mảng columns)
const DEFAULT_COL_WIDTHS = [140, 180, 200, 180, 180, 130, 175, 50]

export default function ReportsPage() {
  const qc = useQueryClient()
  const [searchName, setSearchName] = useState('')
  const [filterBranch, setFilterBranch] = useState<string | undefined>()
  const [filterDept, setFilterDept] = useState<string | undefined>()
  const [filterQuiz, setFilterQuiz] = useState<string | undefined>()
  const [filterScore, setFilterScore] = useState<string | undefined>()
  const [colWidths, setColWidths] = useState<number[]>(DEFAULT_COL_WIDTHS)
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])

  // Xóa xong bài thi thì Thành tích/Bảng xếp hạng đã được server tính lại —
  // làm mới luôn các trang liên quan nếu admin đang mở song song.
  const invalidateAfterDelete = () => {
    qc.invalidateQueries({ queryKey: ['reports'] })
    qc.invalidateQueries({ queryKey: ['leaderboard'] })
    qc.invalidateQueries({ queryKey: ['badge-stats'] })
  }

  const handleResize = useCallback(
    (index: number) => (_: React.SyntheticEvent, { size }: ResizeCallbackData) => {
      setColWidths((prev) => {
        const next = [...prev]
        next[index] = size.width
        return next
      })
    },
    [],
  )

  const { data: rows = [], isLoading } = useQuery<ReportRow[]>({
    queryKey: ['reports'],
    queryFn: () => api.get('/admin/reports').then((r) => r.data),
  })

  const { data: depts = [] } = useQuery<Dept[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then((r) => r.data),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/reports/${id}`),
    onSuccess: () => { message.success('Đã xóa bài thi'); invalidateAfterDelete() },
    onError: () => message.error('Xóa thất bại'),
  })

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => api.delete('/admin/reports/bulk', { data: { ids } }).then((r) => r.data),
    onSuccess: (data: { deleted: number }) => {
      setSelectedRowKeys([])
      invalidateAfterDelete()
      message.success(`Đã xóa ${data.deleted} bài thi — thành tích và bảng xếp hạng đã được cập nhật lại`)
    },
    onError: () => message.error('Xóa thất bại'),
  })

  // Chi nhánh = dept cấp gốc (không có parent)
  const branches = useMemo(() => depts.filter((d) => !d.parentId), [depts])

  // Phòng ban = con của chi nhánh đang chọn (hoặc tất cả dept có parent)
  const subDepts = useMemo(
    () => (filterBranch ? depts.filter((d) => d.parentId === filterBranch) : depts.filter((d) => d.parentId)),
    [depts, filterBranch],
  )

  // Bộ đề: lấy danh sách duy nhất từ dữ liệu (client-side)
  const quizOptions = useMemo(
    () => [...new Set(rows.map((r) => r.quizTitle).filter(Boolean))].sort().map((t) => ({ value: t, label: t })),
    [rows],
  )

  const SCORE_OPTIONS = [
    { value: 'not_graded', label: 'Chưa chấm' },
    { value: 'pass', label: 'Đạt (≥ 60%)' },
    { value: 'fail', label: 'Chưa đạt (< 60%)' },
  ]

  const filtered = useMemo(() => {
    const q = vn(searchName.trim())
    return rows.filter((r) => {
      if (filterBranch) {
        const inBranchAsDept = r.departmentId === filterBranch
        const inBranchAsParent = r.parentDepartmentId === filterBranch
        if (!inBranchAsDept && !inBranchAsParent) return false
      }
      if (filterDept && r.departmentId !== filterDept) return false
      if (filterQuiz && r.quizTitle !== filterQuiz) return false
      if (filterScore === 'not_graded' && r.score !== null) return false
      if (filterScore === 'pass' && (r.score === null || r.score < 60)) return false
      if (filterScore === 'fail' && (r.score === null || r.score >= 60)) return false
      if (q && !vn(r.fullName).includes(q)) return false
      return true
    })
  }, [rows, filterBranch, filterDept, filterQuiz, filterScore, searchName])

  const gradedRows = filtered.filter((r) => r.status === 'GRADED' && r.score !== null)
  // Bộ đề cho phép thi lại nên 1 người có thể có nhiều bài nộp — thống kê chỉ
  // tính bài điểm cao nhất mỗi người/mỗi bộ đề (isBestForUser) để không cộng
  // dồn nhầm các lần thi lại của cùng 1 người vào điểm trung bình/tỷ lệ đạt.
  const officialRows = gradedRows.filter((r) => r.isBestForUser)
  const avgScore = officialRows.length > 0
    ? Math.round(officialRows.reduce((s, r) => s + (r.score ?? 0), 0) / officialRows.length)
    : 0
  const passCount = officialRows.filter((r) => (r.score ?? 0) >= 60).length

  const renderReportActions = (r: ReportRow) => (
    <Popconfirm
      title="Xóa bài thi?"
      description="Hành động không thể hoàn tác."
      okText="Xóa"
      cancelText="Hủy"
      okButtonProps={{ danger: true }}
      onConfirm={() => deleteMut.mutate(r.id)}
    >
      <Button type="text" danger icon={<DeleteOutlined />} size="small" />
    </Popconfirm>
  )

  const baseColumns: ColumnsType<ReportRow> = [
    {
      title: 'Cán bộ',
      dataIndex: 'fullName',
      sorter: (a, b) => a.fullName.localeCompare(b.fullName, 'vi'),
    },
    {
      title: 'Chi nhánh',
      dataIndex: 'parentDepartment',
      render: (v: string | null, r) => v ?? (r.parentDepartmentId ? '' : r.department) ?? '—',
    },
    {
      title: 'Phòng ban',
      dataIndex: 'department',
    },
    {
      title: 'Bộ đề',
      dataIndex: 'quizTitle',
    },
    {
      title: 'Điểm',
      dataIndex: 'score',
      sorter: (a, b) => (a.score ?? -1) - (b.score ?? -1),
      render: (v: number | null, r) =>
        v !== null ? (
          <Space>
            <Progress percent={Math.round(v)} size="small" style={{ width: 90 }} />
            <Tag color={(v >= 60) ? 'success' : 'error'}>{v >= 60 ? 'Đạt' : 'Chưa đạt'}</Tag>
            {r.isBestForUser === false && <Tag>Lần thi lại</Tag>}
          </Space>
        ) : (
          <Tag>Chưa nộp</Tag>
        ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      filters: Object.entries(STATUS_LABEL).map(([v, t]) => ({ text: t, value: v })),
      onFilter: (v, r) => r.status === v,
      render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{STATUS_LABEL[v] ?? v}</Tag>,
    },
    {
      title: 'Thời gian nộp',
      dataIndex: 'submittedAt',
      sorter: (a, b) => new Date(a.submittedAt ?? 0).getTime() - new Date(b.submittedAt ?? 0).getTime(),
      defaultSortOrder: 'descend',
      render: (v: string | null) => (v ? new Date(v).toLocaleString('vi-VN') : '—'),
    },
    {
      title: '',
      render: (_, r) => renderReportActions(r),
    },
  ]

  // Gắn width động và onHeaderCell để hỗ trợ kéo thả độ rộng cột
  const columns = baseColumns.map((col, index) => ({
    ...col,
    width: colWidths[index],
    onHeaderCell: (column: { width?: number | string }) => ({
      width: typeof column.width === 'number' ? column.width : undefined,
      onResize: handleResize(index),
    }),
    onCell: () => ({ style: { whiteSpace: 'normal' as const, wordBreak: 'break-word' as const } }),
  })) as ColumnsType<ReportRow>

  const hasFilter = !!(searchName || filterBranch || filterDept || filterQuiz || filterScore)

  return (
    <>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>Báo cáo kết quả</Typography.Title>

      {/* Thống kê tổng quan */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}>
          <Card size="small"><Statistic title="Tổng bài thi" value={filtered.length} /></Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small"><Statistic title="Đã chấm điểm" value={gradedRows.length} /></Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small"><Statistic title="Điểm TB" value={avgScore} suffix="%" /></Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small">
            <Statistic
              title="Đạt (≥ 60%)"
              value={passCount}
              suffix={officialRows.length ? `/ ${officialRows.length}` : ''}
            />
          </Card>
        </Col>
      </Row>

      {/* Bộ lọc */}
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Tìm tên cán bộ (có dấu hoặc không dấu)..."
          style={{ width: 310 }}
          allowClear
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
        />
        <Select
          placeholder="Chi nhánh"
          style={{ width: 200 }}
          allowClear
          value={filterBranch}
          onChange={(v) => { setFilterBranch(v); setFilterDept(undefined) }}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          showSearch
          filterOption={(input, opt) => vn(opt?.label ?? '').includes(vn(input))}
        />
        <Select
          placeholder="Phòng ban"
          style={{ width: 200 }}
          allowClear
          value={filterDept}
          onChange={setFilterDept}
          options={subDepts.map((d) => ({ value: d.id, label: d.name }))}
          showSearch
          filterOption={(input, opt) => vn(opt?.label ?? '').includes(vn(input))}
        />
        <Select
          placeholder="Bộ đề"
          style={{ width: 220 }}
          allowClear
          value={filterQuiz}
          onChange={setFilterQuiz}
          options={quizOptions}
          showSearch
          filterOption={(input, opt) => vn(opt?.label ?? '').includes(vn(input))}
        />
        <Select
          placeholder="Điểm"
          style={{ width: 160 }}
          allowClear
          value={filterScore}
          onChange={setFilterScore}
          options={SCORE_OPTIONS}
        />
        {hasFilter && (
          <Button
            onClick={() => { setSearchName(''); setFilterBranch(undefined); setFilterDept(undefined); setFilterQuiz(undefined); setFilterScore(undefined) }}
          >
            Xóa bộ lọc
          </Button>
        )}
      </Space>

      {/* Xóa hàng loạt / xóa toàn bộ — xóa xong Thành tích & Bảng xếp hạng tự cập nhật lại */}
      <Space wrap style={{ marginBottom: 12 }}>
        {selectedRowKeys.length > 0 && (
          <Popconfirm
            title={`Xóa ${selectedRowKeys.length} bài thi đã chọn?`}
            description="Thành tích (XP, huy hiệu) và bảng xếp hạng của các cán bộ liên quan sẽ được tính lại. Không thể hoàn tác."
            okText="Xóa" okButtonProps={{ danger: true }}
            cancelText="Hủy"
            onConfirm={() => bulkDeleteMut.mutate(selectedRowKeys as string[])}
          >
            <Button danger icon={<DeleteOutlined />} loading={bulkDeleteMut.isPending}>
              Xóa đã chọn ({selectedRowKeys.length})
            </Button>
          </Popconfirm>
        )}
        {filtered.length > 0 && (
          <Popconfirm
            title={hasFilter ? `Xóa toàn bộ ${filtered.length} bài thi đang lọc?` : `Xóa/reset toàn bộ ${filtered.length} bài thi?`}
            description="Thành tích (XP, huy hiệu) và bảng xếp hạng của mọi cán bộ liên quan sẽ được tính lại. Không thể hoàn tác."
            okText="Xóa toàn bộ" okButtonProps={{ danger: true }}
            cancelText="Hủy"
            onConfirm={() => bulkDeleteMut.mutate(filtered.map((r) => r.id))}
          >
            <Button danger icon={<DeleteOutlined />} loading={bulkDeleteMut.isPending}>
              {hasFilter ? 'Xóa toàn bộ (đang lọc)' : 'Xóa / Reset toàn bộ'}
            </Button>
          </Popconfirm>
        )}
      </Space>

      <ManageTable<ReportRow>
        rowKey="id"
        loading={isLoading}
        dataSource={filtered}
        columns={columns}
        rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, preserveSelectedRowKeys: true }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'], showTotal: (t) => `${t} bài thi` }}
        size="small"
        scroll={{ x: 'max-content' }}
        components={{ header: { cell: ResizableTitle } }}
        cardHeading={(r) => <Typography.Title level={5}>{r.fullName}</Typography.Title>}
        cardBadge={(r) => <Tag color={STATUS_COLOR[r.status] ?? 'default'}>{STATUS_LABEL[r.status] ?? r.status}</Tag>}
        cardMeta={[
          {
            label: 'Chi nhánh',
            render: (r) => r.parentDepartment ?? (r.parentDepartmentId ? '' : r.department) ?? '—',
          },
          { label: 'Phòng ban', render: (r) => r.department },
          { label: 'Bộ đề', render: (r) => r.quizTitle },
          {
            label: 'Điểm',
            render: (r) => r.score !== null ? (
              <Space>
                <Progress percent={Math.round(r.score)} size="small" style={{ width: 90 }} />
                <Tag color={(r.score >= 60) ? 'success' : 'error'}>{r.score >= 60 ? 'Đạt' : 'Chưa đạt'}</Tag>
              </Space>
            ) : (
              <Tag>Chưa nộp</Tag>
            ),
          },
          { label: 'Thời gian nộp', render: (r) => r.submittedAt ? new Date(r.submittedAt).toLocaleString('vi-VN') : '—' },
        ]}
        cardActions={renderReportActions}
      />
    </>
  )
}

