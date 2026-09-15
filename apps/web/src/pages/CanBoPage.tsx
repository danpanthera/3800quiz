import { useState } from 'react'
import React from 'react'
import {
  App, Button, Table, Space, Modal, Form, Input, Select, Popconfirm,
  Typography, Switch, DatePicker, Tag, Row, Col, Divider, Upload, Alert,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, IdcardOutlined, LockOutlined, UploadOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import ManageTable from '../components/ManageTable'
import api, { getErrorMessage } from '../lib/api'

interface Department { id: string; name: string; code: string; parentId?: string | null; parent?: { id: string; name: string; code: string } | null; _count?: { children: number; canBo: number } }

// Thứ tự đơn vị cố định theo code 01-HS → 07-LTT
const UNIT_ORDER = ['01-HS','02-LT','03-QN','04-QT','05-LTK','06-THD','07-LTT']
function unitRank(code?: string | null): number {
  if (!code) return 99
  const idx = UNIT_ORDER.indexOf(code)
  return idx === -1 ? 98 : idx
}

// Thứ tự ưu tiên phòng ban: BGD > KHDN > KHCN > KH > KTNQ > PGD > KTGSNB > TH > KHRR
function deptPriority(name: string, code: string): number {
  const n = name.toLowerCase(); const c = code.toLowerCase()
  if (n.includes('ban giám đốc') || c.includes('bgd')) return 1
  if (n.includes('khdn') || n.includes('doanh nghiệp')) return 2
  if (n.includes('khcn') || n.includes('cá nhân')) return 3
  if (n.includes('khách hàng')) return 4
  if (n.includes('ktnq') || n.includes('kế toán') || n.includes('ngân quỹ')) return 5
  if (n.includes('giao dịch') || c.includes('pgd')) return 6
  if (n.includes('ktgsnb') || n.includes('kiểm tra') || n.includes('giám sát')) return 7
  if (n.includes('tổng hợp') || c.includes('th')) return 8
  if (n.includes('khrr') || n.includes('rủi ro') || n.includes('qlrr')) return 9
  return 10
}

// Thứ tự ưu tiên chức vụ: GĐ > PGĐ > TP > PP > NV
function positionRank(pos?: string | null): number {
  if (!pos) return 9
  const p = pos.toLowerCase()
  if (p.includes('giám đốc') && !p.includes('phó')) return 1
  if (p.includes('phó giám đốc') || p.includes('pgđ')) return 2
  if (p.includes('trưởng')) return 3
  if (p.includes('phó')) return 4
  if (p.includes('nhân viên')) return 5
  return 6
}
interface CanBoItem {
  id: string; cbCode: string; fullName: string; username?: string;
  email?: string; phoneNumber?: string; userAD?: string; userIPCAS?: string;
  maCbtd?: string; cccd?: string; ngayCapCmt?: string; noiCapCmt?: string;
  ngaySinh?: string; gioiTinh?: string; departmentId?: string;
  department?: { id: string; name: string; code: string; parent?: { id: string; name: string; code: string } | null };
  position?: string; isPartyMember: boolean; isUnionMember: boolean;
  isYouthUnionMember: boolean; isItStaff: boolean; isActive: boolean;
}
// Dữ liệu form thêm/sửa cán bộ — bỏ các field server tự sinh (id, username, department object)
type CanBoFormValues = Omit<CanBoItem, 'id' | 'username' | 'department'>

export default function CanBoPage() {
  const qc = useQueryClient()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CanBoItem | null>(null)
  const [formUnitId, setFormUnitId] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [filterUnitId, setFilterUnitId] = useState<string | undefined>()
  const [filterDeptId, setFilterDeptId] = useState<string | undefined>()
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [pageSize, setPageSize] = useState(50)
  const [resetResultOpen, setResetResultOpen] = useState(false)
  const [resetResult, setResetResult] = useState<{ reset: number; noAccount: number; details: { fullName: string; cbCode: string; ok: boolean }[] } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importResult, setImportResult] = useState<{
    created: number; updated: number; skipped: number; errors: string[];
    rows: { empno: string; fullName: string; branchCode?: string; branchName?: string; deptName?: string; position?: string; userAD?: string; action: 'created' | 'updated' | 'skipped' | 'error'; note?: string }[];
  } | null>(null)

  const { data: canBoList = [], isLoading } = useQuery<CanBoItem[]>({
    queryKey: ['can-bo', search, filterUnitId, filterDeptId],
    queryFn: () => api.get('/admin/can-bo', {
      params: {
        ...(search ? { search } : {}),
        ...(filterDeptId ? { departmentId: filterDeptId } : filterUnitId ? { unitId: filterUnitId } : {}),
      }
    }).then(r => r.data),
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (body: CanBoFormValues) => api.post('/admin/can-bo', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['can-bo'] }); closeModal(); message.success('Đã thêm cán bộ') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi thêm')),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & CanBoFormValues) => api.put(`/admin/can-bo/${id}`, body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['can-bo'] }); closeModal(); message.success('Đã cập nhật') },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi cập nhật')),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/can-bo/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['can-bo'] }); message.success('Đã xóa') },
    onError: () => message.error('Không thể xóa'),
  })

  const resetMut = useMutation({
    mutationFn: (ids: string[]) => api.post('/admin/can-bo/reset-passwords', { ids }).then(r => r.data),
    onSuccess: (data) => {
      setSelectedRowKeys([])
      setResetResult(data)
      setResetResultOpen(true)
    },
    onError: () => message.error('Lỗi khi reset mật khẩu'),
  })

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => api.delete('/admin/can-bo/bulk', { data: { ids } }).then(r => r.data),
    onSuccess: (data: { deleted: number }) => {
      qc.invalidateQueries({ queryKey: ['can-bo'] })
      setSelectedRowKeys([])
      message.success(`Đã xóa ${data.deleted} cán bộ`)
    },
    onError: () => message.error('Lỗi khi xóa cán bộ'),
  })

  const importMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post('/admin/can-bo/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['can-bo'] })
      qc.invalidateQueries({ queryKey: ['departments'] })
      setImportResult(data)
    },
    onError: (e: unknown) => message.error(getErrorMessage(e, 'Lỗi khi import file')),
  })

  function openAdd() {
    setEditing(null)
    setFormUnitId(undefined)
    form.resetFields()
    form.setFieldsValue({ isActive: true })
    setModalOpen(true)
  }

  function openEdit(record: CanBoItem) {
    setEditing(record)
    // Xác định chi nhánh và phòng ban từ department hiện tại
    const hasParent = !!record.department?.parent
    const branchId = hasParent ? record.department!.parent!.id : record.departmentId
    const deptId = hasParent ? record.departmentId : undefined
    setFormUnitId(branchId)
    form.setFieldsValue({
      cbCode: record.cbCode,
      fullName: record.fullName,
      email: record.email,
      userAD: record.userAD,
      gioiTinh: record.gioiTinh,
      position: record.position,
      isActive: record.isActive,
      ngaySinh: record.ngaySinh ? dayjs(record.ngaySinh) : undefined,
      departmentId: deptId,
    })
    setModalOpen(true)
  }

  function closeModal() { setModalOpen(false); setEditing(null); form.resetFields(); setFormUnitId(undefined) }

  // Đơn vị cấp 1: không có parentId VÀ có ít nhất 1 phòng ban con, sort theo code (01→09)
  const topUnits = departments
    .filter(d => !d.parentId && (d._count?.children ?? 0) > 0)
    .sort((a, b) => a.code.localeCompare(b.code))

  // Phòng ban cấp 2: chỉ hiển thị phòng ban có cán bộ thực tế, sort theo thứ tự ưu tiên
  const subDepts = filterUnitId
    ? departments
        .filter(d => d.parentId === filterUnitId && (d._count?.canBo ?? 0) > 0)
        .sort((a, b) => deptPriority(a.name, a.code) - deptPriority(b.name, b.code) || a.name.localeCompare(b.name, 'vi'))
    : []

  // Sắp xếp 4 cấp: đơn vị (01-HS→09-NH) → phòng ban (BGD trước) → chức vụ → tên
  const sortedCanBo = [...canBoList].sort((a, b) => {
    // 1. Đơn vị cha (parent.code)
    const uA = a.department?.parent?.code ?? a.department?.code
    const uB = b.department?.parent?.code ?? b.department?.code
    const ur = unitRank(uA) - unitRank(uB)
    if (ur !== 0) return ur
    // 2. Phòng ban trong đơn vị (BGD → KHDN → KHCN → KH → KTNQ → PGD → KTGSNB → TH → KHRR)
    const dA = a.department; const dB = b.department
    const dr = deptPriority(dA?.name ?? '', dA?.code ?? '') - deptPriority(dB?.name ?? '', dB?.code ?? '')
    if (dr !== 0) return dr
    // 3. Chức vụ (GĐ > PGĐ > TP > PP > NV)
    const pr = positionRank(a.position) - positionRank(b.position)
    if (pr !== 0) return pr
    // 4. Họ tên
    return (a.fullName ?? '').localeCompare(b.fullName ?? '', 'vi')
  })

  function handleUnitChange(val: string | undefined) {
    setFilterUnitId(val)
    setFilterDeptId(undefined)
  }

  async function handleSubmit() {
    const values = await form.validateFields()
    const payload = {
      ...values,
      ngaySinh: values.ngaySinh ? values.ngaySinh.toISOString() : undefined,
      // Nếu không chọn phòng ban cụ thể, lưu chi nhánh vào departmentId
      departmentId: values.departmentId ?? formUnitId ?? undefined,
    }
    if (editing) {
      updateMut.mutate({ id: editing.id, ...payload })
    } else {
      createMut.mutate(payload)
    }
  }

  const renderCanBoActions = (record: CanBoItem) => (
    <Space>
      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
      <Popconfirm
        title={`Reset MK về "Abcd@1234"?`}
        description="Mật khẩu mới = Abcd@1234 (mặc định)"
        onConfirm={() => resetMut.mutate([record.id])}
        okText="Reset" cancelText="Hủy"
      >
        <Button size="small" icon={<LockOutlined />} title="Reset mật khẩu" />
      </Popconfirm>
      <Popconfirm title="Xác nhận xóa cán bộ này?" onConfirm={() => deleteMut.mutate(record.id)} okText="Xóa" cancelText="Hủy">
        <Button size="small" danger icon={<DeleteOutlined />} />
      </Popconfirm>
    </Space>
  )

  const columns = [
    { title: 'STT', render: (_: unknown, __: unknown, i: number) => i + 1, width: 55 },
    { title: 'Mã CB', dataIndex: 'cbCode', width: 110, sorter: (a: CanBoItem, b: CanBoItem) => a.cbCode.localeCompare(b.cbCode) },
    { title: 'Họ tên', dataIndex: 'fullName', width: 180 },
    { title: 'UserAD', dataIndex: 'userAD', width: 130 },
    { title: 'Phòng ban', dataIndex: ['department', 'name'], width: 200,
      render: (_: unknown, r: CanBoItem) => r.department
        ? <span>{r.department.name}</span>
        : '-'
    },
    { title: 'Chi nhánh', width: 200,
      render: (_: unknown, r: CanBoItem) => {
        const parent = r.department?.parent
        return parent ? <span style={{ color: '#1677ff' }}>{parent.name}</span> : '-'
      }
    },
    { title: 'Chức vụ', dataIndex: 'position', width: 150 },
    { title: 'Email', dataIndex: 'email', width: 200 },
    {
      title: 'Trạng thái', dataIndex: 'isActive', width: 100,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Hoạt động' : 'Nghỉ'}</Tag>,
    },
    {
      title: 'Thao tác', width: 120, fixed: 'right' as const,
      render: (_: unknown, record: CanBoItem) => renderCanBoActions(record),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}><IdcardOutlined /> Quản lý cán bộ</Typography.Title>
        <Space wrap>
          <Select
            placeholder="Tất cả đơn vị"
            allowClear
            style={{ width: 180 }}
            value={filterUnitId}
            onChange={handleUnitChange}
            options={topUnits.map(d => ({ value: d.id, label: d.name }))}
          />
          <Select
            placeholder="Tất cả phòng ban"
            allowClear
            style={{ width: 200 }}
            value={filterDeptId}
            onChange={setFilterDeptId}
            disabled={!filterUnitId}
            options={subDepts.map(d => {
              // Bỏ prefix tên đơn vị nếu có (VD: "Hội sở - P.KH Cá nhân" → "P.KH Cá nhân")
              const unitName = topUnits.find(u => u.id === filterUnitId)?.name ?? ''
              const label = unitName && d.name.toLowerCase().startsWith(unitName.toLowerCase())
                ? d.name.slice(unitName.length).replace(/^\s*[-–]\s*/, '').trim()
                : d.name
              return { value: d.id, label }
            })}
          />
          <Input.Search
            placeholder="Tìm theo tên, mã CB, UserAD..."
            allowClear
            onSearch={setSearch}
            onChange={e => !e.target.value && setSearch('')}
            style={{ width: 240 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Thêm cán bộ</Button>
          <Button icon={<UploadOutlined />} onClick={() => { setImportResult(null); setImportOpen(true) }}>Import GAHR26</Button>
          {selectedRowKeys.length > 0 && (
            <>
              <Popconfirm
                title={`Reset mật khẩu ${selectedRowKeys.length} cán bộ?`}
                description="Mật khẩu mới của mỗi người = Abcd@1234 (mặc định)"
                onConfirm={() => resetMut.mutate(selectedRowKeys as string[])}
                okText="Reset" cancelText="Hủy"
              >
                <Button icon={<LockOutlined />} loading={resetMut.isPending} danger>
                  Reset MK ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
              <Popconfirm
                title={`Xóa ${selectedRowKeys.length} cán bộ đã chọn?`}
                description="Hành động này không thể hoàn tác. Tài khoản đăng nhập liên kết cũng sẽ bị xóa."
                onConfirm={() => bulkDeleteMut.mutate(selectedRowKeys as string[])}
                okText="Xóa" okButtonProps={{ danger: true }}
                cancelText="Hủy"
                icon={<DeleteOutlined style={{ color: '#E53935' }} />}
              >
                <Button
                  icon={<DeleteOutlined />}
                  loading={bulkDeleteMut.isPending}
                  danger
                  type="primary"
                >
                  Xóa đã chọn ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      </div>

      <ManageTable<CanBoItem>
        rowKey="id"
        dataSource={sortedCanBo}
        columns={columns}
        loading={isLoading}
        size="small"
        scroll={{ x: 1600, y: 'calc(100vh - 280px)' }}
        pagination={{ pageSize, onShowSizeChange: (_, size) => setPageSize(size), showSizeChanger: true, showTotal: (t) => `Tổng ${t} cán bộ` }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          preserveSelectedRowKeys: true,
        }}
        cardHeading={(record) => (
          <>
            <Typography.Title level={5}>{record.fullName}</Typography.Title>
            <Tag>{record.cbCode}</Tag>
          </>
        )}
        cardBadge={(record) => <Tag color={record.isActive ? 'green' : 'red'}>{record.isActive ? 'Hoạt động' : 'Nghỉ'}</Tag>}
        cardMeta={[
          { label: 'Phòng ban', render: (record) => record.department?.name ?? '-' },
          {
            label: 'Chi nhánh',
            render: (record) => record.department?.parent
              ? <span style={{ color: '#1677ff' }}>{record.department.parent.name}</span>
              : '-',
          },
          { label: 'Chức vụ', render: (record) => record.position ?? '-' },
        ]}
        cardActions={renderCanBoActions}
      />

      <Modal
        title={editing ? 'Sửa thông tin cán bộ' : 'Thêm cán bộ mới'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        confirmLoading={createMut.isPending || updateMut.isPending}
        okText={editing ? 'Cập nhật' : 'Thêm'}
        cancelText="Hủy"
        width={800}
        forceRender
      >
        <Form form={form} layout="vertical" size="small">
          <Divider titlePlacement="left" plain>Thông tin cơ bản</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="cbCode" label="Mã CB" rules={[{ required: true, message: 'Nhập mã CB' }, { pattern: /^\d{9}$/, message: 'Mã CB phải là 9 chữ số' }]}>
                <Input placeholder="9 chữ số" maxLength={9} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="fullName" label="Họ tên" rules={[{ required: true, message: 'Nhập họ tên' }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Email không hợp lệ' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="userAD" label="User AD (tên đăng nhập)">
                <Input placeholder="Dùng để đăng nhập" />
              </Form.Item>
            </Col>
          </Row>

          <Divider titlePlacement="left" plain>Thông tin cá nhân</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="ngaySinh" label="Ngày sinh">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" placeholder="Chọn ngày sinh" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="gioiTinh" label="Giới tính">
                <Select placeholder="Chọn giới tính" allowClear>
                  <Select.Option value="Nam">Nam</Select.Option>
                  <Select.Option value="Nữ">Nữ</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider titlePlacement="left" plain>Đơn vị công tác</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="Chi nhánh">
                <Select
                  placeholder="Chọn chi nhánh"
                  allowClear
                  showSearch
                  optionFilterProp="children"
                  value={formUnitId}
                  onChange={(val) => {
                    setFormUnitId(val)
                    form.setFieldValue('departmentId', undefined)
                  }}
                >
                  {departments.filter(d => !d.parentId).map(d => (
                    <Select.Option key={d.id} value={d.id}>{d.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="departmentId" label="Phòng ban">
                <Select
                  placeholder={formUnitId ? 'Chọn phòng ban' : 'Chọn chi nhánh trước'}
                  allowClear
                  showSearch
                  optionFilterProp="children"
                  disabled={!formUnitId}
                >
                  {departments.filter(d => d.parentId === formUnitId).map(d => (
                    <Select.Option key={d.id} value={d.id}>{d.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="position" label="Chức vụ">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="isActive" label="Trạng thái" valuePropName="checked">
            <Switch checkedChildren="Đang làm" unCheckedChildren="Đã nghỉ" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal: Kết quả reset mật khẩu */}
      <Modal
        title="Kết quả reset mật khẩu"
        open={resetResultOpen}
        onOk={() => setResetResultOpen(false)}
        onCancel={() => setResetResultOpen(false)}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText="Đóng"
      >
        {resetResult && (
          <>
            <p>
              ✅ Reset thành công: <strong>{resetResult.reset}</strong> tài khoản{' '}
              {resetResult.noAccount > 0 && <>| ⚠️ Không có tài khoản: <strong>{resetResult.noAccount}</strong></>}
            </p>
            <p style={{ color: '#888', fontSize: 12 }}>Mật khẩu mới = Abcd@1234 (mặc định) — cán bộ sẽ phải đổi mật khẩu sau lần đăng nhập tiếp theo</p>
            <Table
              size="small"
              rowKey="cbCode"
              dataSource={resetResult.details}
              columns={[
                { title: 'Họ tên', dataIndex: 'fullName' },
                { title: 'Mã CB', dataIndex: 'cbCode' },
                {
                  title: 'Kết quả', dataIndex: 'ok', width: 120,
                  render: (ok: boolean) => ok
                    ? <Tag color="green">Đã reset</Tag>
                    : <Tag color="orange">Chưa có TK</Tag>,
                },
              ]}
              pagination={false}
            />
          </>
        )}
      </Modal>

      {/* Modal: Nhập GAHR26 */}
      <Modal
        title="Import cán bộ từ file GAHR26"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={<Button onClick={() => setImportOpen(false)}>Đóng</Button>}
        width={1100}
      >
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: '0 0 8px', color: '#555', fontSize: 13 }}>
            Chọn file <strong>*gahr26*.csv</strong> hoặc <strong>.xls/.xlsx</strong>.
            File cần có cột: <code>EMPNO</code>, <code>BRCD</code>, <code>BRNM</code>, <code>DEPTNM</code>, <code>POSITION</code>, <code>SEX</code>, <code>BIRTHDT</code>.
            Username đăng nhập luôn lấy theo <code>EMPNO</code> (mã cán bộ).
          </p>
          <Upload
            accept=".csv,.xls,.xlsx"
            showUploadList={false}
            beforeUpload={(file) => {
              setImportResult(null)
              importMut.mutate(file)
              return false
            }}
          >
            <Button icon={<UploadOutlined />} loading={importMut.isPending} type="primary">
              {importMut.isPending ? 'Đang xử lý...' : 'Chọn file để import'}
            </Button>
          </Upload>
        </div>

        {importResult && (
          <>
            <Alert
              type={importResult.errors.length > 0 ? 'warning' : 'success'}
              message={
                <span>
                  ✅ Thêm mới: <strong>{importResult.created}</strong> &nbsp;|&nbsp;
                  🔄 Cập nhật: <strong>{importResult.updated}</strong> &nbsp;|&nbsp;
                  ⏭️ Bỏ qua: <strong>{importResult.skipped}</strong>
                  {importResult.errors.length > 0 && <> &nbsp;|&nbsp; ❌ Lỗi: <strong>{importResult.errors.length}</strong></>}
                </span>
              }
              style={{ marginBottom: 12 }}
            />
            {importResult.errors.length > 0 && (
              <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 4, padding: '8px 12px', marginBottom: 12, maxHeight: 120, overflow: 'auto' }}>
                {importResult.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: '#d46b08' }}>{e}</div>)}
              </div>
            )}
            <Table
              size="small"
              rowKey="empno"
              dataSource={importResult.rows}
              pagination={{ pageSize: 10, size: 'small' }}
              scroll={{ x: 900 }}
              columns={[
                { title: 'EMPNO', dataIndex: 'empno', width: 110 },
                { title: 'Họ tên', dataIndex: 'fullName', width: 160 },
                { title: 'Mã CN (BRCD)', dataIndex: 'branchCode', width: 110 },
                { title: 'Tên chi nhánh (BRNM)', dataIndex: 'branchName', width: 200 },
                { title: 'Phòng ban (DEPTNM)', dataIndex: 'deptName', width: 180 },
                { title: 'Chức vụ (POSITION)', dataIndex: 'position', width: 160 },
                {
                  title: 'Kết quả', dataIndex: 'action', width: 100,
                  render: (a: string) => {
                    if (a === 'created') return <Tag color="green">Thêm mới</Tag>
                    if (a === 'updated') return <Tag color="blue">Cập nhật</Tag>
                    if (a === 'skipped') return <Tag color="default">Bỏ qua</Tag>
                    return <Tag color="red">Lỗi</Tag>
                  },
                },
                { title: 'Ghi chú', dataIndex: 'note', render: (n?: string) => n ? <span style={{ color: '#cf1322', fontSize: 12 }}>{n}</span> : null },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  )
}
