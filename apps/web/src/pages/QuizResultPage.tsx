import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Result, Skeleton, Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, StarFilled, TrophyOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { fireConfetti } from '../lib/feedback-fx'

const { Text, Title, Paragraph } = Typography

interface ResultOption {
  id: string
  content: string
  isCorrect: boolean
  wasSelected: boolean
}

interface ResultQuestion {
  id: string
  content: string
  imageUrl: string | null
  explanation: string | null
  questionType: 'SINGLE' | 'MULTIPLE' | 'ORDERING'
  points: number
  isCorrect: boolean
  options: ResultOption[]
  correctOrder?: { id: string; content: string }[]
}

interface QuizResult {
  id: string
  score: number | null
  isPassed: boolean | null
  submittedAt: string | null
  questions: ResultQuestion[]
}

interface NavState {
  levelUp?: boolean
  newLevel?: number
  newBadges?: { code: string; name: string; iconSlug: string }[]
}

export default function QuizResultPage() {
  const { submissionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const xpInfo = (location.state as NavState | null) ?? null

  const resultQuery = useQuery<QuizResult>({
    queryKey: ['quiz-result', submissionId],
    queryFn: () => api.get(`/results/${submissionId}`).then((response) => response.data),
    enabled: Boolean(submissionId),
    retry: false,
  })

  useEffect(() => {
    if (resultQuery.data?.isPassed === true) void fireConfetti()
  }, [resultQuery.data?.id, resultQuery.data?.isPassed])

  // Bảng điều hướng có chiều cao thay đổi theo số câu hỏi (wrap nhiều dòng) — đo động
  // để .quiz-review-question tính đúng scroll-margin-top, không bị chính bảng nav (sticky) che khi cuộn tới.
  const navRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = navRef.current
    if (!el) return undefined
    const updateNavHeight = () => {
      document.documentElement.style.setProperty('--quiz-review-nav-h', `${el.offsetHeight}px`)
    }
    updateNavHeight()
    const observer = new ResizeObserver(updateNavHeight)
    observer.observe(el)
    return () => observer.disconnect()
  }, [resultQuery.data])

  if (resultQuery.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />
  if (resultQuery.isError || !resultQuery.data) {
    return <Result status="error" title="Không thể tải kết quả" extra={<Button onClick={() => resultQuery.refetch()}>Thử lại</Button>} />
  }

  const result = resultQuery.data
  const score = Math.round(result.score ?? 0)
  const isPassed = result.isPassed === true
  const correctCount = result.questions.filter((q) => q.isCorrect).length
  const totalCount = result.questions.length

  const scrollToQuestion = (questionId: string) => {
    document.getElementById(`quiz-review-q-${questionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="quiz-result">
      <Result
        icon={isPassed ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        status={isPassed ? 'success' : 'warning'}
        title="Bạn đã hoàn thành bài kiểm tra"
        subTitle={
          <>
            <strong>{score}/100 điểm</strong> — đúng {correctCount}/{totalCount} câu
            <br />
            <Text>{isPassed ? 'Kết quả đạt yêu cầu.' : 'Kết quả chưa đạt yêu cầu.'}</Text>
          </>
        }
      />

      {xpInfo && (xpInfo.levelUp || (xpInfo.newBadges?.length ?? 0) > 0) && (
        <Card className="quiz-xp-banner" style={{ maxWidth: 640, margin: '0 auto 24px' }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {xpInfo.levelUp && (
              <Space>
                <TrophyOutlined style={{ color: '#faad14', fontSize: 20 }} />
                <Text strong style={{ fontSize: 16 }}>Chúc mừng, bạn đã lên cấp {xpInfo.newLevel}!</Text>
              </Space>
            )}
            {(xpInfo.newBadges?.length ?? 0) > 0 && (
              <Space wrap>
                <StarFilled style={{ color: '#faad14' }} />
                <Text>Mở khoá huy hiệu mới:</Text>
                {xpInfo.newBadges!.map((b) => (
                  <Tag key={b.code} color="gold">{b.name}</Tag>
                ))}
              </Space>
            )}
          </Space>
        </Card>
      )}

      {totalCount > 0 && (
        <div className="quiz-review-list">
          <Title level={4} style={{ maxWidth: 720, margin: '0 auto 16px' }}>Xem lại bài làm</Title>

          <div className="quiz-review-nav" ref={navRef} aria-label="Điều hướng nhanh câu hỏi">
            <Text className="quiz-review-nav-title">Điều hướng nhanh — xanh: đúng, đỏ: sai</Text>
            <div className="quiz-review-nav-list">
              {result.questions.map((q, index) => (
                <Button
                  key={q.id}
                  className={`quiz-review-nav-item ${q.isCorrect ? 'is-correct' : 'is-wrong'}`}
                  aria-label={`Đến câu ${index + 1}, ${q.isCorrect ? 'đúng' : 'sai'}`}
                  onClick={() => scrollToQuestion(q.id)}
                >
                  {index + 1}
                </Button>
              ))}
            </div>
          </div>

          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {result.questions.map((q, index) => (
              <Card key={q.id} id={`quiz-review-q-${q.id}`} className={`quiz-review-question ${q.isCorrect ? 'is-correct' : 'is-wrong'}`}>
                <div className="quiz-review-heading">
                  <Text strong>Câu {index + 1}</Text>
                  <Tag color={q.isCorrect ? 'success' : 'error'} icon={q.isCorrect ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
                    {q.isCorrect ? 'Đúng' : 'Sai'}
                  </Tag>
                </div>
                <Paragraph style={{ fontWeight: 600, marginBottom: 16 }}>{q.content}</Paragraph>
                {q.imageUrl && (
                  <img src={q.imageUrl} alt="" className="quiz-question-image" style={{ marginBottom: 16 }} />
                )}

                {q.questionType === 'ORDERING' ? (
                  <>
                    <Text type="secondary" style={{ fontSize: 12 }}>Thứ tự bạn đã sắp xếp:</Text>
                    <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
                      {q.options.map((opt, optIdx) => (
                        <div key={opt.id} className={`quiz-review-option ${opt.isCorrect ? 'is-correct-option' : 'is-wrong-selected'}`}>
                          <span className="quiz-option-letter">{optIdx + 1}</span>
                          <span style={{ flex: 1 }}>{opt.content}</span>
                          {opt.isCorrect
                            ? <CheckCircleOutlined style={{ color: '#27AE60' }} />
                            : <CloseCircleOutlined style={{ color: '#E53935' }} />}
                        </div>
                      ))}
                    </Space>
                    {q.correctOrder && (
                      <>
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 16 }}>Thứ tự đúng:</Text>
                        <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
                          {q.correctOrder.map((opt, optIdx) => (
                            <div key={opt.id} className="quiz-review-option is-correct-option">
                              <span className="quiz-option-letter">{optIdx + 1}</span>
                              <span style={{ flex: 1 }}>{opt.content}</span>
                            </div>
                          ))}
                        </Space>
                      </>
                    )}
                  </>
                ) : (
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {q.options.map((opt, optIdx) => {
                      let stateClass = ''
                      if (opt.isCorrect) stateClass = 'is-correct-option'
                      else if (opt.wasSelected) stateClass = 'is-wrong-selected'
                      return (
                        <div key={opt.id} className={`quiz-review-option ${stateClass}`}>
                          <span className="quiz-option-letter">{String.fromCharCode(65 + optIdx)}</span>
                          <span style={{ flex: 1 }}>{opt.content}</span>
                          {opt.wasSelected && <Tag style={{ marginInlineEnd: 0 }}>Bạn chọn</Tag>}
                          {opt.isCorrect && <CheckCircleOutlined style={{ color: '#27AE60' }} />}
                        </div>
                      )
                    })}
                  </Space>
                )}

                {q.explanation && (
                  <Paragraph className="quiz-review-explanation">💡 {q.explanation}</Paragraph>
                )}
              </Card>
            ))}
          </Space>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 32 }}>
        <Button type="primary" onClick={() => navigate('/my/quizzes', { replace: true })}>
          Về danh sách bài kiểm tra
        </Button>
      </div>
    </div>
  )
}
