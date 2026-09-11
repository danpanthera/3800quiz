import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button, Modal, Form, Input, InputNumber, Space,
  Popconfirm, Tag, Typography, App,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, TrophyOutlined } from '@ant-design/icons'
import ManageTable from '../components/ManageTable'
import api from '../lib/api'
import type { Color } from 'antd/es/color-picker'

const { Title } = Typography

type LevelDef = {
  id: string
  level: number
  name: string
  minXp: number
  color: string
  iconSlug?: string
}

export default function LevelsPage() {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [form] = Form.useForm()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const levelsQ = useQuery<LevelDef[]>({
    queryKey: ['levels'],
    queryFn: () => api.get('/admin/levels').then((r) => r.data),
  })

  const saveMut = useMutation({
    mutationFn: async (values: Omit<LevelDef, 'id'>) => {
      const payload = { ...values, color: typeof values.color === 'string' ? values.color : (values.color as unknown as Color).toHexString() }
      if (editingId) {
        return api.put(`/admin/levels/${editingId}`, payload)
      }
      return api.post('/admin/levels', payload)
    },
    onSuccess: () => {
      message.success(editingId ? 'Đã cập nhật cấp độ' : 'Đã thêm cấp độ')
      qc.invalidateQueries({ queryKey: ['levels'] })
      setModalOpen(false)
      form.resetFields()
      setEditingId(null)
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      message.error(e.response?.data?.message ?? 'Lỗi lưu cấp độ')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/levels/${id}`),
    onSuccess: () => {
      message.success('Đã xóa cấp độ')
      qc.invalidateQueries({ queryKey: ['levels'] })
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      message.error(e.response?.data?.message ?? 'Không thể xóa cấp độ này')
    },
  })

  function openCreate() {
    form.resetFields()
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(record: LevelDef) {
    form.setFieldsValue(record)
    setEditingId(record.id)
    setModalOpen(true)
  }

  const renderLevelActions = (record: LevelDef) => (
    <Space>
      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
      <Popconfirm
        title="Xóa cấp độ này?"
        description="Chú ý: không thể xóa nếu có người dùng đang ở cấp này."
        onConfirm={() => deleteMut.mutate(record.id)}
        okText="Xóa"
        cancelText="Hủy"
        okButtonProps={{ danger: true }}
      >
        <Button size="small" danger icon={<DeleteOutlined />} />
      </Popconfirm>
    </Space>
  )

  const columns = [
    {
      title: 'Cấp',
      dataIndex: 'level',
      width: 70,
      render: (n: number) => <Tag color="blue">Cấp {n}</Tag>,
    },
    {
      title: 'Tên cấp độ',
      dataIndex: 'name',
      render: (name: string, rec: LevelDef) => (
        <Space>
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: rec.color,
            }}
          />
          <strong>{name}</strong>
        </Space>
      ),
    },
    {
      title: 'Điểm tối thiểu',
      dataIndex: 'minXp',
      render: (n: number) => <Tag color="gold">⭐ {n.toLocaleString()} XP</Tag>,
    },
    {
      title: 'Màu',
      dataIndex: 'color',
      render: (c: string) => (
        <Space>
          <span
            style={{
              display: 'inline-block',
              width: 20,
              height: 20,
              borderRadius: 4,
              background: c,
              border: '1px solid #eee',
            }}
          />
          <code style={{ fontSize: 12 }}>{c}</code>
        </Space>
      ),
    },
    {
      title: 'Hành động',
      width: 120,
      render: (_: unknown, record: LevelDef) => renderLevelActions(record),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          <TrophyOutlined style={{ marginRight: 8, color: '#faad14' }} />
          Quản lý cấp độ
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Thêm cấp
        </Button>
      </div>

      <ManageTable<LevelDef>
        dataSource={levelsQ.data ?? []}
        columns={columns}
        rowKey="id"
        loading={levelsQ.isLoading}
        pagination={false}
        size="middle"
        cardHeading={(rec) => (
          <>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: rec.color,
                marginRight: 8,
              }}
            />
            <Typography.Title level={5} style={{ display: 'inline' }}>{rec.name}</Typography.Title>
          </>
        )}
        cardBadge={(rec) => <Tag color="blue">Cấp {rec.level}</Tag>}
        cardMeta={[
          { label: 'Điểm tối thiểu', render: (rec) => <Tag color="gold">⭐ {rec.minXp.toLocaleString()} XP</Tag> },
          {
            label: 'Màu',
            render: (rec) => (
              <Space>
                <span
                  style={{
                    display: 'inline-block',
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: rec.color,
                    border: '1px solid #eee',
                  }}
                />
                <code style={{ fontSize: 12 }}>{rec.color}</code>
              </Space>
            ),
          },
        ]}
        cardActions={renderLevelActions}
      />

      <Modal
        title={editingId ? 'Sửa cấp độ' : 'Thêm cấp độ mới'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); setEditingId(null) }}
        onOk={() => form.submit()}
        confirmLoading={saveMut.isPending}
        okText="Lưu"
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
          <Form.Item name="level" label="Số cấp" rules={[{ required: true, message: 'Nhập số cấp' }]}>
            <InputNumber min={1} max={99} style={{ width: '100%' }} disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="name" label="Tên cấp độ" rules={[{ required: true, message: 'Nhập tên' }]}>
            <Input placeholder="VD: Chuyên viên" />
          </Form.Item>
          <Form.Item name="minXp" label="XP tối thiểu" rules={[{ required: true, message: 'Nhập XP' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="color" label="Màu (hex)" rules={[{ required: true, message: 'Chọn màu' }]}>
            <Input placeholder="#4CAF50" />
          </Form.Item>
          <Form.Item name="iconSlug" label="Icon slug (tùy chọn)">
            <Input placeholder="VD: level_5" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
