import { useState } from 'react'
import {
  Button, Space, Tag, Modal, Form, Input, Select,
  Popconfirm, Tooltip, Typography, message,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ApartmentOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ManageTable from '../components/ManageTable'
import api, { getErrorMessage } from '../lib/api'

interface Department {
  id: string
  name: string
  code: string
  parentId: string | null
  parent?: { id: string; name: string; code: string } | null
  _count?: { children: number; canBo: number }
}

/** Dữ liệu gửi lên khi tạo/cập nhật — parentId luôn gửi tường minh (null = Chi nhánh gốc) */
interface DepartmentFormValues {
  name: string
  code: string
  parentId: string | null
}

export default function BranchesPage() {
  const qc = useQueryClient()
  const [form] = Form.useForm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [filterUnitId, setFilterUnitId] = useState<string | undefined>(undefined)

  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: (body: DepartmentFormValues) => api.post('/admin/departments', body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); closeModal(); message.success('Đã thêm') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi thêm')),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & DepartmentFormValues) => api.put(`/admin/departments/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); closeModal(); message.success('Đã cập nhật') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi cập nhật')),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/departments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); message.success('Đã xóa') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Không thể xóa — đơn vị này đang có phòng ban hoặc cán bộ trực thuộc')),
  })

  // Chi nhánh gốc (không có parentId) — dùng cho Select lọc và Select "Chi nhánh cha" trong form
  const topUnits = [...departments]
    .filter((d) => !d.parentId)
    .sort((a, b) => a.code.localeCompare(b.code))

  // Gộp thành danh sách phẳng nhưng nhóm theo chi nhánh: chi nhánh trước, phòng ban trực thuộc theo sau
  const groupedRows = topUnits.flatMap((unit) => [
    unit,
    ...departments
      .filter((d) => d.parentId === unit.id)
      .sort((a, b) => a.code.localeCompare(b.code)),
  ])
  const visibleRows = filterUnitId
    ? groupedRows.filter((d) => d.id === filterUnitId || d.parentId === filterUnitId)
    : groupedRows

  function openCreate() {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  function openEdit(row: Department) {
    setEditing(row)
    form.setFieldsValue({ name: row.name, code: row.code, parentId: row.parentId ?? undefined })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
    form.resetFields()
  }

  function onFinish(values: { name: string; code: string; parentId?: string }) {
    const payload: DepartmentFormValues = { name: values.name, code: values.code, parentId: values.parentId ?? null }
    if (editing) {
      updateMut.mutate({ id: editing.id, ...payload })
    } else {
      createMut.mutate(payload)
    }
  }

  // Đơn vị đang là chi nhánh cha của phòng ban khác thì khoá field "Chi nhánh cha" khi sửa —
  // tránh biến 1 chi nhánh đang có phòng ban con thành phòng ban trực thuộc, gây rối cấu trúc 2 cấp.
  const editingIsLockedBranch = !!editing && (editing._count?.children ?? 0) > 0

  const renderActions = (row: Department) => {
    const hasChildren = (row._count?.children ?? 0) > 0
    const hasCanBo = (row._count?.canBo ?? 0) > 0
    const blocked = hasChildren || hasCanBo
    const deleteBtn = (
      <Popconfirm title="Xóa đơn vị này?" onConfirm={() => deleteMut.mutate(row.id)} disabled={blocked}>
        <Button size="small" danger icon={<DeleteOutlined />} disabled={blocked} />
      </Popconfirm>
    )
    return (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>Sửa</Button>
        {blocked ? (
          <Tooltip title="Còn phòng ban con hoặc cán bộ trực thuộc — không thể xóa">{deleteBtn}</Tooltip>
        ) : deleteBtn}
      </Space>
    )
  }

  const columns = [
    { title: 'Mã', dataIndex: 'code', width: 120 },
    {
      title: 'Tên',
      dataIndex: 'name',
      render: (v: string, row: Department) => (
        <span style={{ paddingLeft: row.parentId ? 20 : 0, fontWeight: row.parentId ? 400 : 600 }}>
          {row.parentId && <span style={{ color: '#bbb' }}>└ </span>}
          {v}
        </span>
      ),
    },
    {
      title: 'Chi nhánh cha',
      width: 180,
      render: (_: unknown, row: Department) =>
        row.parentId ? (row.parent?.name ?? '—') : <Tag color="blue" icon={<ApartmentOutlined />}>Chi nhánh</Tag>,
    },
    {
      title: 'Số phòng ban',
      width: 110,
      render: (_: unknown, row: Department) => (row.parentId ? '—' : row._count?.children ?? 0),
    },
    { title: 'Số cán bộ', width: 100, render: (_: unknown, row: Department) => row._count?.canBo ?? 0 },
    { title: 'Thao tác', width: 180, render: (_: unknown, row: Department) => renderActions(row) },
  ]

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Quản lý Chi nhánh/Phòng ban</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm chi nhánh/phòng ban</Button>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 240 }}
          placeholder="Tất cả chi nhánh"
          allowClear
          showSearch
          optionFilterProp="children"
          value={filterUnitId}
          onChange={setFilterUnitId}
        >
          {topUnits.map((u) => (
            <Select.Option key={u.id} value={u.id}>{u.name}</Select.Option>
          ))}
        </Select>
      </Space>

      <ManageTable<Department>
        rowKey="id"
        loading={isLoading}
        dataSource={visibleRows}
        columns={columns}
        pagination={false}
        cardHeading={(row) => (
          <Space>
            <Typography.Title level={5} style={{ margin: 0 }}>{row.name}</Typography.Title>
            {!row.parentId && <Tag color="blue" icon={<ApartmentOutlined />}>Chi nhánh</Tag>}
          </Space>
        )}
        cardMeta={[
          { label: 'Mã', render: (row) => row.code },
          { label: 'Chi nhánh cha', render: (row) => row.parentId ? (row.parent?.name ?? '—') : '—' },
          { label: 'Số phòng ban', render: (row) => row.parentId ? '—' : row._count?.children ?? 0 },
          { label: 'Số cán bộ', render: (row) => row._count?.canBo ?? 0 },
        ]}
        cardActions={renderActions}
      />

      <Modal
        title={editing ? 'Chỉnh sửa đơn vị' : 'Thêm chi nhánh/phòng ban mới'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="parentId"
            label="Chi nhánh cha"
            extra={editingIsLockedBranch
              ? 'Đơn vị đang có phòng ban trực thuộc nên không thể chuyển thành phòng ban con'
              : 'Để trống nếu đây là Chi nhánh mới (không trực thuộc đơn vị nào)'}
          >
            <Select
              placeholder="Để trống nếu đây là Chi nhánh mới"
              allowClear
              showSearch
              optionFilterProp="children"
              disabled={editingIsLockedBranch}
            >
              {topUnits.filter((u) => u.id !== editing?.id).map((u) => (
                <Select.Option key={u.id} value={u.id}>{u.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="Mã" name="code" rules={[{ required: true, message: 'Nhập mã' }]}>
            <Input placeholder="VD: 01-HS" />
          </Form.Item>
          <Form.Item label="Tên" name="name" rules={[{ required: true, message: 'Nhập tên' }]}>
            <Input placeholder="VD: Chi nhánh Hòa Sơn" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
