import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Button, Card, Input, Space, Spin, Typography, Tag, Avatar, List, Result, Alert,
} from 'antd'
import {
  TrophyOutlined, ThunderboltOutlined, CheckCircleOutlined, ArrowLeftOutlined, BankOutlined, LockOutlined,
  TeamOutlined, MailOutlined,
} from '@ant-design/icons'
import type { Socket } from 'socket.io-client'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { createArenaSocket } from '../lib/arena-socket'
import { useServerClock } from '../hooks/useServerClock'
import { useArenaCountdown } from '../hooks/useArenaCountdown'
import { useArenaCountdownSound } from '../hooks/useArenaCountdownSound'
import { ArenaCountdownRing } from '../components/ArenaCountdownRing'
import { ArenaRevealBoard } from '../components/ArenaRevealBoard'
import { ArenaLeaderboard } from '../components/ArenaLeaderboard'
import { formatResponseTime } from '../lib/arena-format'
import {
  playCorrectSound, playWrongSound, playWinSound, playFastestSound,
  fireConfettiBurst, fireGoldSparkle,
} from '../lib/feedback-fx'
import type {
  ArenaTeam, ArenaQuestionPayload, ArenaPreparePayload, ArenaRevealPayload,
  ArenaLeaderboardRow, ArenaXpResult, ArenaStatePayload,
} from '../lib/arena-types'

const { Title, Text } = Typography

interface SessionPreview {
  id: string; name: string; joinCode: string; status: string
  requiresPasscode: boolean
  isInviteOnly: boolean
  quiz: { id: string; title: string }
  teams: { id: string; name: string; color: string; score: number; isPreset: boolean; memberCount: number }[]
}

interface JoinPayload {
  joinCode: string
  teamName?: string
  teamId?: string
  passcode?: string
}

type View = 'join' | 'lobby' | 'game' | 'result' | 'kicked'

function RankMedal({ rank }: { rank: number }) {
  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
  return <span style={{ fontSize: 20 }}>{medals[rank] ?? '🏅'}</span>
}

// ─── Component chính ────────────────────────────────────────────────────────

