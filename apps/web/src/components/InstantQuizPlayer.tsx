import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Progress, Switch } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  AudioMutedOutlined,
  AudioOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  FireFilled,
  SoundOutlined,
  ThunderboltFilled,
} from '@ant-design/icons'
import api from '../lib/api'
import { fireConfetti, playCorrectSound, playWrongSound } from '../lib/feedback-fx'
import { dangBatGiongDoc, datGiongDoc, docLanLuot, dungGiongDoc, moiGiongDoc, type MucDocLanLuot } from '../lib/giong-doc'
import { giongCuaCauHoi } from '../lib/giong-doc-key'

export interface InstantQuizOption {
  id: string
  content: string
  orderIndex: number
}

export interface InstantQuizQuestion {
  id: string
  content: string
  imageUrl: string | null
  questionType: 'SINGLE' | 'MULTIPLE' | 'ORDERING'
  orderIndex: number
  points: number
  subjectName: string | null
  options: InstantQuizOption[]
}

// Kết quả một câu đã chốt — dựng từ phản hồi của API khi chốt, hoặc khôi phục
// lại từ dữ liệu server khi người làm tải lại trang giữa chừng.
export interface LockedResult {
  selectedOptionIds: string[]
  isCorrect: boolean
  correctOptionIds: string[]
  explanation: string | null
}

interface Props {
  attemptId: string
  quizTitle: string
  questions: InstantQuizQuestion[]
  initialResults: Record<string, LockedResult>
  remainingSeconds: number
  isSubmitting: boolean
  onFinish: () => void
}

// Thời gian giữ màn hình kết quả trước khi tự sang câu kế — CHỈ áp dụng khi
// người làm bật công tắc "Tự động chuyển câu"; tắt công tắc thì phải tự bấm
// "Tiếp tục" (nút này luôn có sẵn nên bật/tắt công tắc không đổi cách bấm tay).
const AUTO_ADVANCE_DELAY_MS = 5_000
const SOUND_STORAGE_KEY = '7800quiz.instant-player.sound'
const AUTO_ADVANCE_STORAGE_KEY = '7800quiz.instant-player.auto-advance'

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const optionLetter = (index: number) => String.fromCharCode(65 + index)

