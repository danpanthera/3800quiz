import { useState, type CSSProperties } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Button, Card, Checkbox, Empty, InputNumber, Radio, Select, Skeleton, Space, Tag, Typography, message,
} from 'antd'
import { CheckCircleFilled, CloseCircleFilled, ReadOutlined } from '@ant-design/icons'
import api, { getErrorMessage } from '../lib/api'

const { Title, Text } = Typography

interface PracticeSubject { id: string; name: string; questionCount: number }
interface PracticeOption { id: string; content: string; orderIndex: number }
interface PracticeQuestion {
  id: string
  content: string
  questionType: 'SINGLE' | 'MULTIPLE' | 'ORDERING'
  subjectName: string | null
  options: PracticeOption[]
}
interface PracticeGradeItem {
  questionId: string
  isCorrect: boolean
  correctOptionIds: string[]
  explanation: string | null
}
interface PracticeGradeResult {
  results: PracticeGradeItem[]
  correctCount: number
  total: number
  scorePercent: number
}

export default function PracticePage() {
  const [subjectId, setSubjectId] = useState<string>()
  const [count, setCount] = useState(10)
  const [questions, setQuestions] = useState<PracticeQuestion[] | null>(null)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [results, setResults] = useState<PracticeGradeResult | null>(null)

  const subjectsQuery = useQuery<PracticeSubject[]>({
    queryKey: ['practice-subjects'],
    queryFn: () => api.get('/me/practice/subjects').then((r) => r.data),
  })

  const startMutation = useMutation({
    mutationFn: () =>
      api.get('/me/practice/start', { params: { subjectId, count } }).then((r) => r.data as PracticeQuestion[]),
    onSuccess: (data) => {
      setQuestions(data)
      setAnswers({})
      setResults(null)
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể lấy câu hỏi luyện tập')),
  })

  const gradeMutation = useMutation({
    mutationFn: () =>
      api
        .post('/me/practice/grade', {
          answers: (questions ?? []).map((q) => ({
            questionId: q.id,
            selectedOptionIds: answers[q.id] ?? [],
          })),
        })
        .then((r) => r.data as PracticeGradeResult),
    onSuccess: (data) => setResults(data),
    onError: (e) => message.error(getErrorMessage(e, 'Không thể chấm bài luyện tập')),
  })

  const toggleOrderingOption = (questionId: string, optionId: string) => {
    setAnswers((prev) => {
      const current = prev[questionId] ?? []
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
      return { ...prev, [questionId]: next }
    })
  }

  const resultByQuestionId = new Map((results?.results ?? []).map((r) => [r.questionId, r]))

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Title level={1}>Luyện tập tự do</Title>
        </div>
      </header>
      <Text type="secondary">
        Làm bao nhiêu lần tuỳ thích, không tính điểm chính thức, không tính vào thống kê — chỉ để ôn lại kiến thức.
      </Text>

      <Card bordered={false}>
        <Space wrap size={16}>
          <Select
            placeholder="Tất cả lĩnh vực"
            style={{ width: 260 }}
            allowClear
            value={subjectId}
            onChange={setSubjectId}
            loading={subjectsQuery.isLoading}
            options={(subjectsQuery.data ?? []).map((s) => ({
              value: s.id,
              label: `${s.name} (${s.questionCount} câu)`,
            }))}
          />
          <InputNumber min={1} max={50} value={count} onChange={(v) => setCount(v ?? 10)} addonAfter="câu" />
          <Button type="primary" icon={<ReadOutlined />} loading={startMutation.isPending} onClick={() => startMutation.mutate()}>
            {questions ? 'Lấy bộ câu hỏi khác' : 'Bắt đầu luyện tập'}
          </Button>
        </Space>
      </Card>

      {startMutation.isPending && <Skeleton active />}

      {questions && questions.length > 0 && (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {results && (
            <Card bordered={false} className="dash-hero">
              <Title level={3} style={{ color: '#fff', margin: 0 }}>
                Kết quả: {results.correctCount}/{results.total} câu đúng ({results.scorePercent}%)
              </Title>
            </Card>
          )}

          {questions.map((q, idx) => {
            const result = resultByQuestionId.get(q.id)
            return (
              <Card
                key={q.id}
                title={<Text strong>Câu {idx + 1}</Text>}
                extra={result && (result.isCorrect
                  ? <Tag icon={<CheckCircleFilled />} color="success">Đúng</Tag>
                  : <Tag icon={<CloseCircleFilled />} color="error">Sai</Tag>)}
                bordered={false}
              >
                {q.subjectName && <Tag color="blue" style={{ marginBottom: 8 }}>Lĩnh vực: {q.subjectName}</Tag>}
                <Text style={{ display: 'block', marginBottom: 12, fontWeight: 500 }}>{q.content}</Text>

                {q.questionType === 'SINGLE' && (
                  <Radio.Group
                    disabled={!!results}
                    value={answers[q.id]?.[0]}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: [e.target.value] }))}
                  >
                    <Space direction="vertical">
                      {q.options.map((o) => {
                        const trangThai = trangThaiDapAn(result, answers[q.id] ?? [], o.id)
                        return (
                          <Radio key={o.id} value={o.id}>
                            <span style={khungNoiBat(trangThai)}>{o.content}<IconDapAn trangThai={trangThai} /></span>
                          </Radio>
                        )
                      })}
                    </Space>
                  </Radio.Group>
                )}

                {q.questionType === 'MULTIPLE' && (
                  <Checkbox.Group
                    disabled={!!results}
                    value={answers[q.id] ?? []}
                    onChange={(vals) => setAnswers((prev) => ({ ...prev, [q.id]: vals as string[] }))}
                    style={{ width: '100%' }}
                  >
                    <Space direction="vertical">
                      {q.options.map((o) => {
                        const trangThai = trangThaiDapAn(result, answers[q.id] ?? [], o.id)
                        return (
                          <Checkbox key={o.id} value={o.id}>
                            <span style={khungNoiBat(trangThai)}>{o.content}<IconDapAn trangThai={trangThai} /></span>
                          </Checkbox>
                        )
                      })}
                    </Space>
                  </Checkbox.Group>
                )}

                {q.questionType === 'ORDERING' && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Text type="secondary">Bấm lần lượt theo đúng thứ tự bạn cho là đúng:</Text>
                    <Space wrap>
                      {q.options.map((o) => {
                        const seq = answers[q.id] ?? []
                        const pos = seq.indexOf(o.id)
                        const trangThai = trangThaiDapAn(result, seq, o.id)
                        return (
                          <Tag
                            key={o.id}
                            style={{
                              cursor: results ? 'default' : 'pointer', padding: '6px 12px', fontSize: 14,
                              ...khungNoiBat(trangThai),
                            }}
                            color={!trangThai && pos >= 0 ? 'processing' : undefined}
                            onClick={() => !results && toggleOrderingOption(q.id, o.id)}
                          >
                            {pos >= 0 ? `${pos + 1}. ` : ''}{o.content}
                            <IconDapAn trangThai={trangThai} />
                          </Tag>
                        )
                      })}
                    </Space>
                  </Space>
                )}

                {result && (result.explanation || !result.isCorrect) && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: result.isCorrect ? 'rgba(39,174,96,0.08)' : 'rgba(207,19,34,0.06)',
                      borderLeft: `3px solid ${result.isCorrect ? '#27AE60' : '#CF1322'}`,
                    }}
                  >
                    {!result.isCorrect && (
                      <Text strong style={{ color: '#27AE60', display: 'block' }}>
                        Đáp án đúng: {q.options.filter((o) => result.correctOptionIds.includes(o.id)).map((o) => o.content).join(', ')}
                      </Text>
                    )}
                    {result.explanation && (
                      <Text type="secondary" style={{ display: 'block', marginTop: !result.isCorrect ? 4 : 0 }}>
                        Giải thích: {result.explanation}
                      </Text>
                    )}
                  </div>
                )}
              </Card>
            )
          })}

          {!results && (
            <Button type="primary" size="large" loading={gradeMutation.isPending} onClick={() => gradeMutation.mutate()}>
              Nộp bài luyện tập
            </Button>
          )}
        </Space>
      )}

      {!questions && !startMutation.isPending && (
        <Empty description="Chọn lĩnh vực và số câu rồi bấm Bắt đầu luyện tập" />
      )}
    </div>
  )
}

