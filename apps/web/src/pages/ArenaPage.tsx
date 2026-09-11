import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Card, Col, Form, InputNumber, Row, Select, Space, Spin, Table, Tag,
  Typography, Divider, Alert, List, Modal, Input, Radio, Switch,
  Avatar, Popconfirm, message, Checkbox,
} from 'antd'
import {
  TrophyOutlined, TeamOutlined, PlayCircleOutlined, CheckCircleOutlined,
  ArrowRightOutlined, StopOutlined, CopyOutlined, ReloadOutlined,
  DeleteOutlined, LockOutlined, SafetyOutlined, UserDeleteOutlined,
  UsergroupAddOutlined, MailOutlined, PlusOutlined, SwapOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import type { Socket } from 'socket.io-client'
import { useQuery } from '@tanstack/react-query'
import api, { getErrorMessage } from '../lib/api'
import { createArenaSocket } from '../lib/arena-socket'
import { useServerClock } from '../hooks/useServerClock'
import { useArenaCountdown } from '../hooks/useArenaCountdown'
import { ArenaCountdownRing } from '../components/ArenaCountdownRing'
import { ArenaBuzzStrip } from '../components/ArenaBuzzStrip'
import { ArenaRevealBoard } from '../components/ArenaRevealBoard'
import { ArenaLeaderboard } from '../components/ArenaLeaderboard'
import { fireGoldSparkle, playFastestSound } from '../lib/feedback-fx'
import type {
  ArenaTeam, ArenaQuestionPayload, ArenaPreparePayload, ArenaBuzzPayload,
  ArenaRevealPayload, ArenaLeaderboardRow, ArenaStatePayload,
} from '../lib/arena-types'

const { Title, Text } = Typography

// ─── Kiểu dữ liệu riêng của trang MC (không thuộc hợp đồng socket) ─────────

interface InvitedUser { id: string; user: { id: string; fullName: string } }
interface ArenaSession {
  id: string; name: string; joinCode: string; status: string
  hostMode: string; autoAdvanceSec: number
  questionDurationSec?: number; revealPauseSec?: number
  passcode?: string | null
  invites?: InvitedUser[]
  quiz: { id: string; title: string }
  teams: ArenaTeam[]
  rounds: { id: string; order: number }[]
}

type PageView = 'list' | 'create' | 'lobby' | 'game' | 'result'

// ─── Hàm hỗ trợ huy chương ────────────────────────────────────────────────────
function RankMedal({ rank }: { rank: number }) {
  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
  return <span style={{ fontSize: 20 }}>{medals[rank] ?? '🏅'}</span>
}

// ─── Component chính ──────────────────────────────────────────────────────────
export default function ArenaPage() {
  const [view, setView] = useState<PageView>('list')
  const [session, setSession] = useState<ArenaSession | null>(null)
  const [teams, setTeams] = useState<ArenaTeam[]>([])
  const [leaderboard, setLeaderboard] = useState<ArenaLeaderboardRow[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<ArenaQuestionPayload | null>(null)
  const [buzzes, setBuzzes] = useState<ArenaBuzzPayload[]>([])
  const [locked, setLocked] = useState(false)
  const [revealData, setRevealData] = useState<ArenaRevealPayload | null>(null)
  const [finalRanking, setFinalRanking] = useState<ArenaLeaderboardRow[]>([])
  const [prepare, setPrepare] = useState<ArenaPreparePayload | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const getServerNow = useServerClock(socket)
  const countdown = useArenaCountdown(
    currentQuestion?.deadlineAtMs ?? null,
    currentQuestion?.startedAtMs ?? null,
    getServerNow,
  )

  // ─── Dựng lại toàn bộ view từ snapshot arena.state (F5/rớt mạng giữa trận) ──
  const applyState = useCallback((state: ArenaStatePayload) => {
    setLeaderboard(state.teams)
    setTeams((prev) => (prev.length > 0 ? prev : state.teams as unknown as ArenaTeam[]))
    if (state.currentQuestion) {
      setCurrentQuestion(state.currentQuestion)
      setBuzzes(state.buzzes)
      setRevealData(null)
      setPrepare(null)
      setLocked(false)
      setView('game')
    } else if (state.lastReveal) {
      setRevealData(state.lastReveal)
      setLeaderboard(state.lastReveal.leaderboard)
      setView('game')
    } else if (state.final) {
      setFinalRanking(state.final.ranking)
      setView('result')
    } else if (state.status === 'RUNNING') {
      setView('game')
    }
  }, [])

  // ─── Hàm hỗ trợ Socket ──────────────────────────────────────────────────────

  const connectSocket = useCallback((sessionId: string) => {
    sessionIdRef.current = sessionId
    const s = createArenaSocket()
    socketRef.current = s
    setSocket(s)

    const rehost = () => s.emit('arena.host', { sessionId })
    rehost()
    s.on('connect', rehost)

    s.on('arena.state', (state: ArenaStatePayload) => applyState(state))

    s.on('arena.team_joined', ({ team }: { team: ArenaTeam }) => {
      setTeams((prev) => [...prev.filter((t) => t.id !== team.id), { ...team, score: 0 }])
    })

    s.on('arena.teams_updated', ({ teams: t }: { teams: ArenaTeam[] }) => {
      setTeams(t)
    })

    s.on('arena.started', () => setView('game'))

    s.on('arena.prepare', (p: ArenaPreparePayload) => {
      setCurrentQuestion(null)
      setBuzzes([])
      setRevealData(null)
      setLocked(false)
      setPrepare(p)
    })

    s.on('arena.question', (q: ArenaQuestionPayload) => {
      setPrepare(null)
      setCurrentQuestion(q)
      setBuzzes([])
      setRevealData(null)
      setLocked(false)
    })

    s.on('arena.buzz_in', (buzz: ArenaBuzzPayload) => {
      setBuzzes((prev) => [...prev, buzz])
    })

    s.on('arena.locked', () => setLocked(true))

    s.on('arena.revealed', (data: ArenaRevealPayload) => {
      setRevealData(data)
      setLeaderboard(data.leaderboard)
      setLocked(false)
      if (data.fastestTeamId) {
        void playFastestSound()
        void fireGoldSparkle()
      }
    })

    s.on('arena.leaderboard', ({ teams: t }: { teams: ArenaLeaderboardRow[] }) => {
      setLeaderboard(t)
    })

    s.on('arena.ended', ({ ranking }: { ranking: ArenaLeaderboardRow[] }) => {
      setPrepare(null)
      setFinalRanking(ranking)
      setView('result')
    })
  }, [applyState])

  const disconnectSocket = useCallback(() => {
    socketRef.current?.disconnect()
    socketRef.current = null
    setSocket(null)
  }, [])

  useEffect(() => () => disconnectSocket(), [disconnectSocket])

  // ─── Hàm hỗ trợ emit Socket ─────────────────────────────────────────────────

  function emitStart() { socketRef.current?.emit('arena.start', { sessionId: session!.id }) }
  function emitReveal() { socketRef.current?.emit('arena.reveal', { sessionId: session!.id }) }
  function emitNext() { socketRef.current?.emit('arena.next', { sessionId: session!.id }) }
  function emitKick(teamId: string) { socketRef.current?.emit('arena.kick', { sessionId: session!.id, teamId }) }
  function emitKickMember(teamId: string, userId: string) {
    socketRef.current?.emit('arena.kick_member', { sessionId: session!.id, teamId, userId })
  }
  function emitMoveMember(userId: string, targetTeamId: string) {
    socketRef.current?.emit('arena.move_member', { sessionId: session!.id, userId, targetTeamId })
  }
  function emitMerge(teamIds: string[], teamName?: string) {
    socketRef.current?.emit('arena.merge', { sessionId: session!.id, teamIds, teamName })
  }
  function emitEnd() {
    Modal.confirm({
      title: 'Kết thúc phiên đấu?',
      content: 'Tất cả điểm số sẽ được chốt và hiển thị kết quả cuối.',
      okText: 'Kết thúc',
      okType: 'danger',
      onOk: () => socketRef.current?.emit('arena.end', { sessionId: session!.id }),
    })
  }

  // ─── Điều hướng view ──────────────────────────────────────────────────────

  if (view === 'list') return <SessionList onNew={() => setView('create')} onOpen={(s) => { setSession(s); setTeams(s.teams); connectSocket(s.id); setView('lobby') }} />
  if (view === 'create') return <CreateForm onCreated={(s) => { setSession(s); setTeams([]); connectSocket(s.id); setView('lobby') }} onBack={() => setView('list')} />
  if (view === 'lobby') return (
    <Lobby
      session={session!} teams={teams} onStart={emitStart} onKick={emitKick}
      onKickMember={emitKickMember} onMoveMember={emitMoveMember} onMerge={emitMerge}
      onBack={() => { disconnectSocket(); setView('list') }}
    />
  )
  if (view === 'game') return (
    <GameControl
      session={session!} leaderboard={leaderboard} currentQuestion={currentQuestion}
      buzzes={buzzes} locked={locked} revealData={revealData} countdown={countdown}
      prepare={prepare}
      onReveal={emitReveal} onNext={emitNext} onEnd={emitEnd}
    />
  )
  if (view === 'result') return <ResultScreen ranking={finalRanking} onBack={() => { disconnectSocket(); setView('list') }} />
  return null
}

// ─── SessionList ──────────────────────────────────────────────────────────────

function SessionList({ onNew, onOpen }: { onNew: () => void; onOpen: (s: ArenaSession) => void }) {
  const navigate = useNavigate()
  const { data, isLoading, refetch } = useQuery<ArenaSession[]>({
    queryKey: ['arena-sessions'],
    queryFn: () => api.get('/admin/arena-sessions').then((r) => r.data),
  })
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const statusColor: Record<string, string> = { LOBBY: 'blue', RUNNING: 'green', FINISHED: 'default' }
  const statusLabel: Record<string, string> = { LOBBY: 'Chờ', RUNNING: 'Đang chạy', FINISHED: 'Kết thúc' }

  async function handleCancel(id: string) {
    try {
      await api.patch(`/admin/arena-sessions/${id}/cancel`)
      message.success('Đã hủy phiên đấu')
      refetch()
    } catch (e) {
      message.error(getErrorMessage(e, 'Hủy thất bại'))
    }
  }

  async function handleStop(id: string) {
    try {
      await api.patch(`/admin/arena-sessions/${id}/stop`)
      message.success('Đã dừng phiên đấu')
      refetch()
    } catch (e) {
      message.error(getErrorMessage(e, 'Dừng thất bại'))
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/admin/arena-sessions/${id}`)
      message.success('Đã xóa phiên đấu')
      refetch()
    } catch (e) {
      message.error(getErrorMessage(e, 'Xóa thất bại'))
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    const ids = selectedKeys as string[]
    const results = await Promise.allSettled(ids.map((id) => api.delete(`/admin/arena-sessions/${id}`)))
    const failed = results.filter((r) => r.status === 'rejected').length
    setBulkDeleting(false)
    setSelectedKeys([])
    if (failed === 0) message.success(`Đã xóa ${ids.length} phiên`)
    else message.warning(`Xóa ${ids.length - failed}/${ids.length} phiên, ${failed} thất bại`)
    refetch()
  }

  const finishedIds = new Set((data ?? []).filter((s) => s.status === 'FINISHED').map((s) => s.id))

  return (
    <Card
      title={<Space><TrophyOutlined style={{ color: '#faad14' }} /><span>Đấu trường</span></Space>}
      extra={<Space><Button icon={<ReloadOutlined />} onClick={() => refetch()} /><Button type="primary" icon={<PlayCircleOutlined />} onClick={onNew}>Tạo phiên mới</Button></Space>}
    >
      {selectedKeys.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Text style={{ flex: 1 }}>Đã chọn <Text strong>{selectedKeys.length}</Text> phiên kết thúc</Text>
          <Button size="small" onClick={() => setSelectedKeys([])}>Bỏ chọn</Button>
          <Popconfirm
            title={`Xóa ${selectedKeys.length} phiên đấu?`}
            description="Toàn bộ dữ liệu kết quả sẽ bị xóa vĩnh viễn."
            okText="Xóa tất cả"
            okType="danger"
            cancelText="Quay lại"
            onConfirm={handleBulkDelete}
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={bulkDeleting}>
              Xóa {selectedKeys.length} phiên
            </Button>
          </Popconfirm>
        </div>
      )}
      <Spin spinning={isLoading}>
        <Table
          dataSource={data ?? []}
          rowKey="id"
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: setSelectedKeys,
            getCheckboxProps: (r: ArenaSession) => ({
              disabled: r.status !== 'FINISHED',
              title: r.status !== 'FINISHED' ? 'Chỉ có thể chọn phiên đã kết thúc' : undefined,
            }),
          }}
          columns={[
            { title: 'Tên phiên', dataIndex: 'name', render: (v, r: ArenaSession) => <><Text strong>{v}</Text><br /><Text type="secondary" style={{ fontSize: 12 }}>{r.quiz.title}</Text></> },
            {
              title: 'Mã vào', dataIndex: 'joinCode', render: (v, r: ArenaSession) => (
                <Space>
                  <Tag style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2, color: 'var(--agribank-red)', borderColor: 'var(--agribank-red)' }}>{v}</Tag>
                  {r.passcode && <Tag icon={<LockOutlined />} color="gold">Có mật khẩu</Tag>}
                </Space>
              )
            },
            { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={statusColor[v]}>{statusLabel[v] ?? v}</Tag> },
            { title: 'Số đội', render: (_: unknown, r: ArenaSession) => r.teams.length },
            {
              title: '', render: (_: unknown, r: ArenaSession) => (
                <Space>
                  <Button type="link" onClick={() => onOpen(r)}>
                    {r.status === 'FINISHED' ? 'Xem kết quả' : 'Vào phòng'}
                  </Button>
                  {r.status === 'FINISHED' && (
                    <Button type="link" onClick={() => navigate(`/manage/arena/${r.id}/replay`)}>
                      Xem lại chi tiết
                    </Button>
                  )}
                  {r.status === 'LOBBY' && (
                    <Popconfirm
                      title="Hủy phiên đấu?"
                      description="Phiên sẽ bị xóa và các đội đã tham gia sẽ bị mất."
                      okText="Hủy phiên"
                      okType="danger"
                      cancelText="Quay lại"
                      onConfirm={() => handleCancel(r.id)}
                    >
                      <Button type="link" danger>Hủy</Button>
                    </Popconfirm>
                  )}
                  {r.status === 'RUNNING' && (
                    <Popconfirm
                      title="Dừng phiên đấu?"
                      description="Phiên sẽ kết thúc ngay và tổng kết điểm hiện tại."
                      okText="Dừng"
                      okType="danger"
                      cancelText="Quay lại"
                      onConfirm={() => handleStop(r.id)}
                    >
                      <Button type="link" danger icon={<StopOutlined />}>Dừng</Button>
                    </Popconfirm>
                  )}
                  {r.status === 'FINISHED' && (
                    <Popconfirm
                      title="Xóa phiên đấu?"
                      description="Toàn bộ dữ liệu kết quả sẽ bị xóa vĩnh viễn."
                      okText="Xóa"
                      okType="danger"
                      cancelText="Quay lại"
                      onConfirm={() => handleDelete(r.id)}
                    >
                      <Button type="link" danger>Xóa</Button>
                    </Popconfirm>
                  )}
                </Space>
              )
            },
          ]}
        />
      </Spin>
      {finishedIds.size > 0 && selectedKeys.length === 0 && (
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Button size="small" type="text" style={{ color: '#aaa', fontSize: 12 }} onClick={() => setSelectedKeys([...finishedIds])}>
            Chọn tất cả phiên kết thúc ({finishedIds.size})
          </Button>
        </div>
      )}
    </Card>
  )
}

// ─── CreateForm ───────────────────────────────────────────────────────────────

interface Subject { id: string; name: string; _count?: { questions: number } }
interface SubjectRatio { subjectId?: string; percent: number }

/**
 * Quy đổi tỷ lệ % mỗi lĩnh vực thành số câu cụ thể, tổng luôn khớp chính xác
 * `total` (không lệch do làm tròn) — thuật toán số dư lớn nhất (Largest
 * Remainder Method), giống hệt trang Quản lý bộ đề (QuizzesPage.tsx) để 2 nơi
 * trộn câu hỏi theo tỷ lệ không lệch công thức nhau.
 */
function phanBoTheoTyLe(total: number, ratios: SubjectRatio[]): number[] {
  const raw = ratios.map((r) => (total * (r.percent || 0)) / 100)
  const counts = raw.map(Math.floor)
  let conThieu = total - counts.reduce((a, b) => a + b, 0)
  const thuTuPhanDu = raw
    .map((v, i) => ({ i, phanDu: v - counts[i] }))
    .sort((a, b) => b.phanDu - a.phanDu)
  for (let k = 0; k < thuTuPhanDu.length && conThieu > 0; k++, conThieu--) {
    counts[thuTuPhanDu[k].i]++
  }
  return counts
}

function CreateForm({ onCreated, onBack }: { onCreated: (s: ArenaSession) => void; onBack: () => void }) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const { data: quizzes } = useQuery<{ id: string; title: string }[]>({
    queryKey: ['quizzes-select'],
    queryFn: () => api.get('/admin/quizzes').then((r) => r.data),
  })
  const { data: users } = useQuery<{ id: string; fullName: string; username: string }[]>({
    queryKey: ['users-select'],
    queryFn: () => api.get('/admin/users').then((r) => r.data),
  })
  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ['subjects'],
    queryFn: () => api.get('/admin/subjects').then((r) => r.data),
  })

  async function onFinish(values: Record<string, unknown>) {
    setLoading(true)
    try {
      const passcode = (values.passcode as string | undefined)?.trim()
      const invitedUserIds = values.invitedUserIds as string[] | undefined
      const mixEnabled = values.mixEnabled as boolean | undefined

      let mixSlots: { subjectId?: string; count: number }[] | undefined
      let mixName: string | undefined
      let quizId: string | undefined
      if (mixEnabled) {
        const total = values.totalQuestionCount as number
        const ratios = (values.subjectRatios ?? []) as SubjectRatio[]
        const counts = phanBoTheoTyLe(total, ratios)
        mixSlots = ratios
          .map((r, i) => ({ subjectId: r.subjectId, count: counts[i] }))
          .filter((s) => s.count > 0)
        mixName = (values.mixName as string | undefined)?.trim() || undefined
      } else {
        quizId = values.quizId as string
      }

      const res = await api.post('/admin/arena-sessions', {
        name: values.name,
        quizId,
        mixName,
        mixSlots,
        hostMode: values.hostMode,
        questionDurationSec: values.questionDurationSec,
        revealPauseSec: values.revealPauseSec,
        penaltyWrong: values.penaltyWrong,
        presetTeamNames: values.presetTeamNames,
        passcode: passcode || undefined,
        invitedUserIds: invitedUserIds?.length ? invitedUserIds : undefined,
        pointsForRank: (values.pointsForRank as string).split(',').map((v) => parseInt(v.trim())),
      })
      onCreated(res.data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title={<Space><TrophyOutlined /><span>Tạo phiên Đấu trường</span></Space>}
      extra={<Button onClick={onBack}>Quay lại</Button>} style={{ maxWidth: 600, margin: '0 auto' }}>
      <Form form={form} layout="vertical" onFinish={onFinish}
        initialValues={{
          hostMode: 'MANUAL', questionDurationSec: 20, revealPauseSec: 5,
          pointsForRank: '10,7,5,3,2,2,2,2,2,2', penaltyWrong: 0,
          mixEnabled: false, subjectRatios: [{ percent: 100 }],
        }}>
        <Form.Item name="name" label="Tên phiên" rules={[{ required: true }]}>
          <Input placeholder="VD: Đấu trường Tháng 5 — Tín dụng" />
        </Form.Item>

        <Form.Item name="mixEnabled" label="Trộn câu hỏi theo tỷ lệ lĩnh vực" valuePropName="checked"
          tooltip='Bật để tự lấy ngẫu nhiên câu hỏi từ ngân hàng theo tỷ lệ % mỗi lĩnh vực bạn ấn định — VD: 40% Tín dụng, 60% CNTT — thay vì chọn 1 bộ đề có sẵn.'>
          <Switch />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.mixEnabled !== cur.mixEnabled}>
          {() => form.getFieldValue('mixEnabled') ? (
            <>
              <Form.Item name="mixName" label="Tên bộ đề trộn (tuỳ chọn)">
                <Input placeholder="Để trống sẽ tự đặt tên theo thời điểm tạo" maxLength={200} />
              </Form.Item>
              <Form.Item name="totalQuestionCount" label="Tổng số câu hỏi" rules={[{ required: true, message: 'Nhập tổng số câu hỏi' }]}>
                <InputNumber min={1} max={500} style={{ width: 160 }} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.subjectRatios?.length !== cur.subjectRatios?.length}>
                {() => {
                  const soLuongDong = (form.getFieldValue('subjectRatios') as SubjectRatio[] | undefined)?.length ?? 1
                  const chiMot = soLuongDong <= 1
                  return (
                    <Form.Item label={chiMot ? 'Lĩnh vực' : 'Tỷ lệ theo lĩnh vực (tổng phải đúng 100%)'}>
                      <Form.List name="subjectRatios" rules={[{
                        validator: async (_, ratios: SubjectRatio[]) => {
                          if (!ratios || ratios.length === 0) return Promise.reject(new Error('Thêm ít nhất 1 lĩnh vực'))
                          const total = ratios.reduce((s, r) => s + (r?.percent || 0), 0)
                          if (Math.round(total) !== 100) return Promise.reject(new Error(`Tổng tỷ lệ đang là ${total}% — phải đúng 100%`))
                        },
                      }]}>
                        {(fields, { add, remove }, { errors }) => (
                          <>
                            {fields.map(({ key, name }) => (
                              <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                                <Form.Item name={[name, 'subjectId']} noStyle rules={[{ required: true, message: 'Chọn lĩnh vực' }]}>
                                  <Select showSearch optionFilterProp="label" placeholder="Chọn lĩnh vực" style={{ width: 260 }}
                                    options={subjects.map((s) => ({ value: s.id, label: `${s.name} (${s._count?.questions ?? 0} câu)` }))} />
                                </Form.Item>
                                {/* Chỉ 1 lĩnh vực thì hiển nhiên là 100% — ẩn ô % đỡ rườm rà, giá trị
                                    vẫn giữ 100 trong form (từ initialValues hoặc do remove() ép lại bên
                                    dưới) nên không cần đụng gì tới logic phân bổ/validate phía trên. */}
                                {fields.length > 1 && (
                                  <Form.Item name={[name, 'percent']} noStyle rules={[{ required: true, message: 'Nhập %' }]}>
                                    <InputNumber min={0} max={100} addonAfter="%" placeholder="Tỷ lệ" style={{ width: 110 }} />
                                  </Form.Item>
                                )}
                                {fields.length > 1 && (
                                  <MinusCircleOutlined
                                    onClick={() => {
                                      const conLai = fields.filter((f) => f.name !== name)
                                      remove(name)
                                      if (conLai.length === 1) {
                                        form.setFieldValue(['subjectRatios', conLai[0].name, 'percent'], 100)
                                      }
                                    }}
                                    style={{ color: '#ff4d4f', cursor: 'pointer' }}
                                  />
                                )}
                              </Space>
                            ))}
                            <Form.ErrorList errors={errors} />
                            <Button type="dashed" onClick={() => add({ percent: 0 })} icon={<PlusOutlined />} size="small">
                              Thêm lĩnh vực
                            </Button>
                          </>
                        )}
                      </Form.List>
                    </Form.Item>
                  )
                }}
              </Form.Item>
              <Form.Item shouldUpdate noStyle>
                {() => {
                  const total = form.getFieldValue('totalQuestionCount') as number | undefined
                  const ratios = (form.getFieldValue('subjectRatios') ?? []) as SubjectRatio[]
                  const tongTyLe = ratios.reduce((s, r) => s + (r?.percent || 0), 0)
                  if (!total || ratios.length === 0) return null
                  const counts = phanBoTheoTyLe(total, ratios)
                  return (
                    <div style={{ marginTop: -8, marginBottom: 12 }}>
                      {ratios.length > 1 && (
                        <Text type={tongTyLe === 100 ? 'secondary' : 'danger'} style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                          Tổng tỷ lệ: {tongTyLe}%{tongTyLe !== 100 && ' — phải đúng 100%'}
                        </Text>
                      )}
                      {ratios.map((r, i) => {
                        if (!r.subjectId) return null
                        const subj = subjects.find((s) => s.id === r.subjectId)
                        const available = subj?._count?.questions ?? 0
                        const need = counts[i]
                        const thieu = need > available
                        return (
                          <Text key={i} type={thieu ? 'danger' : 'secondary'} style={{ fontSize: 12, display: 'block' }}>
                            {subj?.name ?? '—'}: {need} câu{thieu && ` (ngân hàng chỉ có ${available} câu — không đủ!)`}
                          </Text>
                        )
                      })}
                    </div>
                  )
                }}
              </Form.Item>
            </>
          ) : (
            <Form.Item name="quizId" label="Bộ đề" rules={[{ required: true, message: 'Chọn bộ đề' }]}>
              <Select placeholder="Chọn bộ đề" options={quizzes?.map((q) => ({ value: q.id, label: q.title }))} />
            </Form.Item>
          )}
        </Form.Item>

        <Form.Item name="hostMode" label="Chế độ điều khiển">
          <Radio.Group>
            <Radio value="MANUAL">Manual — MC bấm từng bước</Radio>
            <Radio value="AUTO">Auto — Tự động đếm ngược</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="questionDurationSec"
          label="Thời gian trả lời mỗi câu"
          extra="Áp dụng cho CẢ hai chế độ — máy chủ tự khoá nhận đáp án và tự công bố khi hết giờ, MC vẫn công bố sớm được."
        >
          <InputNumber min={5} max={300} style={{ width: 140 }} addonAfter="giây" />
        </Form.Item>
        <Form.Item
          name="revealPauseSec"
          label="Khoảng dừng xem kết quả (chỉ dùng cho Auto)"
          extra="Sau khi công bố đáp án, chờ bao lâu trước khi tự chuyển câu kế."
        >
          <InputNumber min={2} max={30} style={{ width: 140 }} addonAfter="giây" />
        </Form.Item>
        <Form.Item name="pointsForRank" label="Điểm theo thứ tự đúng (10 giá trị, cách nhau dấu phẩy)"
          extra="Rank 1 đến Rank 10, VD: 10,7,5,3,2,2,2,2,2,2">
          <Input />
        </Form.Item>
        <Form.Item name="penaltyWrong" label="Trừ điểm nếu sai">
          <InputNumber min={0} max={10} style={{ width: 120 }} addonAfter="điểm" />
        </Form.Item>
        <Divider titlePlacement="left" styles={{ content: { margin: 0 } }} style={{ fontSize: 13, color: '#8c8c8c' }}>
          <SafetyOutlined /> Bảo mật phòng (tuỳ chọn)
        </Divider>
        <Form.Item
          name="passcode"
          label="Mật khẩu phòng"
          rules={[
            {
              validator: (_, value: string | undefined) => {
                const v = value?.trim()
                if (!v) return Promise.resolve()
                if (v.length < 4 || v.length > 20) return Promise.reject(new Error('Mật khẩu cần 4-20 ký tự'))
                return Promise.resolve()
              },
            },
          ]}
          extra="Để trống nếu không cần — khi đặt, người quét mã QR/link phải nhập đúng mật khẩu này mới vào được phòng."
        >
          <Input.Password placeholder="Không bắt buộc, VD: 1234" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="invitedUserIds"
          label={<span><MailOutlined /> Mời cán bộ cụ thể (tuỳ chọn)</span>}
          extra="Để trống thì ai có mã/QR (và đúng mật khẩu nếu có) đều join được. Chọn cán bộ ở đây thì phòng chỉ nhận đúng những người này — người khác dù đúng mã/mật khẩu vẫn bị từ chối."
        >
          <Select
            mode="multiple"
            allowClear
            showSearch
            placeholder="Không bắt buộc — để trống nếu không giới hạn"
            optionFilterProp="label"
            options={users?.map((u) => ({ value: u.id, label: `${u.fullName} (${u.username})` }))}
          />
        </Form.Item>
        <Divider titlePlacement="left" styles={{ content: { margin: 0 } }} style={{ fontSize: 13, color: '#8c8c8c' }}>
          <TeamOutlined /> Đội đặt trước (tuỳ chọn, tối đa 10 đội)
        </Divider>
        <Form.List name="presetTeamNames">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Form.Item key={field.key} style={{ marginBottom: 8 }}>
                  <Space.Compact style={{ width: '100%' }}>
                    <Form.Item {...field} noStyle rules={[{ required: true, message: 'Nhập tên đội' }]}>
                      <Input placeholder="VD: Đội Tín dụng" maxLength={30} />
                    </Form.Item>
                    <Button icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                  </Space.Compact>
                </Form.Item>
              ))}
              {fields.length < 10 && (
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add()}>Thêm đội</Button>
              )}
            </>
          )}
        </Form.List>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4, marginBottom: 16 }}>
          Đặt tên trước thì người chơi bắt buộc chọn 1 trong các đội này khi vào phòng (không tự gõ tên đội nữa), mỗi đội tối đa 5 người. MC có thể chuyển/đá từng người giữa các đội trong sảnh chờ.
        </Text>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} icon={<PlayCircleOutlined />} block>
            Tạo phiên & vào Lobby
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function Lobby({ session, teams, onStart, onKick, onKickMember, onMoveMember, onMerge, onBack }: {
  session: ArenaSession; teams: ArenaTeam[]; onStart: () => void; onKick: (teamId: string) => void
  onKickMember: (teamId: string, userId: string) => void
  onMoveMember: (userId: string, targetTeamId: string) => void
  onMerge: (teamIds: string[], teamName?: string) => void; onBack: () => void
}) {
  const joinUrl = `${window.location.origin}/arena/join/${session.joinCode}`
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mergeModalOpen, setMergeModalOpen] = useState(false)
  const [mergeName, setMergeName] = useState('')

  function copyCode() {
    navigator.clipboard.writeText(session.joinCode)
  }

  function toggleSelect(teamId: string) {
    setSelectedIds((prev) => prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId])
  }

  const selectedTeams = teams.filter((t) => selectedIds.includes(t.id))
  const selectedMemberCount = selectedTeams.reduce((sum, t) => sum + (t.members?.length ?? 1), 0)
  const canMerge = selectedIds.length >= 2 && selectedMemberCount >= 2 && selectedMemberCount <= 5
  const hasNonPresetTeams = teams.some((t) => !t.isPreset)
  const teamsWithMembersCount = teams.filter((t) => (t.members?.length ?? 0) > 0).length

  function openMergeModal() {
    setMergeName('')
    setMergeModalOpen(true)
  }

  function confirmMerge() {
    onMerge(selectedIds, mergeName.trim() || undefined)
    setMergeModalOpen(false)
    setSelectedIds([])
  }

  const joinedUserIds = new Set(teams.flatMap((t) => (t.members ?? []).map((m) => m.userId)))
  const invites = session.invites ?? []

  return (
    <Row gutter={24}>
      <Col xs={24} lg={10}>
        <Card title="Mã tham gia">
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, fontFamily: 'monospace', fontWeight: 700, letterSpacing: 8, color: 'var(--agribank-red)', marginBottom: 16 }}>
              {session.joinCode}
            </div>
            <QRCodeSVG value={joinUrl} size={180} />
            <div style={{ marginTop: 12 }}>
              <Button icon={<CopyOutlined />} onClick={copyCode} size="small">Sao chép mã</Button>
            </div>
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>{joinUrl}</Text>
          </div>
          <Divider />
          {session.passcode ? (
            <>
              <Space align="center" style={{ marginBottom: 4 }}>
                <LockOutlined style={{ color: '#faad14' }} />
                <Text strong>Mật khẩu phòng (đọc cho người chơi)</Text>
              </Space>
              <div style={{ textAlign: 'center', margin: '4px 0 12px' }}>
                <Text style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 700, letterSpacing: 4 }}>
                  {session.passcode}
                </Text>
                <Button
                  size="small" type="text" icon={<CopyOutlined />}
                  onClick={() => navigator.clipboard.writeText(session.passcode!)}
                  style={{ marginLeft: 8 }}
                />
              </div>
            </>
          ) : (
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              Không đặt mật khẩu — ai có mã/QR đều tham gia được.
            </Text>
          )}
          <Text type="secondary">{session.quiz.title}</Text><br />
          <Text type="secondary">Chế độ: <Tag>{session.hostMode}</Tag></Text><br />
          <Text type="secondary">{session.rounds?.length ?? 0} câu hỏi</Text>
        </Card>

        {invites.length > 0 && (
          <Card
            style={{ marginTop: 16 }}
            title={
              <Space>
                <MailOutlined style={{ color: '#faad14' }} />
                <span>Danh sách được mời ({invites.filter((i) => joinedUserIds.has(i.user.id)).length}/{invites.length} đã vào)</span>
              </Space>
            }
          >
            <List
              size="small"
              dataSource={invites}
              renderItem={(invite) => {
                const joined = joinedUserIds.has(invite.user.id)
                return (
                  <List.Item>
                    <Space>
                      {joined ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <Spin size="small" />}
                      <Text type={joined ? undefined : 'secondary'}>{invite.user.fullName}</Text>
                    </Space>
                    {!joined && <Text type="secondary" style={{ fontSize: 12 }}>Chưa vào</Text>}
                  </List.Item>
                )
              }}
            />
          </Card>
        )}
      </Col>
      <Col xs={24} lg={14}>
        <Card
          title={<Space><TeamOutlined /><span>Đội tham gia ({teams.length}/10)</span></Space>}
          extra={
            <Space>
              <Button onClick={onBack}>Quay lại</Button>
              <Button type="primary" icon={<PlayCircleOutlined />} disabled={teamsWithMembersCount < 2} onClick={onStart}>
                Bắt đầu ({teamsWithMembersCount} đội)
              </Button>
            </Space>
          }
        >
          {hasNonPresetTeams && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fafafa', border: '1px solid #eee', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Text type="secondary" style={{ flex: 1, fontSize: 13 }}>
                {selectedIds.length === 0
                  ? 'Chọn 2-5 người chơi (đội tự phát sinh) để gộp thành 1 đội chung điểm số'
                  : `Đã chọn ${selectedIds.length} mục — ${selectedMemberCount} người${selectedMemberCount > 5 ? ' (vượt quá 5, bỏ bớt)' : ''}`}
              </Text>
              {selectedIds.length > 0 && <Button size="small" onClick={() => setSelectedIds([])}>Bỏ chọn</Button>}
              <Button size="small" type="primary" icon={<UsergroupAddOutlined />} disabled={!canMerge} onClick={openMergeModal}>
                Gộp thành 1 đội
              </Button>
            </div>
          )}
          {teams.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
              <div style={{ marginTop: 16 }}>
                <Text type="secondary">Đang chờ các đội tham gia…</Text>
              </div>
            </div>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              {teams.map((team) => {
                const members = team.members ?? []
                const isFull = members.length >= 5
                const otherTeamOptions = teams
                  .filter((t) => t.id !== team.id)
                  .map((t) => ({
                    value: t.id,
                    label: `${t.name} (${(t.members?.length ?? 0)}/5)`,
                    disabled: (t.members?.length ?? 0) >= 5,
                  }))
                return (
                  <Card key={team.id} size="small" styles={{ body: { padding: '10px 14px' } }}>
                    <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                      <Space>
                        {!team.isPreset && (
                          <Checkbox
                            checked={selectedIds.includes(team.id)}
                            onChange={() => toggleSelect(team.id)}
                          />
                        )}
                        <Avatar size="small" style={{ backgroundColor: team.color }}>{team.name[0].toUpperCase()}</Avatar>
                        <Text strong>{team.name}</Text>
                        <Tag color={isFull ? 'red' : undefined}>{members.length}/5</Tag>
                        {team.isPreset && <Tag color="blue">Đặt trước</Tag>}
                      </Space>
                      <Popconfirm
                        title={team.isPreset ? 'Gỡ hết người khỏi đội này?' : 'Mời cả đội ra khỏi phòng?'}
                        description={team.isPreset ? 'Đội vẫn giữ chỗ cho người khác vào sau.' : `Đội "${team.name}" sẽ bị ngắt khỏi phòng ngay lập tức.`}
                        okText="Xác nhận"
                        okType="danger"
                        cancelText="Bỏ qua"
                        onConfirm={() => onKick(team.id)}
                        disabled={members.length === 0}
                      >
                        <Button size="small" danger type="text" icon={<UserDeleteOutlined />} disabled={members.length === 0}>
                          Đá cả đội
                        </Button>
                      </Popconfirm>
                    </Space>
                    {members.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12, marginLeft: 28 }}>Chưa có ai</Text>
                    ) : (
                      <div style={{ marginTop: 6, marginLeft: 28 }}>
                        {members.map((m) => (
                          <div key={m.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0' }}>
                            <Text style={{ fontSize: 13 }}>{m.fullName}</Text>
                            <Space size={4}>
                              {teams.length > 1 && (
                                <Select
                                  size="small" style={{ width: 160 }} placeholder="Chuyển đội"
                                  suffixIcon={<SwapOutlined />}
                                  options={otherTeamOptions}
                                  onChange={(targetTeamId: string) => onMoveMember(m.userId, targetTeamId)}
                                  value={undefined}
                                />
                              )}
                              <Button
                                size="small" danger type="text" icon={<UserDeleteOutlined />}
                                onClick={() => onKickMember(team.id, m.userId)}
                              />
                            </Space>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )
              })}
            </Space>
          )}
        </Card>
      </Col>
      <Modal
        title="Gộp thành 1 đội"
        open={mergeModalOpen}
        onOk={confirmMerge}
        onCancel={() => setMergeModalOpen(false)}
        okText="Gộp"
      >
        <Text type="secondary">Gộp {selectedIds.length} mục ({selectedMemberCount} người) thành 1 đội chung điểm số.</Text>
        <Input
          style={{ marginTop: 12 }}
          placeholder="Tên đội sau khi gộp (để trống dùng tên đội đầu tiên)"
          value={mergeName}
          onChange={(e) => setMergeName(e.target.value)}
          maxLength={30}
        />
      </Modal>
    </Row>
  )
}

// ─── GameControl ──────────────────────────────────────────────────────────────

function GameControl({
  session, leaderboard, currentQuestion, buzzes, locked, revealData, countdown,
  prepare, onReveal, onNext, onEnd,
}: {
  session: ArenaSession; leaderboard: ArenaLeaderboardRow[]; currentQuestion: ArenaQuestionPayload | null
  buzzes: ArenaBuzzPayload[]; locked: boolean; revealData: ArenaRevealPayload | null
  countdown: ReturnType<typeof useArenaCountdown>
  prepare: ArenaPreparePayload | null
  onReveal: () => void; onNext: () => void; onEnd: () => void
}) {
  const isManual = session.hostMode === 'MANUAL'
  const totalRounds = prepare?.totalRounds ?? currentQuestion?.totalRounds ?? session.rounds?.length ?? 0
  const currentOrder = prepare?.order ?? currentQuestion?.order ?? 0
  const isRevealed = !!revealData

  return (
    <Row gutter={16}>
      {/* Cột trái: khung câu hỏi */}
      <Col xs={24} lg={16}>
        <Card
          title={
            <Space>
              <Text strong>Câu {(currentOrder) + 1}/{totalRounds}</Text>
              {currentQuestion && !isRevealed && !prepare && (
                <ArenaCountdownRing {...countdown} size={40} />
              )}
            </Space>
          }
          extra={
            <Space>
              {/* Server làm chủ deadline ở CẢ HAI chế độ — MC luôn công bố sớm được,
                  không chỉ riêng MANUAL. Ở AUTO, không bấm thì máy chủ tự công bố khi hết giờ. */}
              {!isRevealed && !prepare && currentQuestion && (
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={onReveal}>
                  {isManual ? 'Reveal đáp án' : 'Công bố sớm'}
                </Button>
              )}
              {isRevealed && !prepare && isManual && (
                <Button type="primary" icon={<ArrowRightOutlined />} onClick={onNext}>Câu tiếp theo</Button>
              )}
              <Button danger icon={<StopOutlined />} onClick={onEnd}>Kết thúc</Button>
            </Space>
          }
        >
          {prepare ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Text type="secondary">Chuẩn bị câu {prepare.order + 1}</Text>
              <Title level={2} style={{ margin: '8px 0' }}>
                {prepare.subjectName ?? 'Chưa phân loại lĩnh vực'}
              </Title>
              <Text type="secondary">Các đội chuẩn bị tinh thần — câu hỏi sắp hiện ra…</Text>
            </div>
          ) : !currentQuestion ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : (
            <>
              {currentQuestion.question.subjectName && (
                <Tag color="green" style={{ marginBottom: 8 }}>Lĩnh vực: {currentQuestion.question.subjectName}</Tag>
              )}
              {locked && !isRevealed && (
                <Tag color="red" style={{ marginBottom: 8, marginLeft: 8 }}>Đã hết giờ — đang chốt điểm…</Tag>
              )}
              <br />
              {currentQuestion.question.imageUrl && (
                <img
                  src={currentQuestion.question.imageUrl}
                  alt=""
                  style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, margin: '8px 0', display: 'block' }}
                />
              )}
              <Text style={{ fontSize: 18 }}>{currentQuestion.question.content}</Text>
              <Row gutter={[12, 12]} style={{ marginTop: 20 }}>
                {currentQuestion.question.options.map((opt, idx) => {
                  const isCorrect = revealData?.correctOptionIds.includes(opt.id)
                  return (
                    <Col span={12} key={opt.id}>
                      <div
                        className={isRevealed ? undefined : `arena-option-${idx % 4}`}
                        style={{
                          background: isRevealed ? (isCorrect ? '#52c41a' : '#ff4d4f') : undefined,
                          color: '#fff', borderRadius: 8, padding: '12px 16px', fontSize: 15, fontWeight: 500,
                          border: isCorrect ? '3px solid #fff' : 'none',
                        }}
                      >
                        {String.fromCharCode(65 + idx)}. {opt.content}
                        {isCorrect && <CheckCircleOutlined style={{ marginLeft: 8 }} />}
                      </div>
                    </Col>
                  )
                })}
              </Row>
              {isRevealed && revealData.explanation && (
                <Alert style={{ marginTop: 16 }} type="info" message={`💡 ${revealData.explanation}`} />
              )}
            </>
          )}
        </Card>

        {/* Theo dõi buzz-in / bảng công bố */}
        {isRevealed ? (
          <Card style={{ marginTop: 16 }} title={<Space><TrophyOutlined style={{ color: '#faad14' }} /><span>Kết quả câu {currentOrder + 1}</span></Space>}>
            <ArenaRevealBoard results={revealData.results} showRawTime />
          </Card>
        ) : (
          <Card style={{ marginTop: 16 }}>
            <ArenaBuzzStrip buzzes={buzzes} />
          </Card>
        )}
      </Col>

      {/* Cột phải: bảng xếp hạng */}
      <Col xs={24} lg={8}>
        <Card title={<Space><TrophyOutlined style={{ color: '#faad14' }} /><span>Bảng điểm</span></Space>}>
          <ArenaLeaderboard teams={leaderboard} />
        </Card>
      </Col>
    </Row>
  )
}

// ─── ResultScreen ─────────────────────────────────────────────────────────────

function ResultScreen({ ranking, onBack }: { ranking: ArenaLeaderboardRow[]; onBack: () => void }) {
  const podium = ranking.slice(0, 3)
  const encouragement = ranking.slice(3)

  useEffect(() => {
    if (ranking.length > 0) void fireGoldSparkle()
  }, [ranking.length])

  return (
    <Card
      title={<Space><TrophyOutlined style={{ color: '#faad14', fontSize: 20 }} /><Title level={4} style={{ margin: 0 }}>Kết quả Đấu trường</Title></Space>}
      extra={<Button onClick={onBack}>Về trang chủ</Button>}
    >
      {/* Bục trao giải */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Title level={3}>🏆 Bảng xếp hạng</Title>
        <Row justify="center" gutter={24} align="bottom" style={{ marginTop: 24 }}>
          {/* Hạng 2 */}
          {podium[1] && (
            <Col>
              <div style={{ textAlign: 'center' }}>
                <RankMedal rank={2} />
                <div style={{ background: podium[1].teamColor, color: '#fff', borderRadius: 8, padding: '12px 24px', marginTop: 8, minWidth: 120, height: 80, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Text strong style={{ color: '#fff', fontSize: 16 }}>{podium[1].teamName}</Text><br />
                  <Text style={{ color: '#fff' }}>{podium[1].score} điểm</Text>
                </div>
              </div>
            </Col>
          )}
          {/* Hạng 1 */}
          {podium[0] && (
            <Col>
              <div style={{ textAlign: 'center' }}>
                <RankMedal rank={1} />
                <div style={{ background: podium[0].teamColor, color: '#fff', borderRadius: 8, padding: '16px 32px', marginTop: 8, minWidth: 140, height: 100, display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                  <Text strong style={{ color: '#fff', fontSize: 18 }}>{podium[0].teamName}</Text><br />
                  <Text style={{ color: '#fff', fontSize: 16 }}>{podium[0].score} điểm</Text>
                </div>
              </div>
            </Col>
          )}
          {/* Hạng 3 */}
          {podium[2] && (
            <Col>
              <div style={{ textAlign: 'center' }}>
                <RankMedal rank={3} />
                <div style={{ background: podium[2].teamColor, color: '#fff', borderRadius: 8, padding: '10px 20px', marginTop: 8, minWidth: 110, height: 70, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Text strong style={{ color: '#fff', fontSize: 15 }}>{podium[2].teamName}</Text><br />
                  <Text style={{ color: '#fff' }}>{podium[2].score} điểm</Text>
                </div>
              </div>
            </Col>
          )}
        </Row>
      </div>

      {/* Giải khuyến khích */}
      {encouragement.length > 0 && (
        <>
          <Divider>🏅 Khuyến khích</Divider>
          <Row gutter={[16, 16]} justify="center">
            {encouragement.map((team) => (
              <Col key={team.teamId}>
                <Tag color={team.teamColor} style={{ padding: '6px 14px', fontSize: 14 }}>
                  #{team.rank} {team.teamName} — {team.score} điểm
                </Tag>
              </Col>
            ))}
          </Row>
        </>
      )}
    </Card>
  )
}
