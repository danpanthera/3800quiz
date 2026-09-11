import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Radio, Space, Tag, Typography, message } from 'antd'
import { BulbOutlined } from '@ant-design/icons'
import api, { getErrorMessage } from '../lib/api'

const { Text, Title } = Typography

interface DailyOption {
  id: string
  content: string
  orderIndex: number
  isCorrect?: boolean
}

interface DailyQuestionResp {
  available: boolean
  answered?: boolean
  isCorrect?: boolean
  selectedOptionIds?: string[]
  question?: {
    id: string
    content: string
    subjectName: string | null
    explanation: string | null
    options: DailyOption[]
  }
}

/** Thẻ "Câu hỏi khởi động mỗi ngày" — tự ẩn nếu ngân hàng câu hỏi rỗng. Tách
 * riêng khỏi MyQuizzesPage.tsx để trang chính không phình to. */
export default function DailyQuestionCard() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string>()

  const query = useQuery<DailyQuestionResp>({
    queryKey: ['daily-question'],
    queryFn: () => api.get('/me/daily-question').then((r) => r.data),
  })

  const answerMutation = useMutation({
    mutationFn: () =>
      api
        .post('/me/daily-question/answer', {
          questionId: query.data?.question?.id,
          selectedOptionIds: selected ? [selected] : [],
        })
        .then((r) => r.data),
    onSuccess: () => {
      message.success('Đã ghi nhận câu trả lời!')
      void queryClient.invalidateQueries({ queryKey: ['daily-question'] })
      void queryClient.invalidateQueries({ queryKey: ['my-progress'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể gửi câu trả lời')),
  })

  if (!query.data?.available || !query.data.question) return null
  const q = query.data.question
  const answered = query.data.answered

  return (
    <Card title={<Space><BulbOutlined /> Câu hỏi khởi động hôm nay</Space>} bordered={false}>
      {q.subjectName && <Tag color="blue" style={{ marginBottom: 12 }}>Lĩnh vực: {q.subjectName}</Tag>}
      <Title level={5}>{q.content}</Title>
      <Radio.Group
        style={{ width: '100%' }}
        value={answered ? query.data.selectedOptionIds?.[0] : selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={answered}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {q.options.map((o) => {
            let color: string | undefined
            if (answered) {
              if (o.isCorrect) color = '#27AE60'
              else if (query.data?.selectedOptionIds?.includes(o.id)) color = '#E53935'
            }
            return (
              <Radio key={o.id} value={o.id} style={{ color }}>
                {o.content}
              </Radio>
            )
          })}
        </Space>
      </Radio.Group>

      {answered ? (
        <div style={{ marginTop: 12 }}>
          <Tag color={query.data.isCorrect ? 'success' : 'error'}>
            {query.data.isCorrect ? 'Bạn đã trả lời ĐÚNG (+5 XP)' : 'Bạn đã trả lời SAI'}
          </Tag>
          {q.explanation && (
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>{q.explanation}</Text>
          )}
        </div>
      ) : (
        <Button
          type="primary"
          style={{ marginTop: 12 }}
          disabled={!selected}
          loading={answerMutation.isPending}
          onClick={() => answerMutation.mutate()}
        >
          Trả lời
        </Button>
      )}
    </Card>
  )
}
