import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Skeleton, Space, Switch, Tag, Typography } from 'antd'
import { AudioMutedOutlined, AudioOutlined, EyeOutlined } from '@ant-design/icons'
import type { Socket } from 'socket.io-client'
import api, { getErrorMessage } from '../lib/api'
import { createArenaSocket } from '../lib/arena-socket'
import { useServerClock } from '../hooks/useServerClock'
import { useArenaCountdown } from '../hooks/useArenaCountdown'
import { ArenaCountdownRing } from '../components/ArenaCountdownRing'
import { ArenaRevealBoard } from '../components/ArenaRevealBoard'
import { ArenaLeaderboard } from '../components/ArenaLeaderboard'
import {
  baoDangDoc,
  dangBatGiongDoc,
  datGiongDoc,
  docLanLuot,
  dungGiongDoc,
  moiGiongDoc,
  theoDoiGiongDocONoiKhac,
} from '../lib/giong-doc'
import type {
  ArenaStatePayload,
  ArenaQuestionPayload,
  ArenaPreparePayload,
  ArenaRevealPayload,
  ArenaEndPayload,
  ArenaLeaderboardRow,
} from '../lib/arena-types'

const { Title, Text } = Typography

/**
 * Chế độ khán giả — xem trực tiếp Đấu trường qua joinCode, KHÔNG tham gia đội,
 * không trả lời được (không có teamId để buzz-in). Dùng chiếu màn hình lớn ở
 * hội trường. Tái dùng nguyên các component hiển thị đã có (Countdown/Reveal/
 * Leaderboard) — không đụng logic chơi thật ở ArenaPage.tsx/ArenaPlayerPage.tsx.
 */
