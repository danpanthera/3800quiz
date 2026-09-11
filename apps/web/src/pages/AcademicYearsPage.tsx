import { useState } from 'react'
import {
  Button, Space, Tag, Modal, Form, InputNumber,
  Popconfirm, Typography, message,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ManageTable from '../components/ManageTable'
import api from '../lib/api'

interface AcademicYear {
  id: string
  name: string
  startYear: number
  endYear: number
  isActive: boolean
  createdAt: string
  _count?: { classes: number }
}

/** Dữ liệu gửi lên khi tạo/cập nhật năm học (bỏ field server tự sinh) */
type AcademicYearFormValues = Omit<AcademicYear, 'id' | 'createdAt' | '_count' | 'isActive'>

/** Giá trị Form nhập năm học (chỉ có 1 trường "year") */
interface AcademicYearFormInput {
  year: number
}

export default function AcademicYearsPage() {
  const qc = useQueryClient()
  const [form] = Form.useForm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AcademicYear | null>(null)

  const { data: years = [], isLoading } = useQuery<AcademicYear[]>({
    queryKey: ['academic-years'],
    queryFn: () => api.get('/admin/academic-years').then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: (body: AcademicYearFormValues) => api.post('/admin/academic-years', body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academic-years'] }); closeModal(); message.success('Đã tạo năm học') },
    onError: () => message.error('Lỗi khi tạo năm học'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & AcademicYearFormValues) => api.put(`/admin/academic-years/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academic-years'] }); closeModal(); message.success('Đã cập nhật') },
    onError: () => message.error('Lỗi khi cập nhật'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/academic-years/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academic-years'] }); message.success('Đã xóa') },
    onError: () => message.error('Không thể xóa — có lớp học đang dùng năm này'),
  })

  const setActiveMut = useMutation({
    mutationFn: (id: string) => api.put(`/admin/academic-years/${id}`, { isActive: true }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academic-years'] }); message.success('Đã đặt làm năm học hiện tại') },
  })

  function openCreate() {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  function openEdit(row: AcademicYear) {
    setEditing(row)
    form.setFieldsValue({ year: row.startYear })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
    form.resetFields()
  }

  function onFinish(values: AcademicYearFormInput) {
    const { year, ...rest } = values
    const payload = { ...rest, startYear: year, endYear: year, name: `Năm ${year}` }
    if (editing) {
      updateMut.mutate({ id: editing.id, ...payload })
    } else {
      createMut.mutate(payload)
    }
  }

  const renderAcademicYearActions = (row: AcademicYear) => (
    <Space>
      {!row.isActive && (
        <Popconfirm title="Đặt làm năm học hiện tại?" onConfirm={() => setActiveMut.mutate(row.id)}>
          <Button size="small" type="link">Đặt active</Button>
        </Popconfirm>
      )}
      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>Sửa</Button>
      <Popconfirm title="Xóa năm học này?" onConfirm={() => deleteMut.mutate(row.id)}>
        <Button size="small" danger icon={<DeleteOutlined />} />
      </Popconfirm>
    </Space>
  )

  const columns = [
    {
      title: 'Tên năm học',
      dataIndex: 'name',
      render: (v: string, row: AcademicYear) => (
        <Space>
          <span>{v}</span>
          {row.isActive && <Tag color="green" icon={<CheckCircleOutlined />}>Đang hoạt động</Tag>}
        </Space>
      ),
    },
    { title: 'Năm bắt đầu', dataIndex: 'startYear', width: 120 },
    { title: 'Năm kết thúc', dataIndex: 'endYear', width: 120 },
    { title: 'Số lớp', dataIndex: ['_count', 'classes'], width: 90, render: (v: number) => v ?? 0 },
    {
      title: 'Thao tác',
      width: 200,
      render: (_: unknown, row: AcademicYear) => renderAcademicYearActions(row),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Quản lý Năm học</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm năm học</Button>
      </div>

      <ManageTable<AcademicYear>
        rowKey="id"
        loading={isLoading}
        dataSource={years}
        columns={columns}
        pagination={false}
        cardHeading={(row) => (
          <>
            <Typography.Title level={5}>{row.name}</Typography.Title>
            {row.isActive && <Tag color="green" icon={<CheckCircleOutlined />}>Đang hoạt động</Tag>}
          </>
        )}
        cardMeta={[
          { label: 'Năm bắt đầu', render: (row) => row.startYear },
          { label: 'Năm kết thúc', render: (row) => row.endYear },
          { label: 'Số lớp', render: (row) => row._count?.classes ?? 0 },
        ]}
        cardActions={renderAcademicYearActions}
      />

      <Modal
        title={editing ? 'Chỉnh sửa năm học' : 'Thêm năm học mới'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            label="Năm học"
            name="year"
            rules={[{ required: true, message: 'Nhập năm học' }]}
            extra="Mặc định: 01/01 → 31/12 của năm đó"
          >
            <InputNumber style={{ width: '100%' }} min={2020} max={2100} placeholder={`${new Date().getFullYear()}`} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