export default function ArenaPlayerPage() {
  const { joinCode = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [view, setView] = useState<View>('join')
  const [teamName, setTeamName] = useState(user?.fullName ?? '')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [passcode, setPasscode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myTeamColor, setMyTeamColor] = useState<string>('#7A1428')
  const [lobbyTeams, setLobbyTeams] = useState<ArenaTeam[]>([])
  const [leaderboard, setLeaderboard] = useState<ArenaLeaderboardRow[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<ArenaQuestionPayload | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [hasAnswered, setHasAnswered] = useState(false)
  const [myResponseMs, setMyResponseMs] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [revealData, setRevealData] = useState<ArenaRevealPayload | null>(null)
  const [finalRanking, setFinalRanking] = useState<ArenaLeaderboardRow[]>([])
  const [myXp, setMyXp] = useState<ArenaXpResult | null>(null)
  const [prepare, setPrepare] = useState<ArenaPreparePayload | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const myTeamIdRef = useRef<string | null>(null)
  const lastJoinPayloadRef = useRef<JoinPayload | null>(null)
  const hasJoinedRef = useRef(false)

  const getServerNow = useServerClock(socket)
  const countdown = useArenaCountdown(
    currentQuestion?.deadlineAtMs ?? null,
    currentQuestion?.startedAtMs ?? null,
    getServerNow,
  )
  // Đội mình chưa gửi đáp án khi hết giờ mới nghe chuông — đã gửi rồi thì thôi.
  useArenaCountdownSound(
    countdown.seconds,
    countdown.isExpired,
    !hasAnswered,
    currentQuestion?.roundId,
    view === 'game' && !revealData,
  )

  const { data: preview, isLoading: previewLoading, isError: previewFailed } = useQuery<SessionPreview>({
    queryKey: ['arena-join-preview', joinCode],
    queryFn: () => api.get(`/arena/join/${joinCode}`).then((r) => r.data),
    retry: false,
  })

  useEffect(() => () => { socketRef.current?.disconnect() }, [])

  const myScore = lobbyTeams.find((t) => t.id === myTeamId)?.score ?? 0
  const myRevealResult = revealData?.results.find((r) => r.teamId === myTeamId)
  const presetTeams = preview?.teams.filter((t) => t.isPreset) ?? []

  // ─── Dựng lại toàn bộ view từ snapshot arena.state (F5/rớt mạng giữa trận) ──
  const applyState = useCallback((state: ArenaStatePayload) => {
    setLeaderboard(state.teams)
    setLobbyTeams((prev) => (prev.length > 0 ? prev : state.teams as unknown as ArenaTeam[]))
    if (state.myTeamId) {
      setMyTeamId(state.myTeamId)
      myTeamIdRef.current = state.myTeamId
      if (state.myTeamName) setTeamName(state.myTeamName)
      if (state.myTeamColor) setMyTeamColor(state.myTeamColor)
    }
    if (state.currentQuestion) {
      setPrepare(null)
      setCurrentQuestion(state.currentQuestion)
      setRevealData(null)
      setLocked(false)
      if (state.myAnswer) {
        setHasAnswered(true)
        setSelected(state.myAnswer.selectedOptionIds)
        setMyResponseMs(state.myAnswer.responseMs)
      } else {
        setHasAnswered(false)
        setSelected([])
        setMyResponseMs(null)
      }
      setView('game')
    } else if (state.lastReveal) {
      setCurrentQuestion(null)
      setRevealData(state.lastReveal)
      setLeaderboard(state.lastReveal.leaderboard)
      setView('game')
    } else if (state.final) {
      setFinalRanking(state.final.ranking)
      setView('result')
    } else if (state.status === 'RUNNING') {
      setView('game')
    } else if (state.status === 'LOBBY') {
      setView('lobby')
    }
  }, [])

  const handleJoin = useCallback(() => {
    const usePreset = presetTeams.length > 0
    if (usePreset) {
      if (!selectedTeamId) { setJoinError('Chọn 1 đội để tham gia'); return }
    } else {
      const name = teamName.trim()
      if (!name) { setJoinError('Nhập tên đội/tên bạn để tham gia'); return }
    }
    if (preview?.requiresPasscode && !passcode.trim()) {
      setJoinError('Phòng này yêu cầu mật khẩu — nhập mật khẩu do MC cung cấp')
      return
    }

    setJoining(true)
    setJoinError('')
    hasJoinedRef.current = false
    lastJoinPayloadRef.current = {
      joinCode,
      teamName: usePreset ? undefined : teamName.trim(),
      teamId: usePreset ? selectedTeamId! : undefined,
      passcode: passcode.trim() || undefined,
    }

    const s = createArenaSocket()
    socketRef.current = s
    setSocket(s)

    s.on('connect_error', () => {
      if (!hasJoinedRef.current) {
        setJoining(false)
        setJoinError('Không kết nối được máy chủ, thử lại')
      }
    })

    s.on('arena.state', (state: ArenaStatePayload) => applyState(state))

    s.on('arena.team_joined', ({ team }: { team: ArenaTeam }) => {
      setLobbyTeams((prev) => [...prev.filter((t) => t.id !== team.id), { ...team, score: 0 }])
    })

    s.on('arena.teams_updated', ({ teams }: { teams: ArenaTeam[] }) => {
      setLobbyTeams(teams)
    })

    s.on('arena.started', () => setView('game'))

    s.on('arena.you_were_kicked', () => {
      setView('kicked')
      s.disconnect()
      socketRef.current = null
    })

    // MC gộp mình vào 1 đội khác, hoặc chuyển mình sang đội khác — đồng bộ lại tên/màu đội đang hiển thị
    const syncTeamChange = ({ teamId, teamName: newName, teamColor }: { teamId: string; teamName: string; teamColor: string }) => {
      setMyTeamId(teamId)
      myTeamIdRef.current = teamId
      setTeamName(newName)
      setMyTeamColor(teamColor)
    }
    s.on('arena.you_were_merged', syncTeamChange)
    s.on('arena.you_were_moved', syncTeamChange)

    // Đồng đội khác đã trả lời thay cả đội — không để mình treo ở màn hình chọn đáp án
    s.on('arena.team_answered', () => {
      setHasAnswered(true)
    })

    s.on('arena.prepare', (p: ArenaPreparePayload) => {
      setCurrentQuestion(null)
      setSelected([])
      setHasAnswered(false)
      setMyResponseMs(null)
      setRevealData(null)
      setLocked(false)
      setPrepare(p)
      setView('game')
    })

    s.on('arena.question', (q: ArenaQuestionPayload) => {
      setPrepare(null)
      setCurrentQuestion(q)
      setSelected([])
      setHasAnswered(false)
      setMyResponseMs(null)
      setRevealData(null)
      setLocked(false)
      setView('game')
    })

    s.on('arena.locked', () => setLocked(true))

    s.on('arena.revealed', (data: ArenaRevealPayload) => {
      setRevealData(data)
      setLeaderboard(data.leaderboard)
      setLobbyTeams(data.leaderboard as unknown as ArenaTeam[])
      setLocked(false)
      const mine = data.results.find((r) => r.teamId === myTeamIdRef.current)
      if (mine) {
        if (mine.outcome === 'correct') {
          void playCorrectSound()
          if (mine.isFastestCorrect) {
            void playFastestSound()
            void fireGoldSparkle()
          }
        } else if (mine.outcome === 'wrong') {
          void playWrongSound()
        }
      }
    })

    s.on('arena.leaderboard', ({ teams }: { teams: ArenaLeaderboardRow[] }) => {
      setLeaderboard(teams)
      setLobbyTeams(teams as unknown as ArenaTeam[])
    })

    s.on('arena.ended', ({ ranking, xpResults }: { ranking: ArenaLeaderboardRow[]; xpResults?: Record<string, ArenaXpResult> }) => {
      setPrepare(null)
      setFinalRanking(ranking)
      if (user && xpResults?.[user.id]) setMyXp(xpResults[user.id])
      setView('result')
      const mine = ranking.find((t) => t.teamId === myTeamIdRef.current)
      if (mine?.rank === 1) {
        void playWinSound()
        void fireConfettiBurst()
      }
    })

    // Đăng ký TRƯỚC lần connect đầu tiên — cùng 1 luồng xử lý cho join lần đầu
    // LẪN tự vào lại sau khi socket.io reconnect (mất mạng/F5). Server luôn
    // trả arena.state ngay sau khi join thành công nên applyState() tự dựng
    // lại đúng câu hỏi/deadline/đáp án đã gửi mà không cần logic riêng.
    s.on('connect', () => {
      s.emit(
        'arena.join',
        lastJoinPayloadRef.current,
        (res: { ok?: boolean; teamId?: string; teamName?: string; teamColor?: string; error?: string }) => {
          if (!hasJoinedRef.current) setJoining(false)
          if (!res?.ok) {
            if (!hasJoinedRef.current) {
              setJoinError(res?.error ?? 'Tham gia thất bại')
              s.disconnect()
              socketRef.current = null
            }
            return
          }
          hasJoinedRef.current = true
          setMyTeamId(res.teamId!)
          myTeamIdRef.current = res.teamId!
          setTeamName(res.teamName!)
          setMyTeamColor(res.teamColor!)
          setView((prev) => (prev === 'join' ? 'lobby' : prev))
        },
      )
    })
  }, [joinCode, teamName, passcode, selectedTeamId, presetTeams.length, preview?.requiresPasscode, user, applyState])

  function toggleOption(optionId: string, questionType: 'SINGLE' | 'MULTIPLE' | 'ORDERING') {
    if (hasAnswered || locked) return
    if (questionType === 'SINGLE') {
      // Câu 1 đáp án: chọn là chốt luôn, gửi ngay không cần bấm thêm nút "Gửi đáp án"
      setSelected([optionId])
      submitAnswer([optionId])
      return
    }
    setSelected((prev) => (prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]))
  }

  function submitAnswer(overrideSelected?: string[]) {
    const finalSelected = overrideSelected ?? selected
    if (!currentQuestion || finalSelected.length === 0 || !myTeamIdRef.current || locked) return
    setHasAnswered(true)
    socketRef.current?.emit(
      'arena.answer',
      { arenaRoundId: currentQuestion.roundId, selectedOptionIds: finalSelected },
      (res: { ok?: boolean; responseMs?: number; error?: string }) => {
        if (res?.ok && res.responseMs != null) setMyResponseMs(res.responseMs)
        if (!res?.ok) setHasAnswered(false)
      },
    )
  }

  // ─── Nội dung theo view ──────────────────────────────────────────────────
  // Gom thành 1 điểm return duy nhất để chỉ vẽ topbar (brand + nút Thoát) một lần,
  // thay vì lặp lại ở mỗi nhánh view như trước.

  let body: React.ReactNode

  if (view === 'join') {
    if (previewLoading) {
      body = <CenterCard key={view}><Spin size="large" /></CenterCard>
    } else if (previewFailed || !preview) {
      body = (
        <CenterCard key={view}>
          <Result status="error" title="Mã tham gia không hợp lệ" subTitle="Kiểm tra lại mã hoặc quét lại mã QR từ MC." />
        </CenterCard>
      )
    } else if (preview.status === 'FINISHED') {
      body = (
        <CenterCard key={view}>
          <Result status="warning" title="Phiên đấu đã kết thúc" subTitle="Không thể tham gia lúc này." />
        </CenterCard>
      )
    } else {
      body = (
        <CenterCard key={view}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <TrophyOutlined style={{ fontSize: 40, color: '#faad14' }} />
            <Title level={3} style={{ margin: '8px 0 0' }}>{preview.name}</Title>
            <Text type="secondary">{preview.quiz.title}</Text>
            {(preview.requiresPasscode || preview.isInviteOnly) && (
              <Space style={{ marginTop: 6 }}>
                {preview.requiresPasscode && <Tag icon={<LockOutlined />} color="gold">Phòng yêu cầu mật khẩu</Tag>}
                {preview.isInviteOnly && <Tag icon={<MailOutlined />} color="purple">Chỉ dành cho người được mời</Tag>}
              </Space>
            )}
            {preview.status === 'RUNNING' && (
              <Alert
                style={{ marginTop: 12, textAlign: 'left' }}
                type="info"
                showIcon
                message="Phiên đang chạy — bạn vẫn tham gia được nếu MC cho phép, hoặc vào lại nếu bạn đã từng tham gia."
              />
            )}
          </div>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {presetTeams.length > 0 ? (
              <div>
                <Text strong>Chọn đội để tham gia</Text>
                <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={8}>
                  {presetTeams.map((t) => {
                    const isFull = t.memberCount >= 5
                    const isSelected = selectedTeamId === t.id
                    return (
                      <Button
                        key={t.id}
                        block size="large"
                        type={isSelected ? 'primary' : 'default'}
                        disabled={isFull}
                        onClick={() => setSelectedTeamId(t.id)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <Space>
                          <Avatar size="small" style={{ backgroundColor: t.color }}>{t.name[0]?.toUpperCase()}</Avatar>
                          {t.name}
                        </Space>
                        <Tag color={isFull ? 'red' : undefined}>{isFull ? 'Đầy' : `${t.memberCount}/5`}</Tag>
                      </Button>
                    )
                  })}
                </Space>
              </div>
            ) : (
              <div>
                <Text strong>Tên đội / tên bạn</Text>
                <Input
                  size="large"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  onPressEnter={handleJoin}
                  maxLength={30}
                  placeholder="VD: Đội Tín dụng"
                />
              </div>
            )}
            {preview.requiresPasscode && (
              <div>
                <Text strong>Mật khẩu phòng</Text>
                <Input.Password
                  size="large"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  onPressEnter={handleJoin}
                  placeholder="MC cung cấp mật khẩu để vào phòng"
                />
              </div>
            )}
            {joinError && <Alert type="error" message={joinError} showIcon />}
            <Button type="primary" size="large" block loading={joining} onClick={handleJoin} icon={<ThunderboltOutlined />}>
              Tham gia ngay
            </Button>
            <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', display: 'block' }}>
              Đã có {preview.teams.length} đội tham gia
            </Text>
          </Space>
        </CenterCard>
      )
    }
  } else if (view === 'lobby') {
    body = (
      <CenterCard key={view}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Spin size="large" />
          <Title level={4} style={{ marginTop: 16 }}>Đã tham gia! Đang chờ MC bắt đầu…</Title>
          <Tag color={myTeamColor} style={{ fontSize: 14, padding: '4px 12px', marginTop: 8 }}>{teamName}</Tag>
        </div>
        <Text strong>Các đội trong phòng ({lobbyTeams.length})</Text>
        <List
          style={{ marginTop: 8 }}
          dataSource={lobbyTeams}
          renderItem={(team) => {
            const members = team.members ?? []
            return (
              <List.Item>
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <Space>
                    <Avatar size="small" style={{ backgroundColor: team.color }}>{team.name[0]?.toUpperCase()}</Avatar>
                    <Text strong={team.id === myTeamId}>{team.name}{team.id === myTeamId ? ' (bạn)' : ''}</Text>
                    {members.length > 1 && <Tag icon={<TeamOutlined />} style={{ marginLeft: 4 }}>{members.length} người</Tag>}
                  </Space>
                  {members.length > 1 && (
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 28 }}>{members.map((m) => m.fullName).join(', ')}</Text>
                  )}
                </Space>
              </List.Item>
            )
          }}
        />
      </CenterCard>
    )
  } else if (view === 'game' && prepare) {
    body = (
      <div key={`prepare-${prepare.roundId}`} className="arena-view-transition" style={{ maxWidth: 560, margin: '0 auto', padding: '16px 12px' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
          <Tag color={myTeamColor}>{teamName}</Tag>
          <Text strong>{myScore} điểm</Text>
        </Space>
        <Card style={{ textAlign: 'center', padding: '24px 0' }}>
          <Text type="secondary">Câu {prepare.order + 1}/{prepare.totalRounds}</Text>
          <div style={{ margin: '4px 0 16px' }}><Text type="secondary">Lĩnh vực</Text></div>
          <Text strong style={{ fontSize: 24, display: 'block', marginBottom: 20 }}>
            {prepare.subjectName ?? 'Chưa phân loại lĩnh vực'}
          </Text>
          <Spin />
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">Chuẩn bị tinh thần nhé — câu hỏi sắp hiện ra!</Text>
          </div>
        </Card>
      </div>
    )
  } else if (view === 'game' && currentQuestion) {
    const isRevealed = !!revealData
    body = (
      <div key={currentQuestion.roundId} className="arena-view-transition" style={{ maxWidth: 560, margin: '0 auto', padding: '16px 12px' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
          <Tag color={myTeamColor}>{teamName}</Tag>
          <Space size={12}>
            {!isRevealed && <ArenaCountdownRing {...countdown} size={72} />}
            <Text strong>{myScore} điểm</Text>
          </Space>
        </Space>

        {isRevealed && myRevealResult && (
          <Alert
            style={{ marginBottom: 12 }}
            type={myRevealResult.outcome === 'correct' ? 'success' : myRevealResult.outcome === 'wrong' ? 'error' : 'warning'}
            showIcon
            message={
              myRevealResult.outcome === 'correct'
                ? `Chính xác! +${myRevealResult.pointsDelta} điểm — bạn trả lời sau ${formatResponseTime(myRevealResult.responseMs)}${myRevealResult.isFastestCorrect ? ' 👑 Nhanh nhất!' : ''}`
                : myRevealResult.outcome === 'wrong'
                  ? `Sai rồi${myRevealResult.pointsDelta < 0 ? ` — ${myRevealResult.pointsDelta} điểm` : ''}`
                  : 'Bạn chưa trả lời câu này'
            }
          />
        )}
        {!isRevealed && hasAnswered && myResponseMs != null && (
          <Alert style={{ marginBottom: 12 }} type="info" showIcon message={`Đã gửi sau ${formatResponseTime(myResponseMs)} — chờ công bố…`} />
        )}

        <Card>
          {currentQuestion.question.subjectName && (
            <Tag color="green" style={{ marginBottom: 8 }}>Lĩnh vực: {currentQuestion.question.subjectName}</Tag>
          )}
          {currentQuestion.question.imageUrl && (
            <img
              src={currentQuestion.question.imageUrl}
              alt=""
              style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, margin: '4px 0 8px', display: 'block' }}
            />
          )}
          <Text strong style={{ fontSize: 17, display: 'block' }}>{currentQuestion.question.content}</Text>
          <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 18 }}>
            {currentQuestion.question.options.map((opt, idx) => {
              const isSelected = selected.includes(opt.id)
              const isCorrectOpt = revealData?.correctOptionIds.includes(opt.id)
              const disabled = hasAnswered || isRevealed || locked

              return (
                <button
                  key={opt.id}
                  disabled={disabled}
                  onClick={() => toggleOption(opt.id, currentQuestion.question.questionType)}
                  className={isRevealed ? undefined : `arena-option-${idx % 4}`}
                  style={{
                    width: '100%', textAlign: 'left', border: isSelected ? '3px solid #4E0D1A' : '3px solid transparent',
                    background: isRevealed ? (isCorrectOpt ? '#52c41a' : (isSelected ? '#ff4d4f' : '#bfbfbf')) : undefined,
                    color: '#fff', borderRadius: 10, padding: '16px 18px',
                    fontSize: 15, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
                    opacity: hasAnswered && !isSelected && !isRevealed ? 0.5 : 1,
                  }}
                >
                  {String.fromCharCode(65 + idx)}. {opt.content}
                  {isRevealed && isCorrectOpt && <CheckCircleOutlined style={{ marginLeft: 8 }} />}
                </button>
              )
            })}
          </Space>

          {!hasAnswered && !isRevealed && !locked && currentQuestion.question.questionType !== 'SINGLE' && (
            <Button
              type="primary" size="large" block style={{ marginTop: 18 }}
              disabled={selected.length === 0}
              onClick={() => submitAnswer()}
            >
              Gửi đáp án
            </Button>
          )}
          {!hasAnswered && !isRevealed && locked && (
            <div style={{ textAlign: 'center', marginTop: 18 }}>
              <Text type="secondary">Đã hết giờ — chờ MC công bố kết quả…</Text>
            </div>
          )}
          {hasAnswered && !isRevealed && (
            <div style={{ textAlign: 'center', marginTop: 18 }}>
              <Spin /> <Text type="secondary" style={{ marginLeft: 8 }}>Đã gửi — chờ công bố kết quả…</Text>
            </div>
          )}
          {isRevealed && (
            <div style={{ marginTop: 18 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Kết quả cả phòng</Text>
              <ArenaRevealBoard results={revealData.results} myTeamId={myTeamId} />
            </div>
          )}
        </Card>

        {isRevealed && (
          <Card style={{ marginTop: 12 }} title="Bảng điểm">
            <ArenaLeaderboard teams={leaderboard} highlightTeamId={myTeamId} compact />
          </Card>
        )}
      </div>
    )
  } else if (view === 'result') {
    const myRank = finalRanking.find((t) => t.teamId === myTeamId)
    body = (
      <CenterCard key={view}>
        <div style={{ textAlign: 'center' }}>
          <Title level={3}><TrophyOutlined style={{ color: '#faad14' }} /> Kết quả Đấu trường</Title>
          {myRank && (
            <div style={{ margin: '16px 0' }}>
              <RankMedal rank={myRank.rank ?? 99} />
              <div style={{ marginTop: 4 }}>
                <Text strong style={{ fontSize: 18 }}>Hạng {myRank.rank}</Text> — <Text>{myRank.score} điểm</Text>
              </div>
            </div>
          )}
          {myXp && (
            <Alert
              style={{ marginTop: 8, textAlign: 'left' }}
              type={myXp.levelUp ? 'success' : 'info'}
              showIcon
              message={myXp.levelUp ? `🎉 Lên cấp ${myXp.newLevel}!` : 'Đã cộng điểm kinh nghiệm'}
              description={myXp.newBadges.length > 0 ? `Mở khóa huy hiệu: ${myXp.newBadges.map((b) => b.name).join(', ')}` : undefined}
            />
          )}
          <Text strong style={{ display: 'block', marginTop: 20 }}>Bảng xếp hạng chung</Text>
          <List
            style={{ marginTop: 8, textAlign: 'left' }}
            dataSource={finalRanking}
            renderItem={(team) => (
              <List.Item>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space>
                    <Text style={{ minWidth: 24 }}>#{team.rank}</Text>
                    <Avatar size="small" style={{ backgroundColor: team.teamColor }}>{team.teamName[0]?.toUpperCase()}</Avatar>
                    <Text strong={team.teamId === myTeamId}>{team.teamName}</Text>
                  </Space>
                  <Text>{team.score} đ</Text>
                </Space>
              </List.Item>
            )}
          />
          <Button style={{ marginTop: 20 }} icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
            Về trang chủ
          </Button>
        </div>
      </CenterCard>
    )
  } else if (view === 'kicked') {
    body = (
      <CenterCard key={view}>
        <Result
          status="warning"
          title="Bạn đã bị mời ra khỏi phòng"
          subTitle="MC đã đưa bạn ra khỏi phiên đấu này. Liên hệ MC nếu đây là nhầm lẫn."
          extra={<Button type="primary" onClick={() => navigate('/')}>Về trang chủ</Button>}
        />
      </CenterCard>
    )
  } else {
    body = <CenterCard key={view}><Spin size="large" /></CenterCard>
  }

  return (
    <div className="arena-player-shell arena-stage">
      <header className="arena-player-topbar">
        <span className="arena-player-brand"><BankOutlined /> 3800Quiz</span>
        <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>Thoát</Button>
      </header>
      {body}
    </div>
  )
}

// ─── Hàm hỗ trợ bố cục ──────────────────────────────────────────────────────

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="arena-view-transition" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 420 }}>
        {children}
      </Card>
    </div>
  )
}