export default function ArenaSpectatorPage() {
  const { joinCode } = useParams<{ joinCode: string }>()
  const [sessionInfo, setSessionInfo] = useState<{ id: string; name: string; quizTitle: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<ArenaLeaderboardRow[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<ArenaQuestionPayload | null>(null)
  const [prepare, setPrepare] = useState<ArenaPreparePayload | null>(null)
  const [lastReveal, setLastReveal] = useState<ArenaRevealPayload | null>(null)
  const [final, setFinal] = useState<ArenaEndPayload | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const getServerNow = useServerClock(socket)

  // Đây là màn "trình chiếu" — nơi ĐÚNG NHẤT để bật giọng đọc (1 nguồn, qua loa
  // hội trường), khác với máy MC hay máy người chơi (xem TinhNang.md). Mặc định
  // TẮT; đọc qua ref vì handler socket đăng ký 1 lần trong effect [joinCode],
  // đọc thẳng state đóng băng sẽ bị "cũ" nếu người dùng đổi công tắc giữa chừng.
  const [narrationOn, setNarrationOn] = useState(() => dangBatGiongDoc('arena-spectator'))
  const narrationOnRef = useRef(narrationOn)
  useEffect(() => {
    narrationOnRef.current = narrationOn
  }, [narrationOn])
  // localStorage nhớ công tắc ĐANG bật từ phiên trước, nhưng mỗi lần tải trang
  // mới trình duyệt CHƯA được "mồi" quyền autoplay — phải hiện lớp phủ xin bấm.
  const [daMoiAutoplay, setDaMoiAutoplay] = useState(false)
  const countdown = useArenaCountdown(
    currentQuestion?.deadlineAtMs ?? null,
    currentQuestion?.startedAtMs ?? null,
    getServerNow,
  )

  useEffect(() => {
    if (!joinCode) return
    let cancelled = false

    api.get(`/arena/join/${joinCode}`).then((r) => {
      if (cancelled) return
      const s = r.data as { id: string; name: string; quiz: { title: string } }
      setSessionInfo({ id: s.id, name: s.name, quizTitle: s.quiz.title })

      const sock = createArenaSocket()
      socketRef.current = sock
      setSocket(sock)
      sock.on('connect', () => {
        sock.emit('arena.spectate', { sessionId: s.id }, (ack: { error?: string }) => {
          if (ack?.error) setError(ack.error)
        })
      })
      sock.on('arena.state', (state: ArenaStatePayload) => {
        setTeams(state.teams)
        setCurrentQuestion(state.currentQuestion)
        setLastReveal(state.lastReveal)
        setFinal(state.final)
      })
      sock.on('arena.prepare', (p: ArenaPreparePayload) => {
        setPrepare(p)
        setCurrentQuestion(null)
        setLastReveal(null)
        dungGiongDoc()
        if (narrationOnRef.current) {
          void docLanLuot(['Lĩnh vực', p.subjectName ?? 'Chưa phân loại'], {
            maxMs: Math.max(0, p.prepareSec * 1000 - 300),
          })
        }
      })
      sock.on('arena.question', (q: ArenaQuestionPayload) => {
        setPrepare(null)
        setCurrentQuestion(q)
        setLastReveal(null)
        dungGiongDoc()
        // Đấu trường CHỈ đọc đề bài, không đọc đáp án (đã hiện to trên màn hình,
        // và mỗi câu chỉ có ~20s — đọc thêm 4 đáp án dễ vượt quá thời gian).
        if (narrationOnRef.current) {
          void docLanLuot([q.question.content], { maxMs: q.deadlineAtMs - q.serverNowMs - 2000 })
        }
      })
      sock.on('arena.locked', () => dungGiongDoc())
      sock.on('arena.revealed', (r: ArenaRevealPayload) => {
        setLastReveal(r)
        setTeams(r.leaderboard)
        dungGiongDoc()
      })
      sock.on('arena.ended', (e: ArenaEndPayload) => {
        setFinal(e)
        setTeams(e.ranking)
        dungGiongDoc()
      })
    }).catch((e) => setError(getErrorMessage(e, 'Không tìm thấy phiên đấu trường')))

    return () => {
      cancelled = true
      socketRef.current?.disconnect()
      socketRef.current = null
      dungGiongDoc()
    }
  }, [joinCode])

  // Máy MC hoặc chính trang này mở ở tab khác trên CÙNG máy cũng đang đọc —
  // tự tắt công tắc của mình, tránh 2 nguồn tiếng chồng nhau qua 1 loa.
  useEffect(() => {
    return theoDoiGiongDocONoiKhac((phamVi) => {
      if (phamVi !== 'arena-spectator' && narrationOnRef.current) {
        dungGiongDoc()
        setNarrationOn(false)
        datGiongDoc('arena-spectator', false)
      }
    })
  }, [])

  const toggleNarration = () => {
    setNarrationOn((on) => {
      const next = !on
      if (next) {
        // Bắt buộc gọi TRONG handler click — chỉ cử chỉ bấm tay mới mở khoá
        // được quyền autoplay cho các lần phát bằng code về sau.
        moiGiongDoc()
        setDaMoiAutoplay(true)
        baoDangDoc('arena-spectator')
      } else {
        dungGiongDoc()
      }
      datGiongDoc('arena-spectator', next)
      return next
    })
  }

  if (error) return <Alert type="error" message={error} showIcon style={{ margin: 24 }} />
  if (!sessionInfo) return <Skeleton active style={{ padding: 24 }} />

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', position: 'relative' }}>
      {narrationOn && !daMoiAutoplay && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            moiGiongDoc()
            setDaMoiAutoplay(true)
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, cursor: 'pointer',
            background: 'rgba(0, 0, 0, 0.72)', color: '#fff',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
          }}
        >
          <AudioOutlined style={{ fontSize: 48 }} />
          <Typography.Title level={3} style={{ color: '#fff', margin: 0 }}>Bấm để bật giọng đọc</Typography.Title>
          <Text style={{ color: 'rgba(255,255,255,0.75)' }}>
            Trình duyệt chỉ cho phát âm thanh sau khi có 1 lượt bấm trên trang
          </Text>
        </div>
      )}
      <Space style={{ marginBottom: 16 }} wrap>
        <Tag icon={<EyeOutlined />} color="blue">Khán giả</Tag>
        <Title level={3} style={{ margin: 0 }}>{sessionInfo.name}</Title>
        <span title={narrationOn ? 'Tắt giọng đọc' : 'Bật giọng đọc đề bài (chỉ nên bật ở MỘT máy — máy nối loa)'}>
          <Switch
            checked={narrationOn}
            onChange={toggleNarration}
            checkedChildren={<AudioOutlined />}
            unCheckedChildren={<AudioMutedOutlined />}
          />
        </span>
      </Space>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>Bộ đề: {sessionInfo.quizTitle}</Text>

      {final ? (
        <>
          <Title level={4}>Kết quả chung cuộc</Title>
          <ArenaLeaderboard teams={final.ranking} />
        </>
      ) : lastReveal ? (
        <>
          <Title level={4}>Câu {lastReveal.order + 1}/{lastReveal.totalRounds} — Đã công bố đáp án</Title>
          <ArenaRevealBoard results={lastReveal.results} />
          <Title level={5} style={{ marginTop: 24 }}>Bảng xếp hạng</Title>
          <ArenaLeaderboard teams={lastReveal.leaderboard} />
        </>
      ) : currentQuestion ? (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Title level={4} style={{ margin: 0 }}>Câu {currentQuestion.order + 1}/{currentQuestion.totalRounds}</Title>
            <ArenaCountdownRing ringRef={countdown.ringRef} seconds={countdown.seconds} isExpired={countdown.isExpired} />
          </Space>
          {currentQuestion.question.subjectName && <Tag color="green">Lĩnh vực: {currentQuestion.question.subjectName}</Tag>}
          <Title level={3}>{currentQuestion.question.content}</Title>
          <Space direction="vertical" style={{ width: '100%' }}>
            {currentQuestion.question.options.map((o) => (
              <Tag key={o.id} style={{ padding: '8px 16px', fontSize: 16 }}>{o.content}</Tag>
            ))}
          </Space>
          <Title level={5} style={{ marginTop: 24 }}>Bảng xếp hạng</Title>
          <ArenaLeaderboard teams={teams} />
        </>
      ) : prepare ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Text type="secondary">Câu {prepare.order + 1}/{prepare.totalRounds}</Text>
          <Title level={2}>Lĩnh vực: {prepare.subjectName ?? 'Chưa phân loại'}</Title>
          <Text>Chuẩn bị tinh thần — câu hỏi sắp hiện ra...</Text>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Text type="secondary">Đang chờ MC bắt đầu phiên đấu...</Text>
          {teams.length > 0 && (
            <>
              <Title level={5} style={{ marginTop: 24 }}>Các đội tham gia</Title>
              <ArenaLeaderboard teams={teams} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
