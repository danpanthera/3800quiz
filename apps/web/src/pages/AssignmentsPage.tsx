import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Tag, Typography, Badge, Button, Space, Popconfirm, App,
  Modal, Form, Select, DatePicker, Radio, Divider, Input, Upload,
} from 'antd'
import { SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined, TeamOutlined, ApartmentOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import type { AxiosResponse } from 'axios'
import ManageTable from '../components/ManageTable'
import api, { getErrorMessage } from '../lib/api'

// Chuẩn hoá chuỗi tiếng Việt để tìm kiếm không phân biệt dấu
const vn = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D')).toLowerCase()

interface Assignment {
  id: string
  quiz: { id: string; title: string }
  user: { id: string; fullName: string; department?: { id: string; name: string; parentId?: string | null } | null } | null
  canBo: { id: string; fullName: string; cbCode: string; department?: { id: string; name: string } | null } | null
  department: { id: string; name: string; parentId?: string | null } | null
  startAt: string | null
  endAt: string | null
  status: string
}
interface Quiz { id: string; title: string }
interface Department {
  id: string; name: string; code: string; parentId?: string | null;
  parent?: { id: string; name: string; code: string } | null;
  _count?: { children: number }
}
interface CanBoItem {
  id: string; fullName: string; cbCode: string; username?: string | null; isActive: boolean;
  departmentId?: string | null;
  department?: { id: string; name: string; code: string; parentId?: string | null; parent?: { id: string; name: string; code: string } | null } | null;
}

/** Giá trị các trường trong Form tạo/sửa phân công */
interface AssignmentFormValues {
  quizId: string
  departmentIds?: string[]
  canBoIds?: string[]
  status: string
  startAt?: Dayjs | null
  endAt?: Dayjs | null
}

/** Dữ liệu gửi lên khi tạo 1 phân công (giao cho đúng 1 cán bộ) */
interface AssignmentCreatePayload {
  quizId: string
  canBoId: string
  status: string
  startAt: string | null
  endAt: string | null
}

/** Dữ liệu gửi lên khi tạo hàng loạt phân công (tất cả / theo phòng ban / nhiều cán bộ) */
interface AssignmentBulkPayload {
  quizId: string
  canBoIds?: string[] | 'all'
  departmentIds?: string[]
  status: string
  startAt: string | null
  endAt: string | null
}

/** Dữ liệu gửi lên khi sửa 1 phân công đã có */
interface AssignmentUpdatePayload {
  quizId: string
  status: string
  startAt: string | null
  endAt: string | null
  departmentId?: string
  canBoId?: string
}

/** Kết quả trả về từ API tạo hàng loạt phân công */
interface BulkAssignmentResult {
  count: number
}

// Thứ tự đơn vị cố định
const UNIT_ORDER = ['01-HS','02-LT','03-QN','04-QT','05-LTK','06-THD','07-LTT']

export default function AssignmentsPage() {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editItem, setEditItem] = useState<Assignment | null>(null)
  const [form] = Form.useForm()

  // State cho form tạo mới
  const [assignTarget, setAssignTarget] = useState<'all' | 'custom' | 'department'>('custom')
  const [filterUnitId, setFilterUnitId] = useState<string | undefined>()
  const [filterDeptId, setFilterDeptId] = useState<string | undefined>()

  // State cho bộ lọc danh sách phân công (khác state lọc trong modal tạo/sửa ở trên)
  const [searchCanBo, setSearchCanBo] = useState('')
  const [listFilterQuizId, setListFilterQuizId] = useState<string | undefined>()
  const [listFilterUnitId, setListFilterUnitId] = useState<string | undefined>()
  const [listFilterDeptId, setListFilterDeptId] = useState<string | undefined>()

  const { data = [], isLoading } = useQuery<Assignment[]>({
    queryKey: ['assignments'],
    queryFn: () => api.get('/admin/assignments').then((r) => r.data),
  })
  const { data: quizzes = [] } = useQuery<Quiz[]>({
    queryKey: ['quizzes'],
    queryFn: () => api.get('/admin/quizzes').then((r) => r.data),
  })
  const { data: canBoList = [] } = useQuery<CanBoItem[]>({
    queryKey: ['can-bo'],
    queryFn: () => api.get('/admin/can-bo').then((r) => r.data),
  })
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then((r) => r.data),
  })

  // Đơn vị cấp 1 có sub-dept hoặc có user trực tiếp, sort theo UNIT_ORDER
  const topUnits = useMemo(() =>
    departments
      .filter(d => !d.parentId && (d._count?.children ?? 0) > 0)
      .sort((a, b) => {
        const ia = UNIT_ORDER.indexOf(a.code), ib = UNIT_ORDER.indexOf(b.code)
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      }),
    [departments]
  )

  // Sub-depts của unit đang chọn — chỉ hiển thị depts thực sự có canBo active
  const subDepts = useMemo(() => {
    if (!filterUnitId) return []
    const activeCanBoDeptIds = new Set(
      canBoList.filter(c => c.isActive).map(c => c.departmentId).filter(Boolean) as string[]
    )
    return departments.filter(d => d.parentId === filterUnitId && activeCanBoDeptIds.has(d.id))
  }, [departments, filterUnitId, canBoList])

  // Sub-depts của chi nhánh đang chọn trong bộ lọc danh sách (khác filterUnitId của modal) —
  // ở đây lấy tất cả phòng ban, không giới hạn có canBo active, vì mục đích là lọc/xóa
  const listSubDepts = useMemo(
    () => departments.filter(d => d.parentId === listFilterUnitId),
    [departments, listFilterUnitId]
  )
  const listSubDeptIds = useMemo(
    () => new Set(listSubDepts.map(d => d.id)),
    [listSubDepts]
  )

  // CanBo lọc theo unit+dept
  const filteredCanBo = useMemo(() => {
    return canBoList.filter(c => {
      if (!c.isActive) return false
      if (filterDeptId) return c.departmentId === filterDeptId
      if (filterUnitId) {
        const deptParentId = c.department?.parentId ?? c.department?.parent?.id
        return deptParentId === filterUnitId || c.departmentId === filterUnitId
      }
      return true
    }).sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? '', 'vi'))
  }, [canBoList, filterUnitId, filterDeptId])

  const createMut = useMutation({
    mutationFn: (d: AssignmentCreatePayload) => api.post('/admin/assignments', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assignments'] }); closeModal(); message.success('Đã tạo phân công') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi')),
  })
  const bulkMut = useMutation({
    mutationFn: (d: AssignmentBulkPayload) => api.post<BulkAssignmentResult>('/admin/assignments/bulk', d),
    onSuccess: (res: AxiosResponse<BulkAssignmentResult>) => {
      qc.invalidateQueries({ queryKey: ['assignments'] })
      closeModal()
      message.success(`Đã tạo ${res.data.count} phân công`)
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi')),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...d }: { id: string } & AssignmentUpdatePayload) => api.put(`/admin/assignments/${id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assignments'] }); closeModal(); message.success('Đã cập nhật') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi')),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/assignments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assignments'] }); message.success('Đã xóa phân công') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi xóa')),
  })
  // Gỡ hàng loạt phân công (bỏ giao bộ đề) của các cán bộ/user theo bộ đề và/hoặc chi nhánh/phòng ban
  // đang lọc — KHÔNG xóa tài khoản/hồ sơ cán bộ, chỉ gỡ liên kết "được giao bộ đề"
  const deleteByFilterMut = useMutation({
    mutationFn: () => api.delete<{ deleted: number; skipped: number }>('/admin/assignments', {
      params: {
        ...(listFilterQuizId ? { quizId: listFilterQuizId } : {}),
        ...(listFilterDeptId ? { departmentId: listFilterDeptId } : listFilterUnitId ? { departmentId: listFilterUnitId } : {}),
      },
    }),
    onSuccess: (res: AxiosResponse<{ deleted: number; skipped: number }>) => {
      const { deleted, skipped } = res.data
      qc.invalidateQueries({ queryKey: ['assignments'] })
      if (deleted === 0) message.info(skipped > 0 ? `Không gỡ được: cả ${skipped} cán bộ/user phù hợp đều đã làm bài` : 'Không có cán bộ/user nào phù hợp để gỡ phân công')
      else message.success(`Đã gỡ phân công của ${deleted} cán bộ/user${skipped > 0 ? `, giữ lại ${skipped} người đã làm bài` : ''}`)
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi gỡ phân công theo bộ lọc')),
  })

  // Gia hạn hàng loạt (đổi endAt) cho các phân công khớp bộ lọc đang hiển thị ở trên
  const [extendModalOpen, setExtendModalOpen] = useState(false)
  const [extendForm] = Form.useForm<{ newEndAt: Dayjs }>()
  const extendMut = useMutation({
    mutationFn: (newEndAt: string) => api.put<{ extended: number }>('/admin/assignments/extend', {
      newEndAt,
      ...(listFilterQuizId ? { quizId: listFilterQuizId } : {}),
      ...(listFilterDeptId ? { departmentId: listFilterDeptId } : listFilterUnitId ? { departmentId: listFilterUnitId } : {}),
    }),
    onSuccess: (res: AxiosResponse<{ extended: number }>) => {
      qc.invalidateQueries({ queryKey: ['assignments'] })
      setExtendModalOpen(false)
      extendForm.resetFields()
      message.success(`Đã gia hạn ${res.data.extended} phân công`)
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi gia hạn hàng loạt')),
  })

  // Import danh sách phân công qua Excel — file 1 cột mã cán bộ/User AD/username
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importForm] = Form.useForm<{ quizId: string; range?: [Dayjs, Dayjs] }>()
  const [importFile, setImportFile] = useState<File | null>(null)
  const importMut = useMutation({
    mutationFn: (values: { quizId: string; range?: [Dayjs, Dayjs] }) => {
      const fd = new FormData()
      fd.append('file', importFile!)
      fd.append('quizId', values.quizId)
      if (values.range?.[0]) fd.append('startAt', values.range[0].toISOString())
      if (values.range?.[1]) fd.append('endAt', values.range[1].toISOString())
      return api.post<{ created: number; notFound: string[] }>('/admin/assignments/import', fd)
    },
    onSuccess: (res: AxiosResponse<{ created: number; notFound: string[] }>) => {
      qc.invalidateQueries({ queryKey: ['assignments'] })
      setImportModalOpen(false)
      importForm.resetFields()
      setImportFile(null)
      const { created, notFound } = res.data
      if (notFound.length > 0) message.warning(`Đã tạo ${created} phân công. Không tìm thấy ${notFound.length} mã: ${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? '...' : ''}`)
      else message.success(`Đã tạo ${created} phân công`)
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi import phân công')),
  })

  const openNew = () => {
    setEditItem(null)
    setAssignTarget('custom')
    setFilterUnitId(undefined)
    setFilterDeptId(undefined)
    setModalOpen(true)
  }
  const openEdit = (row: Assignment) => {
    setEditItem(row)
    if (row.department) {
      setAssignTarget('department')
      setFilterUnitId(row.department.parentId ?? undefined)
    } else {
      setAssignTarget(row.canBo || row.user ? 'custom' : 'all')
      setFilterUnitId(undefined)
    }
    setFilterDeptId(undefined)
    setModalOpen(true)
  }
  const closeModal = () => {
    setModalOpen(false)
  }

  const handleSubmit = (values: AssignmentFormValues) => {
    const base = {
      status: values.status,
      startAt: values.startAt ? values.startAt.toISOString() : null,
      endAt: values.endAt ? values.endAt.toISOString() : null,
    }
    if (editItem) {
      const updatePayload: AssignmentUpdatePayload = { ...base, quizId: values.quizId }
      if (assignTarget === 'all') {
        // Giao cho tất cả: không thay đổi đối tượng
      } else if (assignTarget === 'department') {
        const deptIds: string[] = values.departmentIds ?? []
        if (deptIds.length > 1) {
          message.warning('Sửa phân công chỉ hỗ trợ 1 phòng ban. Để giao nhiều phòng ban, vui lòng tạo phân công mới.')
          return
        }
        if (deptIds.length === 1) updatePayload.departmentId = deptIds[0]
      } else {
        const ids: string[] = values.canBoIds ?? []
        if (ids.length === 1) updatePayload.canBoId = ids[0]
      }
      updateMut.mutate({ id: editItem.id, ...updatePayload })
      return
    }
    // Tạo mới
    if (assignTarget === 'all') {
      bulkMut.mutate({ quizId: values.quizId, canBoIds: 'all', ...base })
    } else if (assignTarget === 'department') {
      const deptIds: string[] = values.departmentIds ?? []
      if (!deptIds.length) { message.warning('Vui lòng chọn ít nhất 1 phòng ban'); return }
      bulkMut.mutate({ quizId: values.quizId, departmentIds: deptIds, ...base })
    } else {
      const ids: string[] = values.canBoIds ?? []
      if (!ids.length) { message.warning('Vui lòng chọn ít nhất 1 cán bộ'); return }
      if (ids.length === 1) {
        createMut.mutate({ quizId: values.quizId, canBoId: ids[0], ...base })
      } else {
        bulkMut.mutate({ quizId: values.quizId, canBoIds: ids, ...base })
      }
    }
  }

  const renderAssignmentActions = (row: Assignment) => (
    <Space>
      <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(row)} />
      <Popconfirm title="Xóa phân công này?" onConfirm={() => deleteMut.mutate(row.id)}>
        <Button icon={<DeleteOutlined />} size="small" danger />
      </Popconfirm>
    </Space>
  )

  const tenGiaoCho = (row: Assignment) =>
    row.canBo ? row.canBo.fullName : row.user ? row.user.fullName : (row.department?.name ?? '—')

  // ID phòng ban liên quan tới 1 dòng phân công — dù giao trực tiếp cho phòng ban,
  // cho cán bộ (theo phòng ban của cán bộ) hay cho tài khoản (theo phòng ban của user)
  const rowDepartmentIds = (row: Assignment): string[] => {
    const ids: string[] = []
    if (row.department) ids.push(row.department.id)
    if (row.canBo?.department) ids.push(row.canBo.department.id)
    if (row.user?.department) ids.push(row.user.department.id)
    return ids
  }

  // Khớp bộ lọc Chi nhánh/Phòng ban của danh sách — chọn phòng ban thì khớp đúng phòng ban đó,
  // chỉ chọn chi nhánh thì khớp chi nhánh hoặc bất kỳ phòng ban con nào của chi nhánh đó
  const matchesDeptFilter = (row: Assignment) => {
    if (listFilterDeptId) return rowDepartmentIds(row).includes(listFilterDeptId)
    if (listFilterUnitId) {
      const ids = rowDepartmentIds(row)
      return ids.includes(listFilterUnitId) || ids.some((id) => listSubDeptIds.has(id))
    }
    return true
  }

  // Lọc danh sách phân công theo Cán bộ (tên, không phân biệt dấu), theo Bộ đề, theo Chi nhánh/Phòng ban
  const filteredData = useMemo(() => {
    const keyword = vn(searchCanBo.trim())
    return data.filter((row) => {
      if (listFilterQuizId && row.quiz.id !== listFilterQuizId) return false
      if (!matchesDeptFilter(row)) return false
      if (keyword && !vn(tenGiaoCho(row)).includes(keyword)) return false
      return true
    })
  }, [data, searchCanBo, listFilterQuizId, listFilterUnitId, listFilterDeptId, listSubDeptIds])

  const hasListFilter = !!searchCanBo || !!listFilterQuizId || !!listFilterUnitId || !!listFilterDeptId
  // Chỉ bật xóa theo bộ lọc khi có bộ đề hoặc chi nhánh/phòng ban — tìm theo tên cán bộ
  // không được hỗ trợ ở API xóa hàng loạt nên không tính vào điều kiện bật nút
  const canBulkDeleteByFilter = !!listFilterQuizId || !!listFilterUnitId || !!listFilterDeptId

  const bulkDeleteScopeText = () => {
    const parts: string[] = []
    if (listFilterQuizId) parts.push(`bộ đề "${quizzes.find((q) => q.id === listFilterQuizId)?.title ?? ''}"`)
    if (listFilterDeptId) parts.push(`phòng ban "${departments.find((d) => d.id === listFilterDeptId)?.name ?? ''}"`)
    else if (listFilterUnitId) parts.push(`chi nhánh "${topUnits.find((u) => u.id === listFilterUnitId)?.name ?? ''}"`)
    return parts.join(' và ') || 'bộ lọc hiện tại'
  }

  const columns = [
    { title: 'Bộ đề', dataIndex: ['quiz', 'title'], ellipsis: true },
    {
      title: 'Giao cho',
      render: (_: unknown, row: Assignment) => tenGiaoCho(row),
    },
    {
      title: 'Loại', width: 100,
      render: (_: unknown, row: Assignment) =>
        row.canBo ? <Tag color="blue">Cán bộ</Tag>
          : row.user ? <Tag color="cyan">Tài khoản</Tag>
          : <Tag color="green">Phòng ban</Tag>,
    },
    {
      title: 'Mở từ', dataIndex: 'startAt', width: 130,
      render: (v: string | null) => v ? new Date(v).toLocaleDateString('vi-VN') : '—',
    },
    {
      title: 'Đến', dataIndex: 'endAt', width: 130,
      render: (v: string | null) => v ? new Date(v).toLocaleDateString('vi-VN') : '—',
    },
    {
      title: 'Trạng thái', dataIndex: 'status', width: 110,
      render: (v: string) => (
        <Badge status={v === 'ACTIVE' ? 'success' : v === 'DRAFT' ? 'warning' : 'default'}
          text={v === 'ACTIVE' ? 'Đang mở' : v === 'DRAFT' ? 'Nháp' : 'Đã đóng'} />
      ),
    },
    {
      title: '', width: 90,
      render: (_: unknown, row: Assignment) => renderAssignmentActions(row),
    },
  ]

  const isPending = createMut.isPending || bulkMut.isPending || updateMut.isPending

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Phân công quiz</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Tạo phân công</Button>
      </div>

      {/* Bộ lọc danh sách */}
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Tìm theo cán bộ (có dấu hoặc không dấu)..."
          style={{ width: 280 }}
          allowClear
          value={searchCanBo}
          onChange={(e) => setSearchCanBo(e.target.value)}
        />
        <Select
          placeholder="Bộ đề"
          style={{ width: 260 }}
          allowClear
          value={listFilterQuizId}
          onChange={setListFilterQuizId}
          options={quizzes.map((q) => ({ value: q.id, label: q.title }))}
          showSearch
          filterOption={(input, opt) => vn(opt?.label ?? '').includes(vn(input))}
        />
        <Select
          placeholder="Chi nhánh"
          style={{ width: 200 }}
          allowClear
          value={listFilterUnitId}
          onChange={(v) => { setListFilterUnitId(v); setListFilterDeptId(undefined) }}
          options={topUnits.map((d) => ({ value: d.id, label: d.name }))}
          showSearch
          filterOption={(input, opt) => vn(opt?.label ?? '').includes(vn(input))}
        />
        <Select
          placeholder="Phòng ban"
          style={{ width: 200 }}
          allowClear
          disabled={!listFilterUnitId}
          value={listFilterDeptId}
          onChange={setListFilterDeptId}
          options={listSubDepts.map((d) => {
            const unitName = topUnits.find((u) => u.id === listFilterUnitId)?.name ?? ''
            const label = unitName && d.name.toLowerCase().startsWith(unitName.toLowerCase())
              ? d.name.slice(unitName.length).replace(/^\s*[-–]\s*/, '').trim()
              : d.name
            return { value: d.id, label }
          })}
          showSearch
          filterOption={(input, opt) => vn(opt?.label ?? '').includes(vn(input))}
        />
        {hasListFilter && (
          <Button onClick={() => { setSearchCanBo(''); setListFilterQuizId(undefined); setListFilterUnitId(undefined); setListFilterDeptId(undefined) }}>
            Bỏ lọc
          </Button>
        )}
        <Popconfirm
          title="Gỡ phân công hàng loạt?"
          description={`Gỡ bỏ phân công bộ đề (KHÔNG xóa tài khoản/hồ sơ) khỏi toàn bộ cán bộ/user thuộc ${bulkDeleteScopeText()} (đang hiển thị ${filteredData.length} người). Người đã làm bài sẽ được giữ lại. Hành động này không thể hoàn tác.`}
          okText="Gỡ phân công"
          cancelText="Hủy"
          okButtonProps={{ danger: true, loading: deleteByFilterMut.isPending }}
          onConfirm={() => deleteByFilterMut.mutate()}
          disabled={!canBulkDeleteByFilter}
        >
          <Button icon={<DeleteOutlined />} danger disabled={!canBulkDeleteByFilter} loading={deleteByFilterMut.isPending}>
            Xóa cán bộ/user theo bộ lọc
          </Button>
        </Popconfirm>
        <Button disabled={!canBulkDeleteByFilter} onClick={() => setExtendModalOpen(true)}>
          Gia hạn hàng loạt
        </Button>
        <Button onClick={() => setImportModalOpen(true)}>
          Import phân công (Excel)
        </Button>
      </Space>

      <ManageTable<Assignment>
        rowKey="id"
        loading={isLoading}
        dataSource={filteredData}
        columns={columns}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
        size="small"
        cardHeading={(row) => <Typography.Title level={5}>{row.quiz.title}</Typography.Title>}
        cardBadge={(row) => (
          <Badge status={row.status === 'ACTIVE' ? 'success' : row.status === 'DRAFT' ? 'warning' : 'default'}
            text={row.status === 'ACTIVE' ? 'Đang mở' : row.status === 'DRAFT' ? 'Nháp' : 'Đã đóng'} />
        )}
        cardMeta={[
          { label: 'Giao cho', render: tenGiaoCho },
          {
            label: 'Loại',
            render: (row) => row.canBo ? <Tag color="blue">Cán bộ</Tag> : row.user ? <Tag color="cyan">Tài khoản</Tag> : <Tag color="green">Phòng ban</Tag>,
          },
          { label: 'Mở từ', render: (row) => row.startAt ? new Date(row.startAt).toLocaleDateString('vi-VN') : '—' },
          { label: 'Đến', render: (row) => row.endAt ? new Date(row.endAt).toLocaleDateString('vi-VN') : '—' },
        ]}
        cardActions={renderAssignmentActions}
      />

      <Modal
        title={editItem ? 'Sửa phân công' : 'Tạo phân công mới'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={isPending}
        width={560}
        afterOpenChange={(open) => {
          if (!open) return
          if (editItem) {
            form.setFieldsValue({
              quizId: editItem.quiz.id,
              canBoIds: editItem.canBo ? [editItem.canBo.id] : undefined,
              departmentIds: editItem.department ? [editItem.department.id] : undefined,
              status: editItem.status,
              startAt: editItem.startAt ? dayjs(editItem.startAt) : null,
              endAt: editItem.endAt ? dayjs(editItem.endAt) : null,
            })
          }
        }}
        afterClose={() => {
          form.resetFields()
          setEditItem(null)
          setAssignTarget('custom')
          setFilterUnitId(undefined)
          setFilterDeptId(undefined)
        }}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ status: 'ACTIVE' }}>
          <>
            <Form.Item name="quizId" label="Bộ đề" rules={[{ required: true, message: 'Chọn bộ đề' }]}>
              <Select showSearch optionFilterProp="label" placeholder="Chọn bộ đề"
                options={quizzes.map((q) => ({ value: q.id, label: q.title }))} />
            </Form.Item>

            <Divider titlePlacement="left" style={{ marginTop: 4, marginBottom: 12 }}>Giao cho</Divider>

            {/* Lựa chọn kiểu giao */}
            <Radio.Group
              value={assignTarget}
              onChange={e => {
                setAssignTarget(e.target.value)
                setFilterUnitId(undefined)
                setFilterDeptId(undefined)
                form.setFieldValue('canBoIds', undefined)
                form.setFieldValue('departmentIds', undefined)
              }}
              style={{ marginBottom: 12 }}
            >
              <Radio value="all"><TeamOutlined /> Tất cả người dùng</Radio>
              <Radio value="custom">Chọn cá nhân cụ thể</Radio>
              <Radio value="department"><ApartmentOutlined /> Theo phòng ban</Radio>
            </Radio.Group>

            {assignTarget === 'department' && (
              <>
                {/* Chọn chi nhánh rồi multi-select nhiều phòng ban trong chi nhánh đó */}
                <Form.Item label="Chi nhánh" required style={{ marginBottom: 8 }}>
                  <Select
                    placeholder="Chọn chi nhánh"
                    allowClear
                    style={{ width: '100%' }}
                    value={filterUnitId}
                    onChange={val => { setFilterUnitId(val); form.setFieldValue('departmentIds', undefined) }}
                    options={topUnits.map(d => ({ value: d.id, label: d.name }))}
                  />
                </Form.Item>

                <Form.Item
                  name="departmentIds"
                  label={`Chọn phòng ban${subDepts.length ? ` (${subDepts.length} phòng ban)` : ''}`}
                  rules={[{ required: true, message: 'Chọn ít nhất 1 phòng ban' }]}
                >
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    disabled={!filterUnitId}
                    placeholder={filterUnitId ? 'Chọn 1 hoặc nhiều phòng ban...' : 'Chọn chi nhánh trước'}
                    maxTagCount="responsive"
                    options={subDepts.map(d => {
                      const unitName = topUnits.find(u => u.id === filterUnitId)?.name ?? ''
                      const label = unitName && d.name.toLowerCase().startsWith(unitName.toLowerCase())
                        ? d.name.slice(unitName.length).replace(/^\s*[-–]\s*/, '').trim()
                        : d.name
                      return { value: d.id, label }
                    })}
                  />
                </Form.Item>
              </>
            )}

            {assignTarget === 'custom' && (
              <>
                {/* Bộ lọc Chi nhánh → Phòng ban */}
                <Space style={{ marginBottom: 8, width: '100%' }} styles={{ item: { flex: 1 } }}>
                  <Select
                    placeholder="Lọc theo chi nhánh"
                    allowClear
                    style={{ width: '100%' }}
                    value={filterUnitId}
                    onChange={val => { setFilterUnitId(val); setFilterDeptId(undefined); form.setFieldValue('canBoIds', undefined) }}
                    options={topUnits.map(d => ({ value: d.id, label: d.name }))}
                  />
                  <Select
                    placeholder="Lọc theo phòng ban"
                    allowClear
                    style={{ width: '100%' }}
                    value={filterDeptId}
                    disabled={!filterUnitId}
                    onChange={val => { setFilterDeptId(val); form.setFieldValue('canBoIds', undefined) }}
                    options={subDepts.map(d => {
                      const unitName = topUnits.find(u => u.id === filterUnitId)?.name ?? ''
                      const label = unitName && d.name.toLowerCase().startsWith(unitName.toLowerCase())
                        ? d.name.slice(unitName.length).replace(/^\s*[-–]\s*/, '').trim()
                        : d.name
                      return { value: d.id, label }
                    })}
                  />
                </Space>

                {/* Multi-select cán bộ */}
                <Form.Item
                  name="canBoIds"
                  label={`Chọn cán bộ${filteredCanBo.length ? ` (${filteredCanBo.length} người)` : ''}`}
                  rules={[{ required: true, message: 'Chọn ít nhất 1 cán bộ' }]}
                >
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    placeholder="Tìm và chọn cán bộ..."
                    maxTagCount="responsive"
                    options={filteredCanBo.map(c => ({
                      value: c.id,
                      label: `${c.fullName}${c.cbCode ? ` (${c.cbCode})` : ''}`,
                    }))}
                  />
                </Form.Item>
              </>
            )}
          </>

          <Form.Item name="status" label="Trạng thái" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="DRAFT">Nháp</Radio>
              <Radio value="ACTIVE">Đang mở</Radio>
              <Radio value="CLOSED">Đã đóng</Radio>
            </Radio.Group>
          </Form.Item>
          <Space size={16}>
            <Form.Item name="startAt" label="Mở từ">
              <DatePicker showTime format="DD/MM/YYYY HH:mm" placeholder="Không giới hạn" />
            </Form.Item>
            <Form.Item name="endAt" label="Đến">
              <DatePicker showTime format="DD/MM/YYYY HH:mm" placeholder="Không giới hạn" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        title="Gia hạn hàng loạt"
        open={extendModalOpen}
        onCancel={() => { setExtendModalOpen(false); extendForm.resetFields() }}
        onOk={() => extendForm.submit()}
        confirmLoading={extendMut.isPending}
      >
        <Typography.Paragraph type="secondary">
          Đổi hạn nộp bài (đến) cho các phân công đang khớp bộ lọc phía trên ({bulkDeleteScopeText()}).
        </Typography.Paragraph>
        <Form form={extendForm} layout="vertical" onFinish={(v) => extendMut.mutate(v.newEndAt.toISOString())}>
          <Form.Item name="newEndAt" label="Hạn mới" rules={[{ required: true, message: 'Chọn hạn nộp bài mới' }]}>
            <DatePicker showTime format="DD/MM/YYYY HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Import phân công (Excel)"
        open={importModalOpen}
        onCancel={() => { setImportModalOpen(false); importForm.resetFields(); setImportFile(null) }}
        onOk={() => importForm.submit()}
        confirmLoading={importMut.isPending}
      >
        <Typography.Paragraph type="secondary">
          File chỉ cần 1 cột — mã cán bộ, User AD hoặc username, mỗi dòng 1 người. Bộ đề và thời gian chọn chung cho cả danh sách.
        </Typography.Paragraph>
        <Form
          form={importForm}
          layout="vertical"
          onFinish={(v) => {
            if (!importFile) { message.error('Chưa chọn file'); return }
            importMut.mutate(v)
          }}
        >
          <Form.Item name="quizId" label="Bộ đề" rules={[{ required: true, message: 'Chọn bộ đề' }]}>
            <Select
              options={quizzes.map((q) => ({ value: q.id, label: q.title }))}
              showSearch
              filterOption={(input, opt) => vn(opt?.label ?? '').includes(vn(input))}
            />
          </Form.Item>
          <Form.Item name="range" label="Thời gian (tuỳ chọn)">
            <DatePicker.RangePicker showTime format="DD/MM/YYYY HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="File Excel" required>
            <Upload
              accept=".xlsx,.xls,.csv"
              maxCount={1}
              beforeUpload={(file) => { setImportFile(file); return false }}
              onRemove={() => setImportFile(null)}
              fileList={importFile ? [{ uid: '1', name: importFile.name, status: 'done' as const }] : []}
            >
              <Button icon={<UploadOutlined />}>Chọn file</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