function moveItem(list: string[], index: number, direction: -1 | 1): string[] {
  const next = [...list]
  const target = index + direction
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export default function InstantQuizPlayer({
  attemptId,
  quizTitle,
  questions,
  initialResults,
  remainingSeconds,
  isSubmitting,
  onFinish,
}: Props) {
  const [results, setResults] = useState<Record<string, LockedResult>>(initialResults)
  // Vào thẳng câu chưa trả lời đầu tiên — người làm tải lại trang không phải bấm lại từ đầu.
  const [currentIndex, setCurrentIndex] = useState(() => {
    const firstUnlocked = questions.findIndex((q) => !initialResults[q.id])
    return firstUnlocked === -1 ? Math.max(0, questions.length - 1) : firstUnlocked
  })
  const [draftSelection, setDraftSelection] = useState<string[]>([])
  const [isLocking, setIsLocking] = useState(false)
  const [lockError, setLockError] = useState<string | null>(null)
  const [shakeToken, setShakeToken] = useState(0)
  const [soundOn, setSoundOn] = useState(() => {
    try {
      return localStorage.getItem(SOUND_STORAGE_KEY) !== 'off'
    } catch {
      return true
    }
  })
  // Mặc định BẬT để giữ nguyên hành vi trước đây (luôn tự chuyển câu) cho người
  // làm chưa từng đụng tới công tắc này.
  const [autoAdvance, setAutoAdvance] = useState(() => {
    try {
      return localStorage.getItem(AUTO_ADVANCE_STORAGE_KEY) !== 'off'
    } catch {
      return true
    }
  })
  const advanceTimer = useRef<number | undefined>(undefined)
  // Mặc định TẮT (khác autoAdvance/soundOn) — bật giọng đọc bất ngờ giữa phòng
  // thi chung sẽ gây khó chịu, ai cần thì tự bật.
  const [narrationOn, setNarrationOn] = useState(() => dangBatGiongDoc('instant'))

  const currentQuestion = questions[currentIndex]
  const currentResult = currentQuestion ? results[currentQuestion.id] : undefined
  const isRevealing = Boolean(currentResult)

  const answeredCount = Object.keys(results).length
  const correctCount = useMemo(
    () => Object.values(results).filter((r) => r.isCorrect).length,
    [results],
  )

  // Chuỗi trả lời đúng liên tiếp tính đến câu vừa chốt — dùng cho hiệu ứng "streak".
  const streak = useMemo(() => {
    let count = 0
    for (const question of questions) {
      const result = results[question.id]
      if (!result) break
      if (result.isCorrect) count += 1
      else count = 0
    }
    return count
  }, [questions, results])

  const toggleSound = () => {
    setSoundOn((on) => {
      const next = !on
      try {
        localStorage.setItem(SOUND_STORAGE_KEY, next ? 'on' : 'off')
      } catch {
        /* trình duyệt chặn localStorage — chỉ mất ghi nhớ lựa chọn, bỏ qua */
      }
      return next
    })
  }

  const toggleAutoAdvance = (next: boolean) => {
    setAutoAdvance(next)
    try {
      localStorage.setItem(AUTO_ADVANCE_STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      /* trình duyệt chặn localStorage — chỉ mất ghi nhớ lựa chọn, bỏ qua */
    }
  }

  const toggleNarration = () => {
    setNarrationOn((on) => {
      const next = !on
      // Bắt buộc gọi moiGiongDoc() NGAY TRONG handler click này (không phải
      // trong effect) — chỉ cử chỉ bấm tay của người dùng mới mở khoá được
      // quyền autoplay của trình duyệt cho các lần phát bằng code về sau.
      if (next) moiGiongDoc()
      else dungGiongDoc()
      datGiongDoc('instant', next)
      return next
    })
  }

  const goNext = useCallback(() => {
    window.clearTimeout(advanceTimer.current)
    const nextIndex = questions.findIndex((q, i) => i > currentIndex && !results[q.id])
    if (nextIndex === -1) {
      const anyLeft = questions.findIndex((q) => !results[q.id])
      if (anyLeft === -1) {
        onFinish()
        return
      }
      setCurrentIndex(anyLeft)
    } else {
      setCurrentIndex(nextIndex)
    }
    setDraftSelection([])
  }, [currentIndex, onFinish, questions, results])

  const lockAnswer = useCallback(
    async (selectedOptionIds: string[]) => {
      if (!currentQuestion || isLocking || isRevealing) return
      dungGiongDoc() // tiếng đọc không được đè lên beep đúng/sai lúc chốt đáp án
      setIsLocking(true)
      setLockError(null)
      try {
        const response = await api.post(
          `/me/attempts/${attemptId}/answers/${currentQuestion.id}/lock`,
          { selectedOptionIds },
        )
        const data = response.data as {
          selectedOptionIds: string[]
          isCorrect: boolean
          correctOptionIds: string[]
          explanation: string | null
        }
        setResults((prev) => ({
          ...prev,
          [currentQuestion.id]: {
            selectedOptionIds: data.selectedOptionIds,
            isCorrect: data.isCorrect,
            correctOptionIds: data.correctOptionIds,
            explanation: data.explanation,
          },
        }))
        if (data.isCorrect) {
          if (soundOn) playCorrectSound()
          void fireConfetti()
        } else {
          if (soundOn) playWrongSound()
          setShakeToken((token) => token + 1)
        }
      } catch {
        setLockError('Không gửi được đáp án. Kiểm tra kết nối rồi thử lại.')
      } finally {
        setIsLocking(false)
      }
    },
    [attemptId, currentQuestion, isLocking, isRevealing, soundOn],
  )

  // goNext đổi identity mỗi lần render (đồng hồ đếm ngược ở component cha nhảy
  // mỗi giây), nên phải gọi qua ref — nếu đưa thẳng vào deps của effect dưới thì
  // timer bị huỷ và đặt lại liên tục, không bao giờ chạy tới hạn.
  const goNextRef = useRef(goNext)
  useEffect(() => {
    goNextRef.current = goNext
  })

  // Tự sang câu kế sau khi xem xong kết quả — CHỈ khi công tắc autoAdvance đang
  // bật; người làm luôn bấm "Tiếp tục" được để đi ngay bất kể công tắc.
  const revealedQuestionId = currentResult ? currentQuestion?.id : undefined
  useEffect(() => {
    if (!revealedQuestionId || !autoAdvance) return
    advanceTimer.current = window.setTimeout(() => goNextRef.current(), AUTO_ADVANCE_DELAY_MS)
    return () => window.clearTimeout(advanceTimer.current)
  }, [revealedQuestionId, autoAdvance])

  // Đọc lĩnh vực + đề + A/B/C/D khi sang câu mới — TÁCH RIÊNG khỏi effect
  // auto-advance ở trên (không dùng chung deps): 2 effect này độc lập, gộp
  // chung sẽ lặp lại đúng lỗi mà chú thích ở dòng 231-234 đã cảnh báo.
  useEffect(() => {
    if (!narrationOn || !currentQuestion || isRevealing) return
    const cacDapAn = currentQuestion.options
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((o) => o.content)
    // Đọc gọn "A"/"B"/"C"/"D" thay vì "Đáp án A"/"Đáp án B"... cho đỡ tốn thời gian nghe.
    const cumTuA = ['A', 'B', 'C', 'D']
    // Giọng quyết định THEO CÂU HỎI (từ nội dung đề bài) — áp dụng chung cho cả
    // đề bài lẫn mọi đáp án của câu, để nghe trọn 1 câu không lẫn Nam/Nữ.
    const giong = giongCuaCauHoi(currentQuestion.content)
    const doc: MucDocLanLuot[] = []
    if (currentQuestion.subjectName) doc.push('Lĩnh vực', currentQuestion.subjectName)
    doc.push({ text: currentQuestion.content, giong })
    cacDapAn.forEach((noiDung, i) => {
      if (cumTuA[i]) doc.push(cumTuA[i])
      doc.push({ text: noiDung, giong })
    })
    void docLanLuot(doc)
    return () => dungGiongDoc()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ đọc lại khi ĐỔI câu hoặc bật/tắt công tắc, không phải mỗi lần currentQuestion object đổi identity
  }, [currentQuestion?.id, narrationOn, isRevealing])

  // Dừng hẳn khi rời màn hình (nộp bài, chuyển route…).
  useEffect(() => () => dungGiongDoc(), [])

  if (!currentQuestion) return null

  const isLastPending = questions.every((q, i) => i === currentIndex || results[q.id])
  const orderingIds =
    currentQuestion.questionType === 'ORDERING'
      ? currentResult?.selectedOptionIds.length
        ? currentResult.selectedOptionIds
        : draftSelection.length
          ? draftSelection
          : currentQuestion.options.map((o) => o.id)
      : []
  const orderingOptions = orderingIds
    .map((id) => currentQuestion.options.find((o) => o.id === id))
    .filter((o): o is InstantQuizOption => Boolean(o))

  const shownSelection = currentResult?.selectedOptionIds ?? draftSelection
  const progressPercent = Math.round((answeredCount / questions.length) * 100)
  const isTimeLow = remainingSeconds <= 60

  const optionState = (optionId: string) => {
    if (!currentResult) return shownSelection.includes(optionId) ? 'picked' : 'idle'
    const isRight = currentResult.correctOptionIds.includes(optionId)
    const wasPicked = currentResult.selectedOptionIds.includes(optionId)
    if (isRight) return 'correct'
    if (wasPicked) return 'wrong'
    return 'muted'
  }

  return (
    <div className="iq-stage">
      <div className="iq-aurora" aria-hidden="true" />

      <header className="iq-topbar">
        <div className="iq-topbar-left">
          <span className="iq-quiz-title">{quizTitle}</span>
          <span className="iq-question-counter">
            Câu {currentIndex + 1} / {questions.length}
          </span>
        </div>
        <div className="iq-topbar-right">
          {streak >= 2 && (
            <span className="iq-streak" key={streak}>
              <FireFilled /> Chuỗi {streak}
            </span>
          )}
          <span className="iq-score">
            <ThunderboltFilled /> {correctCount}
          </span>
          <span
            className="iq-auto-advance"
            title="Tự động chuyển sang câu tiếp theo sau 5 giây, dù trả lời đúng hay sai. Tắt để tự bấm &quot;Tiếp tục&quot;."
          >
            <Switch
              size="small"
              checked={autoAdvance}
              onChange={toggleAutoAdvance}
              aria-label="Tự động chuyển câu sau 5 giây"
            />
            <span className="iq-auto-advance-label">Tự động chuyển câu sau 5s</span>
          </span>
          <button
            type="button"
            className={`iq-sound${soundOn ? '' : ' iq-sound-off'}`}
            onClick={toggleSound}
            aria-label={soundOn ? 'Tắt âm thanh' : 'Bật âm thanh'}
            title={soundOn ? 'Tắt âm thanh' : 'Bật âm thanh'}
          >
            <SoundOutlined />
          </button>
          <button
            type="button"
            className={`iq-narrate${narrationOn ? '' : ' iq-narrate-off'}`}
            onClick={toggleNarration}
            aria-label={narrationOn ? 'Tắt giọng đọc thuyết minh' : 'Bật giọng đọc thuyết minh'}
            title={narrationOn ? 'Tắt giọng đọc thuyết minh' : 'Bật giọng đọc đề bài và đáp án'}
          >
            {narrationOn ? <AudioOutlined /> : <AudioMutedOutlined />}
          </button>
          <span className={`iq-timer${isTimeLow ? ' iq-timer-low' : ''}`}>
            <ClockCircleOutlined /> {formatTime(remainingSeconds)}
          </span>
        </div>
      </header>

      <div className="iq-progress">
        <Progress percent={progressPercent} showInfo={false} strokeColor="#E0B44C" trailColor="rgba(251,247,242,0.18)" />
        <div className="iq-progress-dots" aria-hidden="true">
          {questions.map((question, index) => {
            const result = results[question.id]
            const cls = result ? (result.isCorrect ? 'iq-dot-correct' : 'iq-dot-wrong') : index === currentIndex ? 'iq-dot-current' : ''
            return <span key={question.id} className={`iq-dot ${cls}`} />
          })}
        </div>
      </div>

      <main className={`iq-card${currentResult ? (currentResult.isCorrect ? ' iq-card-correct' : ' iq-card-wrong') : ''}`} key={`q-${currentQuestion.id}-${shakeToken}`}>
        <div className="iq-card-meta">
          {currentQuestion.subjectName && (
            <span className="iq-chip">Lĩnh vực: {currentQuestion.subjectName}</span>
          )}
          <span className="iq-chip">
            {currentQuestion.questionType === 'SINGLE' && 'Chọn một đáp án'}
            {currentQuestion.questionType === 'MULTIPLE' && 'Chọn nhiều đáp án'}
            {currentQuestion.questionType === 'ORDERING' && 'Sắp xếp đúng thứ tự'}
          </span>
          <span className="iq-chip iq-chip-points">{currentQuestion.points} điểm</span>
        </div>

        <h2 className="iq-question">{currentQuestion.content}</h2>
        {currentQuestion.imageUrl && <img src={currentQuestion.imageUrl} alt="" className="iq-question-image" />}

        {currentQuestion.questionType === 'ORDERING' ? (
          <ol className="iq-ordering">
            {orderingOptions.map((option, index) => (
              <li key={option.id} className={`iq-option iq-ordering-item iq-option-${optionState(option.id)}`}>
                <span className="iq-letter">{index + 1}</span>
                <span className="iq-option-text">{option.content}</span>
                {!isRevealing && (
                  <span className="iq-ordering-actions">
                    <Button
                      size="small"
                      icon={<ArrowUpOutlined />}
                      disabled={index === 0}
                      aria-label="Di chuyển lên"
                      onClick={() => setDraftSelection(moveItem(orderingIds, index, -1))}
                    />
                    <Button
                      size="small"
                      icon={<ArrowDownOutlined />}
                      disabled={index === orderingOptions.length - 1}
                      aria-label="Di chuyển xuống"
                      onClick={() => setDraftSelection(moveItem(orderingIds, index, 1))}
                    />
                  </span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="iq-options">
            {currentQuestion.options.map((option, index) => {
              const state = optionState(option.id)
              return (
                <button
                  type="button"
                  key={option.id}
                  className={`iq-option iq-option-${state}`}
                  disabled={isRevealing || isLocking}
                  style={{ animationDelay: `${index * 60}ms` }}
                  onClick={() => {
                    if (currentQuestion.questionType === 'SINGLE') {
                      // Kiểu Quizizz: một cú click là chốt luôn, không cần bấm xác nhận
                      setDraftSelection([option.id])
                      void lockAnswer([option.id])
                      return
                    }
                    setDraftSelection((prev) =>
                      prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id],
                    )
                  }}
                >
                  <span className="iq-letter">{optionLetter(index)}</span>
                  <span className="iq-option-text">{option.content}</span>
                  {state === 'correct' && <CheckOutlined className="iq-option-mark" />}
                  {state === 'wrong' && <CloseOutlined className="iq-option-mark" />}
                </button>
              )
            })}
          </div>
        )}

        {lockError && <p className="iq-error">{lockError}</p>}

        {!isRevealing && currentQuestion.questionType !== 'SINGLE' && (
          <div className="iq-confirm">
            <Button
              type="primary"
              size="large"
              className="iq-confirm-button"
              loading={isLocking}
              disabled={currentQuestion.questionType === 'MULTIPLE' && draftSelection.length === 0}
              onClick={() => void lockAnswer(currentQuestion.questionType === 'ORDERING' ? orderingIds : draftSelection)}
            >
              Chốt đáp án
            </Button>
            <span className="iq-confirm-hint">Chốt rồi sẽ không sửa lại được</span>
          </div>
        )}
      </main>

      {currentResult && (
        <div className={`iq-verdict${currentResult.isCorrect ? ' iq-verdict-correct' : ' iq-verdict-wrong'}`}>
          <div className="iq-verdict-face" aria-hidden="true">
            {currentResult.isCorrect ? '🎉' : '😔'}
          </div>
          <div className="iq-verdict-body">
            <strong>{currentResult.isCorrect ? 'Chính xác!' : 'Chưa đúng rồi'}</strong>
            {currentResult.isCorrect ? (
              <span>
                {streak >= 3 ? `Đang có chuỗi ${streak} câu đúng liên tiếp — giữ phong độ nhé!` : 'Cộng thêm điểm cho bạn.'}
              </span>
            ) : (
              <span>Đáp án đúng đã được đánh dấu màu xanh ở trên.</span>
            )}
            {currentResult.explanation && <span className="iq-explanation">{currentResult.explanation}</span>}
            {!isLastPending && (
              <span className="iq-verdict-hint">
                {autoAdvance ? 'Tự động chuyển câu sau 5 giây…' : 'Bấm "Tiếp tục" để sang câu kế'}
              </span>
            )}
          </div>
          <Button
            size="large"
            className="iq-next-button"
            loading={isSubmitting}
            onClick={goNext}
          >
            {isLastPending ? 'Xem kết quả' : 'Tiếp tục'}
          </Button>
        </div>
      )}
    </div>
  )
}
