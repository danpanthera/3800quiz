import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Input, Modal, Space, Tag, Typography, message } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import api, { getErrorMessage } from '../lib/api'
import { useAuth } from '../lib/useAuth'

const { Title, Text } = Typography

interface PendingOption { id: string; content: string; isCorrect: boolean; orderIndex: number }
interface PendingQuestion {
  id: string
  content: string
  explanation: string | null
  subject: { name: string } | null
  submittedByName: string | null
  createdAt: string
  options: PendingOption[]
}

export default function QuestionApprovalPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [rejectTarget, setRejectTarget] = useState<PendingQuestion | null>(null)
  const [reason, setReason] = useState('')

  const { data: rows = [], isLoading } = useQuery<PendingQuestion[]>({
    queryKey: ['pending-questions'],
    queryFn: () => api.get('/admin/bank-questions/pending').then((r) => r.data),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/admin/bank-questions/${id}/approve`),
    onSuccess: () => {
      message.success('Đã duyệt câu hỏi')
      void qc.invalidateQueries({ queryKey: ['pending-questions'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể duyệt câu hỏi')),
  })
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.put(`/admin/bank-questions/${id}/reject`, { reason }),
    onSuccess: () => {
      message.success('Đã từ chối câu hỏi')
      void qc.invalidateQueries({ queryKey: ['pending-questions'] })
      setRejectTarget(null)
      setReason('')
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể từ chối câu hỏi')),
  })

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Title level={1}>Duyệt câu hỏi mới</Title>
        </div>
        <Tag color="orange">{rows.length} câu đang chờ duyệt</Tag>
      </header>
      <Text type="secondary">
        Câu hỏi ngân hàng do Trainer tạo phải được Admin duyệt trước khi được chọn vào bộ đề/Đấu trường.
      </Text>

      {isLoading ? null : rows.length === 0 ? (
        <Text type="secondary">Không có câu hỏi nào đang chờ duyệt.</Text>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {rows.map((q) => (
            <Card key={q.id} bordered={false}>
              <Space wrap style={{ marginBottom: 8 }}>
                {q.subject && <Tag color="blue">Lĩnh vực: {q.subject.name}</Tag>}
                <Tag>Người gửi: {q.submittedByName ?? 'Không rõ'}</Tag>
                <Tag>{new Date(q.createdAt).toLocaleString('vi-VN')}</Tag>
              </Space>
              <Title level={5}>{q.content}</Title>
              <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
                {q.options.map((o) => (
                  <div key={o.id} style={{ color: o.isCorrect ? '#27AE60' : undefined, fontWeight: o.isCorrect ? 600 : undefined }}>
                    {o.isCorrect ? '✓ ' : '• '}{o.content}
                  </div>
                ))}
              </Space>
              {q.explanation && <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>Giải thích: {q.explanation}</Text>}

              {isAdmin ? (
                <Space>
                  <Button type="primary" icon={<CheckOutlined />} loading={approveMutation.isPending} onClick={() => approveMutation.mutate(q.id)}>
                    Duyệt
                  </Button>
                  <Button danger icon={<CloseOutlined />} onClick={() => setRejectTarget(q)}>
                    Từ chối
                  </Button>
                </Space>
              ) : (
                <Tag color="processing">Đang chờ Admin duyệt</Tag>
              )}
            </Card>
          ))}
        </Space>
      )}

      <Modal
        title="Từ chối câu hỏi"
        open={!!rejectTarget}
        onCancel={() => { setRejectTarget(null); setReason('') }}
        onOk={() => rejectTarget && rejectMutation.mutate({ id: rejectTarget.id, reason })}
        confirmLoading={rejectMutation.isPending}
      >
        <Input.TextArea rows={3} placeholder="Lý do từ chối (tuỳ chọn)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  )
}
