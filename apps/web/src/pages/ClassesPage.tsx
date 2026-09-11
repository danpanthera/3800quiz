import { useState } from 'react'
import {
  Button, Table, Space, Modal, Form, Input, Select, Popconfirm,
  Typography, message, Drawer, Tag, Tooltip, Descriptions, Divider, Empty,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  TeamOutlined, UserAddOutlined, UserDeleteOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ManageTable from '../components/ManageTable'
import api, { getErrorMessage } from '../lib/api'

interface AcademicYear { id: string; name: string }
interface User { id: string; fullName: string; username: string; email?: string; department?: { name: string } }
interface ClassItem {
  id: string; name: string; code: string; description?: string
  academicYearId?: string; academicYear?: { name: string }
  _count?: { members: number; examSessions: number }
}
// Dữ liệu form tạo/sửa lớp học — bỏ các field server tự sinh (id, academicYear object, _count)
type ClassFormValues = Omit<ClassItem, 'id' | 'academicYear' | '_count'>
interface ClassDetail extends ClassItem {
  members: { id: string; joinedAt: string; user: User }[]
  examSessions: { id: string; name: string; status: string; quiz: { title: string } }[]
}
// 1 dòng trong bảng thành viên của lớp (drawer chi tiết)
type ClassMemberRow = ClassDetail['members'][number]

export default function ClassesPage() {
  const qc = useQueryClient()
  const [form] = Form.useForm()
  const [filterYear, setFilterYear] = useState<string | undefined>()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ClassItem | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])

  const { data: years = [] } = useQuery<AcademicYear[]>({
    queryKey: ['academic-years'],
    queryFn: () => api.get('/admin/academic-years').then((r) => r.data),
  })

  const { data: classes = [], isLoading } = useQuery<ClassItem[]>({
    queryKey: ['classes', filterYear],
    queryFn: () => api.get('/admin/classes', { params: filterYear ? { academicYearId: filterYear } : {} }).then((r) => r.data),
  })

  const { data: detail } = useQuery<ClassDetail>({
    queryKey: ['classes', detailId, 'detail'],
    queryFn: () => api.get(`/admin/classes/${detailId}`).then((r) => r.data),
    enabled: !!detailId,
  })

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users').then((r) => r.data),
    enabled: addMemberOpen,
  })

  const createMut = useMutation({
    mutationFn: (body: ClassFormValues) => api.post('/admin/classes', body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['classes'] }); closeModal(); message.success('Đã tạo lớp học') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi tạo lớp')),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & ClassFormValues) => api.put(`/admin/classes/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['classes'] }); closeModal(); message.success('Đã cập nhật') },
    onError: () => message.error('Lỗi khi cập nhật'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/classes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['classes'] }); message.success('Đã xóa') },
    onError: () => message.error('Không thể xóa — lớp đang có dữ liệu'),
  })

  const addMembersMut = useMutation({
    mutationFn: ({ classId, userIds }: { classId: string; userIds: string[] }) =>
      api.post(`/admin/classes/${classId}/members/bulk`, { userIds }).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['classes', detailId, 'detail'] })
      qc.invalidateQueries({ queryKey: ['classes'] })
      message.success(`Đã thêm ${data.added} học viên${data.skipped ? ` (${data.skipped} đã có)` : ''}`)
      setAddMemberOpen(false)
      setSelectedUsers([])
    },
    onError: () => message.error('Lỗi khi thêm học viên'),
  })

  const removeMemberMut = useMutation({
    mutationFn: ({ classId, userId }: { classId: string; userId: string }) =>
      api.delete(`/admin/classes/${classId}/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes', detailId, 'detail'] })
      qc.invalidateQueries({ queryKey: ['classes'] })
      message.success('Đã xóa học viên khỏi lớp')
    },
  })

  function openCreate() { setEditing(null); form.resetFields(); setModalOpen(true) }
  function openEdit(row: ClassItem) {
    setEditing(row)
    form.setFieldsValue({ name: row.name, code: row.code, description: row.description, academicYearId: row.academicYearId })
    setModalOpen(true)
  }
  function closeModal() { setModalOpen(false); setEditing(null); form.resetFields() }

  function onFinish(values: ClassFormValues) {
    if (editing) updateMut.mutate({ id: editing.id, ...values })
    else createMut.mutate(values)
  }

  // Users chưa có trong lớp
  const existingMemberIds = new Set(detail?.members.map((m) => m.user.id) ?? [])
  const availableUsers = allUsers.filter((u) => !existingMemberIds.has(u.id))

  const renderClassActions = (row: ClassItem) => (
    <Space>
      <Tooltip title="Xem chi tiết / quản lý thành viên">
        <Button size="small" icon={<TeamOutlined />} onClick={() => setDetailId(row.id)} />
      </Tooltip>
      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>Sửa</Button>
      <Popconfirm title="Xóa lớp học?" onConfirm={() => deleteMut.mutate(row.id)}>
        <Button size="small" danger icon={<DeleteOutlined />} />
      </Popconfirm>
    </Space>
  )

  const columns = [
    {
      title: 'Tên lớp',
      dataIndex: 'name',
      render: (v: string, row: ClassItem) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => setDetailId(row.id)}>{v}</Button>
      ),
    },
    { title: 'Mã lớp', dataIndex: 'code', width: 110, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Năm học', dataIndex: ['academicYear', 'name'], width: 150, render: (v: string) => v ?? '—' },
    { title: 'Học viên', dataIndex: ['_count', 'members'], width: 90, render: (v: number) => v ?? 0 },
    { title: 'Đợt thi', dataIndex: ['_count', 'examSessions'], width: 80, render: (v: number) => v ?? 0 },
    {
      title: 'Thao tác', width: 160,
      render: (_: unknown, row: ClassItem) => renderClassActions(row),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Quản lý Lớp học</Typography.Title>
        <Space>
          <Select
            allowClear
            placeholder="Lọc theo năm học"
            style={{ width: 180 }}
            value={filterYear}
            onChange={setFilterYear}
            options={years.map((y) => ({ value: y.id, label: y.name }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm lớp</Button>
        </Space>
      </div>

      <ManageTable<ClassItem>
        rowKey="id"
        loading={isLoading}
        dataSource={classes}
        columns={columns}
        cardHeading={(row) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => setDetailId(row.id)}>{row.name}</Button>
        )}
        cardMeta={[
          { label: 'Mã lớp', render: (row) => <Tag>{row.code}</Tag> },
          { label: 'Năm học', render: (row) => row.academicYear?.name ?? '—' },
          { label: 'Học viên', render: (row) => row._count?.members ?? 0 },
          { label: 'Đợt thi', render: (row) => row._count?.examSessions ?? 0 },
        ]}
        cardActions={renderClassActions}
      />

      {/* Modal tạo/sửa lớp */}
      <Modal
        title={editing ? 'Chỉnh sửa lớp học' : 'Tạo lớp học mới'}
        open={modalOpen} onCancel={closeModal} onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending} destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item label="Tên lớp" name="name" rules={[{ required: true }]}>
            <Input placeholder="vd: Lớp nghiệp vụ tín dụng K1" />
          </Form.Item>
          <Form.Item label="Mã lớp" name="code" rules={[{ required: true }]}>
            <Input placeholder="vd: NVTD-K1-2026" />
          </Form.Item>
          <Form.Item label="Năm học" name="academicYearId">
            <Select allowClear placeholder="Chọn năm học" options={years.map((y) => ({ value: y.id, label: y.name }))} />
          </Form.Item>
          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Drawer chi tiết lớp */}
      <Drawer
        title={detail ? `Lớp: ${detail.name}` : 'Chi tiết lớp'}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        size="large"
        extra={
          <Button icon={<UserAddOutlined />} type="primary" onClick={() => setAddMemberOpen(true)}>
            Thêm học viên
          </Button>
        }
      >
        {detail && (
          <>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Mã lớp"><Tag>{detail.code}</Tag></Descriptions.Item>
              <Descriptions.Item label="Năm học">{detail.academicYear?.name ?? '—'}</Descriptions.Item>
              {detail.description && <Descriptions.Item label="Mô tả" span={2}>{detail.description}</Descriptions.Item>}
            </Descriptions>

            <Divider titlePlacement="left">Học viên ({detail.members.length})</Divider>
            {detail.members.length === 0 ? (
              <Empty description="Chưa có học viên" />
            ) : (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 'max-content' }}
                dataSource={detail.members}
                columns={[
                  { title: 'Họ tên', dataIndex: ['user', 'fullName'] },
                  { title: 'Username', dataIndex: ['user', 'username'], width: 120 },
                  { title: 'Phòng ban', dataIndex: ['user', 'department', 'name'], width: 140, render: (v) => v ?? '—' },
                  {
                    title: '', width: 50,
                    render: (_: unknown, row: ClassMemberRow) => (
                      <Popconfirm title="Xóa học viên khỏi lớp?" onConfirm={() => removeMemberMut.mutate({ classId: detailId!, userId: row.user.id })}>
                        <Button size="small" danger icon={<UserDeleteOutlined />} />
                      </Popconfirm>
                    ),
                  },
                ]}
              />
            )}

            <Divider titlePlacement="left">Đợt thi ({detail.examSessions.length})</Divider>
            {detail.examSessions.length === 0 ? (
              <Empty description="Chưa có đợt thi" />
            ) : (
              <Table
                rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }}
                dataSource={detail.examSessions}
                columns={[
                  { title: 'Tên đợt thi', dataIndex: 'name' },
                  { title: 'Bộ đề', dataIndex: ['quiz', 'title'] },
                  {
                    title: 'Trạng thái', dataIndex: 'status', width: 100,
                    render: (v: string) => {
                      const color = v === 'OPEN' ? 'green' : v === 'DRAFT' ? 'default' : 'red'
                      const label = v === 'OPEN' ? 'Đang mở' : v === 'DRAFT' ? 'Nháp' : 'Đã đóng'
                      return <Tag color={color}>{label}</Tag>
                    },
                  },
                ]}
              />
            )}
          </>
        )}
      </Drawer>

      {/* Modal thêm học viên */}
      <Modal
        title="Thêm học viên vào lớp"
        open={addMemberOpen}
        onCancel={() => { setAddMemberOpen(false); setSelectedUsers([]) }}
        onOk={() => addMembersMut.mutate({ classId: detailId!, userIds: selectedUsers })}
        confirmLoading={addMembersMut.isPending}
        okButtonProps={{ disabled: selectedUsers.length === 0 }}
        okText={`Thêm ${selectedUsers.length > 0 ? selectedUsers.length + ' học viên' : ''}`}
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="Tìm và chọn học viên"
          value={selectedUsers}
          onChange={setSelectedUsers}
          optionFilterProp="label"
          options={availableUsers.map((u) => ({
            value: u.id,
            label: `${u.fullName} (${u.username})`,
          }))}
        />
      </Modal>
    </div>
  )
}
