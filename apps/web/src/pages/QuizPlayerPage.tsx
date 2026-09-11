import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Progress,
  Radio,
  Result,
  Skeleton,
  Space,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BookOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EyeInvisibleOutlined,
  LeftOutlined,
  RightOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import InstantQuizPlayer, { type LockedResult } from '../components/InstantQuizPlayer'
import {
  deleteAttemptDraft,
  getAttemptDraft,
  saveAttemptDraft,
  type AttemptDraft,
} from '../lib/attempt-drafts'

const { Title, Text, Paragraph } = Typography

type SyncStatus = 'loading' | 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'error'

interface QuizOption {
  id: string
  content: string
  orderIndex: number
}

interface QuizQuestion {
  id: string
  content: string
  imageUrl: string | null
  questionType: 'SINGLE' | 'MULTIPLE' | 'ORDERING'
  orderIndex: number
  points: number
  subjectName: string | null
  options: QuizOption[]
}

// ORDERING: nếu đã có đáp án đủ số mục thì giữ đúng thứ tự đã chọn,
// chưa trả lời thì hiện theo thứ tự server đã xáo sẵn cho attempt này.
function getOrderingArrangement(question: QuizQuestion, selected: string[]): QuizOption[] {
  if (selected.length === question.options.length) {
    const byId = new Map(question.options.map((o) => [o.id, o]))
    const arranged = selected.map((id) => byId.get(id)).filter((o): o is QuizOption => Boolean(o))
    if (arranged.length === question.options.length) return arranged
  }
  return question.options
}

function moveItem(list: string[], index: number, direction: -1 | 1): string[] {
  const next = [...list]
  const target = index + direction
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

interface AttemptData {
  attempt: {
    id: string
    status: 'IN_PROGRESS' | 'GRADED'
    deadlineAt: string
    answerRevision: number
  }
  quiz: {
    id: string
    title: string
    description: string | null
    durationMin: number
    passScore: number | null
    instantFeedback: boolean
    questions: QuizQuestion[]
  }
  answers: Array<{
    questionId: string
    selectedOptionIds: unknown
    lockedAt?: string | null
    isCorrect?: boolean | null
    correctOptionIds?: string[] | null
    explanation?: string | null
  }>
}

const syncStatusText: Record<SyncStatus, string> = {
  loading: 'Đang tải bài kiểm tra',
  saved: 'Đã lưu trên hệ thống',
  pending: 'Đang chờ lưu',
  saving: 'Đang lưu',
  offline: 'Mất kết nối - đã lưu nháp trên thiết bị',
  conflict: 'Dữ liệu đã được cập nhật ở nơi khác - đang tải lại',
  error: 'Không thể lưu - sẽ thử lại khi có mạng',
}

const toAnswerMap = (answers: AttemptData['answers']): Record<string, string[]> =>
  Object.fromEntries(
    answers.map((answer) => [
      answer.questionId,
      Array.isArray(answer.selectedOptionIds)
        ? answer.selectedOptionIds.filter((id): id is string => typeof id === 'string')
        : [],
    ]),
  )

const getRemainingSeconds = (deadlineAt: string) =>
  Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 1000))

const formatRemainingTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

