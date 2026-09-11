import { useState } from 'react'
import {
  AimOutlined, CalendarOutlined, ClockCircleOutlined, FileTextOutlined, FireOutlined,
  ThunderboltOutlined, TrophyOutlined, RightOutlined, HistoryOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Button, Card, Empty, Input, List, Progress, Skeleton, Space, Tag, Typography, message,
} from 'antd'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import api, { getErrorMessage } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import DailyQuestionCard from '../components/DailyQuestionCard'

const { Title, Text } = Typography

interface MyAttempt {
  id: string
  status: 'IN_PROGRESS' | 'GRADED'
  deadlineAt: string
  submissionId: string | null
}

interface BestAttempt {
  submissionId: string
  score: number | null
  isPassed: boolean | null
}

interface Assignment {
  id: string
  startAt: string | null
  endAt: string | null
  myAttempt: MyAttempt | null
  attemptsUsed: number
  bestAttempt: BestAttempt | null
  quiz: {
    id: string
    title: string
    description: string | null
    topic: string | null
    durationMin: number
    maxAttempts: number
  }
}

interface SubjectPerformance {
  subjectId: string
  subjectName: string
  totalAnswered: number
  correctCount: number
  correctRate: number
}

interface MyProgress {
  xp: number
  level: number
  levelName: string
  color: string
  xpToNext: number
  xpInCurrentLevel: number
  percentToNext: number
  currentStreak: number
  maxStreak: number
  totalSubmissions: number
  totalArenaWins: number
  rank: number
}

interface BadgeItem {
  id: string
  awardedAt: string
  badgeDefinition: {
    code: string
    name: string
    description: string
    category: string
  }
}

interface XpTx {
  id: string
  amount: number
  source: string
  note: string | null
  createdAt: string
}

interface ArenaHistoryItem {
  sessionId: string
  sessionName: string
  joinCode: string
  status: 'LOBBY' | 'RUNNING' | 'FINISHED'
  quizTitle: string
  teamName: string
  teamColor: string
  score: number
  rank: number | null
  joinedAt: string
}

// Giữ đồng bộ với bảng màu đang dùng ở AchievementsPage (trang quản trị)
const CATEGORY_COLOR: Record<string, string> = {
  EXAM: 'blue',
  STREAK: 'orange',
  ARENA: 'red',
  PROGRESS: 'green',
  LEVEL: 'purple',
}

// Diễn giải enum XpSource của backend sang câu tiếng Việt cho học viên dễ hiểu
const XP_SOURCE_LABEL: Record<string, string> = {
  EXAM_PASS: 'Hoàn thành bài kiểm tra',
  EXAM_FAIL: 'Làm bài chưa đạt',
  EXAM_PERFECT: 'Đạt điểm tuyệt đối',
  ARENA_PARTICIPATE: 'Tham gia Đấu trường',
  ARENA_WIN: 'Vô địch Đấu trường',
  STREAK_BONUS: 'Thưởng chuỗi ngày học liên tục',
  BADGE_BONUS: 'Thưởng mở khoá huy hiệu',
}

const formatDate = (value: string | null) =>
  value ? dayjs(value).format('DD/MM/YYYY') : null

// Trạng thái hiển thị của 1 đề thi, suy từ lần làm bài gần nhất (myAttempt) +
// số lần đã dùng so với giới hạn thi lại (quiz.maxAttempts, 0 = không giới hạn)
type AssignmentState = 'not_started' | 'in_progress' | 'expired_attempt' | 'done' | 'done_can_retry'

function getAssignmentState(assignment: Assignment): AssignmentState {
  const attempt = assignment.myAttempt
  if (!attempt) return 'not_started'
  if (attempt.status === 'GRADED') {
    const { maxAttempts } = assignment.quiz
    const canRetry = maxAttempts === 0 || assignment.attemptsUsed < maxAttempts
    return canRetry ? 'done_can_retry' : 'done'
  }
  return dayjs(attempt.deadlineAt).isBefore(dayjs()) ? 'expired_attempt' : 'in_progress'
}

const STATE_TAG: Record<AssignmentState, { color: string; label: string }> = {
  not_started: { color: 'default', label: 'Chưa làm' },
  in_progress: { color: 'processing', label: 'Đang làm dở' },
  expired_attempt: { color: 'error', label: 'Đã hết giờ' },
  done: { color: 'success', label: 'Đã nộp' },
  done_can_retry: { color: 'gold', label: 'Có thể làm lại' },
}