// Sau khi có kết quả: bọc đáp án đúng bằng khung nền xanh nổi bật, đáp án đã chọn
// nhưng sai bọc khung nền đỏ. Không đổi MÀU CHỮ trực tiếp trên khung — antd tự ép
// màu chữ xám khi Radio/Checkbox bị disabled (sau khi nộp), đè mất màu chữ tuỳ
// chỉnh; nền/viền thì không bị ép nên vẫn hiển thị đúng. Icon đánh dấu tô màu
// TRỰC TIẾP trên chính nó (không kế thừa) nên vẫn giữ được màu xanh/đỏ.
function trangThaiDapAn(
  result: PracticeGradeItem | undefined,
  daChon: string[],
  optionId: string,
): 'dung' | 'sai' | null {
  if (!result) return null
  if (result.correctOptionIds.includes(optionId)) return 'dung'
  if (daChon.includes(optionId)) return 'sai'
  return null
}

function khungNoiBat(trangThai: 'dung' | 'sai' | null): CSSProperties | undefined {
  if (!trangThai) return undefined
  const mau = trangThai === 'dung' ? '#27AE60' : '#CF1322'
  return {
    background: trangThai === 'dung' ? 'rgba(39,174,96,0.14)' : 'rgba(207,19,34,0.1)',
    border: `1px solid ${mau}`,
    borderRadius: 6,
    padding: '2px 10px',
  }
}

function IconDapAn({ trangThai }: { trangThai: 'dung' | 'sai' | null }) {
  if (!trangThai) return null
  const mau = trangThai === 'dung' ? '#27AE60' : '#CF1322'
  return trangThai === 'dung'
    ? <CheckCircleFilled style={{ color: mau, marginLeft: 6 }} />
    : <CloseCircleFilled style={{ color: mau, marginLeft: 6 }} />
}