export default function QuizPlayerPage() {
  const { attemptId } = useParams()
  const navigate = useNavigate()
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [answerRevision, setAnswerRevision] = useState(0)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading')
  const [pendingSave, setPendingSave] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [retryToken, setRetryToken] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [violationCount, setViolationCount] = useState(0)
  const initializedAttemptId = useRef<string | undefined>(undefined)
  const answersRef = useRef(answers)
  const answerRevisionRef = useRef(answerRevision)
  const submissionStarted = useRef(false)

  // Đồng bộ ref theo state mới nhất qua effect (không ghi ref ngay trong lúc render) — để các
  // callback/timer đăng ký 1 lần (debounce lưu draft, cảnh báo rời tab...) luôn đọc được giá trị mới nhất.
  useEffect(() => {
    answersRef.current = answers
    answerRevisionRef.current = answerRevision
  }, [answers, answerRevision])

  const attemptQuery = useQuery<AttemptData>({
    queryKey: ['attempt', attemptId],
    queryFn: () => api.get(`/me/attempts/${attemptId}`).then((response) => response.data),
    enabled: Boolean(attemptId),
    retry: false,
  })

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/me/attempts/${attemptId}/submit`).then((response) => response.data),
    onSuccess: async (result) => {
      if (attemptId) await deleteAttemptDraft(attemptId)
      navigate(`/my/results/${result.id}`, {
        replace: true,
        state: { levelUp: result.levelUp, newLevel: result.newLevel, newBadges: result.newBadges },
      })
    },
    onError: () => message.error('Không thể nộp bài ngay bây giờ. Hệ thống sẽ chấm bản đã lưu khi hết giờ.'),
  })

  useEffect(() => {
    const handleOnline = () => setRetryToken((value) => value + 1)
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  // Ghi nhận rời màn hình / cố sao chép đề khi đang làm bài — chỉ cảnh báo +
  // lưu lại để đối chiếu sau, KHÔNG tự động chấm rớt (tránh oan vô tình alt-tab).
  useEffect(() => {
    if (!attemptId || attemptQuery.data?.attempt.status !== 'IN_PROGRESS') return

    const reportViolation = (type: 'TAB_HIDDEN' | 'COPY_ATTEMPT') => {
      api
        .post(`/me/attempts/${attemptId}/violations`, { type })
        .then((response) => setViolationCount(response.data.violationCount))
        .catch(() => {})
    }
    const handleVisibility = () => {
      if (document.hidden) reportViolation('TAB_HIDDEN')
    }
    const handleCopy = (event: ClipboardEvent) => {
      event.preventDefault()
      reportViolation('COPY_ATTEMPT')
    }

    document.addEventListener('visibilitychange', handleVisibility)
    document.addEventListener('copy', handleCopy)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      document.removeEventListener('copy', handleCopy)
    }
  }, [attemptId, attemptQuery.data?.attempt.status])

  useEffect(() => {
    const data = attemptQuery.data
    if (!data || !attemptId || initializedAttemptId.current === attemptId) return
    initializedAttemptId.current = attemptId
    let active = true

    const hydrate = async () => {
      const serverAnswers = toAnswerMap(data.answers)
      let draft: AttemptDraft | undefined
      try {
        draft = await getAttemptDraft(attemptId)
      } catch {
        setSyncStatus('error')
      }

      if (!active) return
      const canRecoverDraft = draft?.answerRevision === data.attempt.answerRevision
      const recoveredAnswers = canRecoverDraft && draft
        ? { ...serverAnswers, ...draft.answers }
        : serverAnswers
      if (draft && !canRecoverDraft) {
        void deleteAttemptDraft(attemptId)
      }

      setAnswers(recoveredAnswers)
      setAnswerRevision(data.attempt.answerRevision)
      setPendingSave(canRecoverDraft && JSON.stringify(recoveredAnswers) !== JSON.stringify(serverAnswers))
      setSyncStatus(canRecoverDraft ? 'pending' : 'saved')
      setHydrated(true)
    }

    void hydrate()
    return () => {
      active = false
    }
  }, [attemptId, attemptQuery.data])

  useEffect(() => {
    const data = attemptQuery.data
    if (!data) return
    if (data.attempt.status === 'GRADED') {
      navigate(`/my/results/${attemptId}`, { replace: true })
      return
    }

    const refreshRemainingTime = () => {
      const nextRemainingSeconds = getRemainingSeconds(data.attempt.deadlineAt)
      setRemainingSeconds(nextRemainingSeconds)
      if (nextRemainingSeconds === 0 && !submissionStarted.current) {
        submissionStarted.current = true
        submitMutation.mutate()
      }
    }

    refreshRemainingTime()
    const timer = window.setInterval(refreshRemainingTime, 1_000)
    return () => window.clearInterval(timer)
  }, [attemptId, attemptQuery.data, navigate, submitMutation])

  useEffect(() => {
    const data = attemptQuery.data
    if (!data || !attemptId || !hydrated || !pendingSave || data.attempt.status !== 'IN_PROGRESS') {
      return
    }

    const timer = window.setTimeout(() => {
      if (!navigator.onLine) {
        setSyncStatus('offline')
        return
      }

      const answersToSave = answersRef.current
      const revisionToSave = answerRevisionRef.current
      setSyncStatus('saving')

      void api.put(`/me/attempts/${attemptId}/answers`, {
        revision: revisionToSave,
        answers: Object.entries(answersToSave).map(([questionId, selectedOptionIds]) => ({
          questionId,
          selectedOptionIds,
        })),
      }).then(async (response) => {
        const nextRevision = response.data.answerRevision as number
        answerRevisionRef.current = nextRevision
        setAnswerRevision(nextRevision)

        if (answersRef.current === answersToSave) {
          await deleteAttemptDraft(attemptId)
          setPendingSave(false)
          setSyncStatus('saved')
          return
        }

        await saveAttemptDraft({
          attemptId,
          answerRevision: nextRevision,
          answers: answersRef.current,
          updatedAt: new Date().toISOString(),
        })
        setSyncStatus('pending')
      }).catch((error: { response?: { status?: number } }) => {
        if (error.response?.status === 409) {
          initializedAttemptId.current = undefined
          setHydrated(false)
          setPendingSave(false)
          setSyncStatus('conflict')
          void attemptQuery.refetch()
          return
        }
        setSyncStatus(navigator.onLine ? 'error' : 'offline')
      })
    }, 900)

    return () => window.clearTimeout(timer)
  }, [answerRevision, attemptId, attemptQuery, hydrated, pendingSave, retryToken])

  const updateAnswer = (questionId: string, selectedOptionIds: string[]) => {
    if (!attemptId) return
    const nextAnswers = { ...answersRef.current, [questionId]: selectedOptionIds }
    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
    setPendingSave(true)
    setSyncStatus(navigator.onLine ? 'pending' : 'offline')
    void saveAttemptDraft({
      attemptId,
      answerRevision: answerRevisionRef.current,
      answers: nextAnswers,
      updatedAt: new Date().toISOString(),
    }).catch(() => setSyncStatus('error'))
  }

  if (attemptQuery.isLoading || !hydrated) {
    return <Skeleton active paragraph={{ rows: 12 }} />
  }

  if (attemptQuery.isError || !attemptQuery.data) {
    return <Result status="error" title="Không thể tải bài kiểm tra" extra={<Button onClick={() => attemptQuery.refetch()}>Thử lại</Button>} />
  }

  const { quiz } = attemptQuery.data

  // Bộ đề bật phản hồi tức thì dùng giao diện kiểu Quizizz: chốt từng câu, hiện
  // ngay đúng/sai rồi tự sang câu kế. Đề thi chính thức giữ nguyên giao diện cũ
  // (còn quay lại sửa được, chỉ chấm khi nộp).
  if (quiz.instantFeedback) {
    if (!quiz.questions.length) return <Empty description="Bộ đề chưa có câu hỏi" />
    const lockedResults: Record<string, LockedResult> = Object.fromEntries(
      attemptQuery.data.answers
        .filter((answer) => answer.lockedAt)
        .map((answer) => [
          answer.questionId,
          {
            selectedOptionIds: Array.isArray(answer.selectedOptionIds)
              ? answer.selectedOptionIds.filter((id): id is string => typeof id === 'string')
              : [],
            isCorrect: Boolean(answer.isCorrect),
            correctOptionIds: answer.correctOptionIds ?? [],
            explanation: answer.explanation ?? null,
          },
        ]),
    )
    return (
      <InstantQuizPlayer
        attemptId={attemptId!}
        quizTitle={quiz.title}
        questions={quiz.questions}
        initialResults={lockedResults}
        remainingSeconds={remainingSeconds}
        isSubmitting={submitMutation.isPending}
        onFinish={() => {
          if (submissionStarted.current) return
          submissionStarted.current = true
          submitMutation.mutate()
        }}
      />
    )
  }

  const currentQuestion = quiz.questions[currentQuestionIndex]
  if (!currentQuestion) {
    return <Empty description="Bộ đề chưa có câu hỏi" />
  }

  const selectedOptionIds = answers[currentQuestion.id] ?? []
  const orderingArrangement = currentQuestion.questionType === 'ORDERING'
    ? getOrderingArrangement(currentQuestion, selectedOptionIds)
    : []
  const orderingArrangementIds = orderingArrangement.map((o) => o.id)
  const answeredQuestionCount = Object.values(answers).filter((selected) => selected.length > 0).length
  const progressPercent = quiz.questions.length
    ? Math.round((answeredQuestionCount / quiz.questions.length) * 100)
    : 0
  const isTimeRunningOut = remainingSeconds <= 5 * 60
  const canSubmit = !pendingSave && syncStatus === 'saved' && remainingSeconds > 0

  return (
    <div className="quiz-player-page">
      <header className="quiz-player-header">
        <div>
          <Text className="page-eyebrow">Đang làm bài</Text>
          <Title level={1}>{quiz.title}</Title>
          {quiz.description && <Paragraph>{quiz.description}</Paragraph>}
        </div>
        <div className={`quiz-timer${isTimeRunningOut ? ' quiz-timer-warning' : ''}`}>
          <ClockCircleOutlined />
          <span>{formatRemainingTime(remainingSeconds)}</span>
        </div>
      </header>

      <div className="quiz-save-status" role="status">
        <SaveOutlined />
        <span>{syncStatusText[syncStatus]}</span>
      </div>

      {syncStatus === 'offline' && (
        <Alert
          type="warning"
          showIcon
          message="Bạn vẫn có thể tiếp tục làm bài"
          description="Các lựa chọn mới đã được lưu trên thiết bị. Hệ thống sẽ tự đồng bộ khi có mạng trước thời hạn."
        />
      )}

      {syncStatus === 'conflict' && (
        <Alert
          type="warning"
          showIcon
          message="Bài làm đã thay đổi ở một nơi khác"
          description="Hệ thống đang tải lại dữ liệu mới nhất để tránh ghi đè đáp án."
        />
      )}

      {violationCount > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<EyeInvisibleOutlined />}
          message={`Đã ghi nhận ${violationCount} lần rời khỏi màn hình làm bài`}
          description="Hành vi này được hệ thống lưu lại để đối chiếu. Vui lòng ở lại trang làm bài cho đến khi nộp."
        />
      )}

      <div className="quiz-player-layout">
        <aside className="quiz-navigation" aria-label="Danh sách câu hỏi">
          <div className="quiz-navigation-summary">
            <span>Tiến độ</span>
            <strong>{answeredQuestionCount}/{quiz.questions.length}</strong>
          </div>
          <Progress percent={progressPercent} showInfo={false} strokeColor="#246b5a" />
          <div className="quiz-question-indexes">
            {quiz.questions.map((question, index) => (
              <Button
                key={question.id}
                type={index === currentQuestionIndex ? 'primary' : 'default'}
                className={answers[question.id]?.length ? 'quiz-question-index-answered' : ''}
                aria-label={`Câu ${index + 1}${answers[question.id]?.length ? ', đã trả lời' : ''}`}
                onClick={() => setCurrentQuestionIndex(index)}
              >
                {index + 1}
              </Button>
            ))}
          </div>
        </aside>

        <Card className="quiz-question-card" bordered={false}>
          <div className="quiz-question-heading">
            <Text>Câu {currentQuestionIndex + 1} / {quiz.questions.length}</Text>
            <Tag>
              {currentQuestion.questionType === 'MULTIPLE' && 'Chọn nhiều đáp án'}
              {currentQuestion.questionType === 'SINGLE' && 'Chọn một đáp án'}
              {currentQuestion.questionType === 'ORDERING' && 'Sắp xếp đúng thứ tự'}
            </Tag>
          </div>
          {currentQuestion.subjectName && (
            <Text strong style={{ display: 'block', marginTop: 12, color: '#246b5a' }}>
              <BookOutlined /> Lĩnh vực: {currentQuestion.subjectName}
            </Text>
          )}
          <Title level={3}>{currentQuestion.content}</Title>
          {currentQuestion.imageUrl && (
            <img src={currentQuestion.imageUrl} alt="" className="quiz-question-image" style={{ marginBottom: 20 }} />
          )}

          {currentQuestion.questionType === 'MULTIPLE' && (
            <Checkbox.Group
              className="quiz-options"
              value={selectedOptionIds}
              onChange={(values) => updateAnswer(currentQuestion.id, values as string[])}
            >
              {currentQuestion.options.map((option) => (
                <Checkbox key={option.id} value={option.id} className="quiz-option">
                  <span className="quiz-option-letter">{String.fromCharCode(65 + option.orderIndex - 1)}</span>
                  <span>{option.content}</span>
                </Checkbox>
              ))}
            </Checkbox.Group>
          )}

          {currentQuestion.questionType === 'SINGLE' && (
            <Radio.Group
              className="quiz-options"
              value={selectedOptionIds[0]}
              onChange={(event) => updateAnswer(currentQuestion.id, [event.target.value])}
            >
              {currentQuestion.options.map((option) => (
                <Radio key={option.id} value={option.id} className="quiz-option">
                  <span className="quiz-option-letter">{String.fromCharCode(65 + option.orderIndex - 1)}</span>
                  <span>{option.content}</span>
                </Radio>
              ))}
            </Radio.Group>
          )}

          {currentQuestion.questionType === 'ORDERING' && (
            <Space direction="vertical" size={8} className="quiz-options" style={{ width: '100%' }}>
              {orderingArrangement.map((option, idx) => (
                <div key={option.id} className="quiz-option quiz-ordering-item">
                  <span className="quiz-option-letter">{idx + 1}</span>
                  <span style={{ flex: 1 }}>{option.content}</span>
                  <Space size={4}>
                    <Button
                      size="small"
                      icon={<ArrowUpOutlined />}
                      disabled={idx === 0}
                      aria-label="Di chuyển lên"
                      onClick={() => updateAnswer(currentQuestion.id, moveItem(orderingArrangementIds, idx, -1))}
                    />
                    <Button
                      size="small"
                      icon={<ArrowDownOutlined />}
                      disabled={idx === orderingArrangement.length - 1}
                      aria-label="Di chuyển xuống"
                      onClick={() => updateAnswer(currentQuestion.id, moveItem(orderingArrangementIds, idx, 1))}
                    />
                  </Space>
                </div>
              ))}
            </Space>
          )}

          <footer className="quiz-player-actions">
            <Button
              icon={<LeftOutlined />}
              disabled={currentQuestionIndex === 0}
              onClick={() => setCurrentQuestionIndex((index) => index - 1)}
            >
              Câu trước
            </Button>
            <Space>
              <Button
                disabled={currentQuestionIndex === quiz.questions.length - 1}
                onClick={() => setCurrentQuestionIndex((index) => index + 1)}
              >
                Câu tiếp
                <RightOutlined />
              </Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={submitMutation.isPending}
                disabled={!canSubmit}
                onClick={() => submitMutation.mutate()}
              >
                Nộp bài
              </Button>
            </Space>
          </footer>
        </Card>
      </div>

      {pendingSave && (
        <Text className="quiz-submit-note"><CheckCircleOutlined /> Nút nộp bài sẽ bật sau khi dữ liệu được lưu trên hệ thống.</Text>
      )}
    </div>
  )
}