export default function MyQuizzesPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [joinCode, setJoinCode] = useState('')

  const assignmentsQuery = useQuery<Assignment[]>({
    queryKey: ['my-assignments'],
    queryFn: () => api.get('/me/assignments').then((response) => response.data),
  })
  const progressQuery = useQuery<MyProgress>({
    queryKey: ['my-progress'],
    queryFn: () => api.get('/me/progress').then((r) => r.data),
  })
  const subjectPerformanceQuery = useQuery<SubjectPerformance[]>({
    queryKey: ['my-subject-performance'],
    queryFn: () => api.get('/me/subject-performance').then((r) => r.data),
  })
  const badgesQuery = useQuery<BadgeItem[]>({
    queryKey: ['my-badges'],
    queryFn: () => api.get('/me/badges').then((r) => r.data),
  })
  const xpHistoryQuery = useQuery<{ items: XpTx[] }>({
    queryKey: ['my-xp-history'],
    queryFn: () => api.get('/me/xp-history', { params: { limit: 10 } }).then((r) => r.data),
  })
  const arenaHistoryQuery = useQuery<ArenaHistoryItem[]>({
    queryKey: ['my-arena-history'],
    queryFn: () => api.get('/me/arena-history').then((r) => r.data),
  })

  const startAttemptMutation = useMutation({
    mutationFn: (assignmentId: string) => api.post('/me/attempts', {
      id: crypto.randomUUID(),
      assignmentId,
    }).then((response) => response.data),
    onSuccess: (data) => navigate(`/my/attempts/${data.attempt.id}`),
    onError: (e) => message.error(getErrorMessage(e, 'Không thể bắt đầu bài kiểm tra. Vui lòng thử lại.')),
  })

  const progress = progressQuery.data
  const openCount = assignmentsQuery.data?.filter((a) => getAssignmentState(a) !== 'done').length ?? 0
  const liveArena = arenaHistoryQuery.data?.filter((a) => a.status !== 'FINISHED') ?? []
  const pastArena = arenaHistoryQuery.data?.filter((a) => a.status === 'FINISHED') ?? []

  const handleJoinArena = () => {
    const code = joinCode.trim().toUpperCase()
    if (code.length < 4) {
      message.warning('Nhập mã tham gia do người dẫn cung cấp (6 ký tự)')
      return
    }
    navigate(`/arena/join/${code}`)
  }

  return (
    <div className="page-stack">
      {/* ── Thẻ cấp độ / XP ── */}
      <Card className="dash-hero" bordered={false}>
        {progressQuery.isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : (
          <>
            <div className="dash-hero-top">
              <div>
                <Text className="dash-hero-greeting">Xin chào</Text>
                <Title level={2} className="dash-hero-name">{user?.fullName ?? 'Học viên'}</Title>
              </div>
              <span className="dash-hero-level">
                <TrophyOutlined />
                Cấp {progress?.level ?? 1} · {progress?.levelName ?? 'Tân binh'}
              </span>
            </div>

            <div className="dash-hero-progress">
              <div className="dash-hero-xp">
                <span>{progress?.xp ?? 0} XP</span>
                <span>
                  {progress?.xpToNext
                    ? `Còn ${progress.xpToNext} XP để lên cấp ${(progress.level ?? 1) + 1}`
                    : 'Đã đạt cấp cao nhất'}
                </span>
              </div>
              <Progress
                percent={progress?.percentToNext ?? 0}
                strokeColor={{ from: '#FFB300', to: '#FFD54F' }}
                trailColor="rgba(248,244,236,0.25)"
                showInfo={false}
              />
            </div>
          </>
        )}
      </Card>

      {/* ── Thống kê nhanh ── */}
      <dl className="dash-stats">
        <div className="dash-stat">
          <dt><FireOutlined /> Chuỗi ngày liên tục</dt>
          <dd>{progress?.currentStreak ?? 0}</dd>
        </div>
        <div className="dash-stat">
          <dt><FileTextOutlined /> Tổng bài đã làm</dt>
          <dd>{progress?.totalSubmissions ?? 0}</dd>
        </div>
        <div className="dash-stat">
          <dt><ThunderboltOutlined /> Vô địch Đấu trường</dt>
          <dd>{progress?.totalArenaWins ?? 0}</dd>
        </div>
        <div className="dash-stat">
          <dt><TrophyOutlined /> Hạng toàn hệ thống</dt>
          <dd>#{progress?.rank ?? '—'}</dd>
        </div>
      </dl>

      {/* ── Câu hỏi khởi động mỗi ngày — tự ẩn nếu ngân hàng câu hỏi rỗng ── */}
      <DailyQuestionCard />

      {/* ── Bản đồ điểm yếu theo lĩnh vực — chỉ hiện khi có ít nhất 1 lĩnh vực
          chưa đúng 100%, tính từ toàn bộ lịch sử bài đã nộp ── */}
      {(() => {
        const weakSubjects = (subjectPerformanceQuery.data ?? []).filter((s) => s.correctRate < 100)
        if (weakSubjects.length === 0) return null
        return (
          <Card
            title={<Space><AimOutlined /> Lĩnh vực cần cải thiện</Space>}
            bordered={false}
          >
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              {weakSubjects.slice(0, 3).map((s) => (
                <div key={s.subjectId}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text strong>{s.subjectName}</Text>
                    <Text type="secondary">{s.correctCount}/{s.totalAnswered} câu đúng</Text>
                  </div>
                  <Progress percent={s.correctRate} status={s.correctRate < 60 ? 'exception' : 'normal'} />
                </div>
              ))}
            </Space>
          </Card>
        )
      })()}

      {/* ── Đề thi được gán ── */}
      <section>
        <header className="page-title-row" style={{ marginBottom: 16 }}>
          <div>
            <Text className="page-eyebrow">3800Quiz</Text>
            <Title level={1}>Bài kiểm tra của tôi</Title>
          </div>
          {!assignmentsQuery.isLoading && (
            <Tag color="red">{openCount} bài đang mở</Tag>
          )}
        </header>

        {assignmentsQuery.isLoading ? (
          <div className="quiz-grid" aria-label="Đang tải bài kiểm tra">
            {[1, 2, 3].map((item) => <Card key={item}><Skeleton active /></Card>)}
          </div>
        ) : assignmentsQuery.data?.length ? (
          <List
            className="quiz-list"
            grid={{ gutter: 16, xs: 1, sm: 2, xl: 3 }}
            dataSource={assignmentsQuery.data}
            renderItem={(assignment) => {
              const state = getAssignmentState(assignment)
              const tag = STATE_TAG[state]
              // Cảnh báo sát hạn: còn dưới 24h tính tới thời điểm đóng bài
              const hoursLeft = assignment.endAt
                ? dayjs(assignment.endAt).diff(dayjs(), 'hour')
                : null
              const isUrgent = hoursLeft !== null && hoursLeft >= 0 && hoursLeft < 24

              return (
                <List.Item>
                  <Card className="quiz-card" bordered={false}>
                    <div className="quiz-card-icon"><FileTextOutlined /></div>
                    <Space size={6} wrap>
                      {assignment.quiz.topic && <Tag>{assignment.quiz.topic}</Tag>}
                      <Tag color={tag.color}>{tag.label}</Tag>
                      {isUrgent && <Tag color="warning">Còn {hoursLeft}h</Tag>}
                    </Space>
                    <Title level={3}>{assignment.quiz.title}</Title>
                    {assignment.quiz.description && (
                      <Text className="quiz-card-description">{assignment.quiz.description}</Text>
                    )}
                    <dl className="quiz-meta">
                      <div>
                        <dt><ClockCircleOutlined /> Thời lượng</dt>
                        <dd>{assignment.quiz.durationMin} phút</dd>
                      </div>
                      {(assignment.startAt || assignment.endAt) && (
                        <div>
                          <dt><CalendarOutlined /> Thời gian</dt>
                          <dd>{formatDate(assignment.startAt) ?? 'Bây giờ'} - {formatDate(assignment.endAt) ?? 'Không giới hạn'}</dd>
                        </div>
                      )}
                      {assignment.attemptsUsed > 0 && (
                        <div>
                          <dt><HistoryOutlined /> Số lần đã làm</dt>
                          <dd>
                            {assignment.quiz.maxAttempts === 0
                              ? `${assignment.attemptsUsed} lần (không giới hạn)`
                              : `${assignment.attemptsUsed}/${assignment.quiz.maxAttempts} lần`}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {state === 'done' && assignment.bestAttempt ? (
                      <Button
                        block
                        onClick={() => navigate(`/my/results/${assignment.bestAttempt!.submissionId}`)}
                      >
                        Xem kết quả
                      </Button>
                    ) : state === 'done_can_retry' && assignment.bestAttempt ? (
                      <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        <Button
                          type="primary"
                          block
                          onClick={() => startAttemptMutation.mutate(assignment.id)}
                          loading={startAttemptMutation.isPending && startAttemptMutation.variables === assignment.id}
                        >
                          Làm lại
                        </Button>
                        <Button
                          block
                          onClick={() => navigate(`/my/results/${assignment.bestAttempt!.submissionId}`)}
                        >
                          Xem kết quả
                        </Button>
                      </Space>
                    ) : state === 'in_progress' && assignment.myAttempt ? (
                      <Button
                        type="primary"
                        block
                        onClick={() => navigate(`/my/attempts/${assignment.myAttempt!.id}`)}
                      >
                        Tiếp tục làm bài
                      </Button>
                    ) : (
                      <Button
                        type="primary"
                        block
                        disabled={state === 'expired_attempt'}
                        onClick={() => startAttemptMutation.mutate(assignment.id)}
                        loading={startAttemptMutation.isPending && startAttemptMutation.variables === assignment.id}
                      >
                        {state === 'expired_attempt' ? 'Đã hết giờ làm bài' : 'Bắt đầu làm bài'}
                      </Button>
                    )}
                  </Card>
                </List.Item>
              )
            }}
          />
        ) : (
          <Empty description="Hiện chưa có bài kiểm tra được giao" />
        )}
      </section>

      {/* ── Đấu trường ── */}
      <Card title={<><ThunderboltOutlined /> Đấu trường</>}>
        <div className="dash-arena-join">
          <Input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onPressEnter={handleJoinArena}
            placeholder="NHẬP MÃ"
            maxLength={6}
            style={{ width: 160 }}
          />
          <Button type="primary" icon={<RightOutlined />} onClick={handleJoinArena}>
            Tham gia
          </Button>
          <Text type="secondary">Nhập mã 6 ký tự do người dẫn chương trình cung cấp</Text>
        </div>

        {liveArena.length > 0 && (
          <List
            className="dash-arena-list"
            style={{ marginTop: 16 }}
            header={<Text strong>Đang diễn ra</Text>}
            dataSource={liveArena}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button key="join" type="link" onClick={() => navigate(`/arena/join/${item.joinCode}`)}>
                    Vào lại
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={<Tag color={item.teamColor}>{item.teamName}</Tag>}
                  title={item.sessionName}
                  description={item.quizTitle}
                />
                <Tag color="processing">{item.status === 'LOBBY' ? 'Đang chờ' : 'Đang thi'}</Tag>
              </List.Item>
            )}
          />
        )}

        <List
          className="dash-arena-list"
          style={{ marginTop: 16 }}
          header={<Text strong>Đã tham gia</Text>}
          loading={arenaHistoryQuery.isLoading}
          dataSource={pastArena}
          locale={{ emptyText: 'Chưa tham gia phiên Đấu trường nào' }}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                avatar={<Tag color={item.teamColor}>{item.teamName}</Tag>}
                title={item.sessionName}
                description={`${item.quizTitle} · ${dayjs(item.joinedAt).format('DD/MM/YYYY')}`}
              />
              <Space>
                {item.rank && <Tag color={item.rank === 1 ? 'gold' : 'default'}>Hạng {item.rank}</Tag>}
                <Text strong>{item.score} điểm</Text>
              </Space>
            </List.Item>
          )}
        />
      </Card>

      {/* ── Huy hiệu ── */}
      <Card title={<><TrophyOutlined /> Huy hiệu của tôi</>}>
        {badgesQuery.isLoading ? (
          <Skeleton active />
        ) : badgesQuery.data?.length ? (
          <div className="dash-badges">
            {badgesQuery.data.map((badge) => (
              <div className="dash-badge" key={badge.id}>
                <div className="dash-badge-icon">🏅</div>
                <div className="dash-badge-name">{badge.badgeDefinition.name}</div>
                <Tag
                  color={CATEGORY_COLOR[badge.badgeDefinition.category] ?? 'default'}
                  style={{ marginTop: 6 }}
                >
                  {badge.badgeDefinition.category}
                </Tag>
                <div className="dash-badge-date">{dayjs(badge.awardedAt).format('DD/MM/YYYY')}</div>
              </div>
            ))}
          </div>
        ) : (
          <Empty description="Chưa có huy hiệu nào — hoàn thành bài kiểm tra để mở khoá chiếc đầu tiên" />
        )}
      </Card>

      {/* ── Hoạt động gần đây ── */}
      <Card title={<><HistoryOutlined /> Hoạt động gần đây</>}>
        <List
          loading={xpHistoryQuery.isLoading}
          dataSource={xpHistoryQuery.data?.items ?? []}
          locale={{ emptyText: 'Chưa có hoạt động nào được ghi nhận' }}
          renderItem={(tx) => (
            <List.Item>
              <List.Item.Meta
                title={XP_SOURCE_LABEL[tx.source] ?? tx.source}
                description={`${tx.note ? `${tx.note} · ` : ''}${dayjs(tx.createdAt).format('DD/MM/YYYY HH:mm')}`}
              />
              <span className={`dash-activity-amount ${tx.amount >= 0 ? 'is-plus' : 'is-minus'}`}>
                {tx.amount >= 0 ? '+' : ''}{tx.amount} XP
              </span>
            </List.Item>
          )}
        />
      </Card>
    </div>
  )
}
