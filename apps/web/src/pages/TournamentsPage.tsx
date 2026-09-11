import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button, Card, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Tag, Typography, message,
} from 'antd'
import { Link } from 'react-router-dom'
import { PlusOutlined, TrophyOutlined } from '@ant-design/icons'
import api, { getErrorMessage } from '../lib/api'

const { Title, Text } = Typography

interface Quiz { id: string; title: string }
interface TournamentTeam { id: string; name: string; seed: number; isEliminated: boolean }
interface TournamentMatch {
  id: string
  round: number
  orderInRound: number
  team1Id: string | null
  team2Id: string | null
  winnerTeamId: string | null
  arenaSessionId: string | null
  status: 'PENDING' | 'READY' | 'RUNNING' | 'DONE'
}
interface Tournament {
  id: string
  name: string
  status: 'DRAFT' | 'RUNNING' | 'FINISHED'
  totalRounds: number
  currentRound: number
  championTeamId: string | null
  quiz: { title: string }
  teams: TournamentTeam[]
  matches: TournamentMatch[]
}

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: 'Chưa bắt đầu' },
  RUNNING: { color: 'processing', label: 'Đang thi đấu' },
  FINISHED: { color: 'success', label: 'Đã kết thúc' },
}

function TournamentDetail({ tournament, onBack }: { tournament: Tournament; onBack: () => void }) {
  const qc = useQueryClient()
  const teamById = new Map(tournament.teams.map((t) => [t.id, t]))

  const startMutation = useMutation({
    mutationFn: (matchId: string) => api.post(`/admin/tournaments/matches/${matchId}/start`).then((r) => r.data),
    onSuccess: () => {
      message.success('Đã tạo phiên Đấu trường cho trận này — vào trang Đấu trường để vận hành')
      void qc.invalidateQueries({ queryKey: ['tournaments'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể bắt đầu trận đấu')),
  })
  const completeMutation = useMutation({
    mutationFn: (matchId: string) => api.post(`/admin/tournaments/matches/${matchId}/complete`),
    onSuccess: () => {
      message.success('Đã chốt kết quả trận đấu')
      void qc.invalidateQueries({ queryKey: ['tournaments'] })
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể chốt kết quả — kiểm tra phiên Đấu trường đã kết thúc chưa')),
  })

  const rounds = Array.from({ length: tournament.totalRounds }, (_, i) => i + 1)
  const champion = tournament.championTeamId ? teamById.get(tournament.championTeamId) : null

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Button type="link" onClick={onBack} style={{ paddingLeft: 0 }}>← Danh sách giải đấu</Button>
          <Title level={1}>{tournament.name}</Title>
        </div>
        <Tag color={STATUS_TAG[tournament.status].color}>{STATUS_TAG[tournament.status].label}</Tag>
      </header>
      <Text type="secondary">Bộ đề: {tournament.quiz.title}</Text>

      {champion && (
        <Card bordered={false} className="dash-hero" style={{ marginTop: 16 }}>
          <Space><TrophyOutlined style={{ fontSize: 24 }} /><Title level={3} style={{ color: '#fff', margin: 0 }}>Vô địch: {champion.name}</Title></Space>
        </Card>
      )}

      <Row gutter={16} style={{ marginTop: 16, overflowX: 'auto' }} wrap={false}>
        {rounds.map((round) => (
          <Col key={round} flex="280px">
            <Title level={5}>{round === tournament.totalRounds ? 'Chung kết' : `Vòng ${round}`}</Title>
            <Space direction="vertical" style={{ width: '100%' }}>
              {tournament.matches
                .filter((m) => m.round === round)
                .map((m) => {
                  const team1 = m.team1Id ? teamById.get(m.team1Id) : null
                  const team2 = m.team2Id ? teamById.get(m.team2Id) : null
                  return (
                    <Card key={m.id} size="small" bordered>
                      <div style={{ fontWeight: m.winnerTeamId === m.team1Id ? 700 : 400 }}>{team1?.name ?? 'Chờ đội thắng vòng trước'}</div>
                      <div style={{ textAlign: 'center', color: '#999', fontSize: 12 }}>vs</div>
                      <div style={{ fontWeight: m.winnerTeamId === m.team2Id ? 700 : 400 }}>{team2?.name ?? 'Chờ đội thắng vòng trước'}</div>
                      <div style={{ marginTop: 8 }}>
                        {m.status === 'READY' && (
                          <Button size="small" type="primary" block loading={startMutation.isPending} onClick={() => startMutation.mutate(m.id)}>
                            Bắt đầu trận
                          </Button>
                        )}
                        {m.status === 'RUNNING' && (
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Link to="/manage/arena">Vào Đấu trường vận hành trận này →</Link>
                            <Button size="small" block loading={completeMutation.isPending} onClick={() => completeMutation.mutate(m.id)}>
                              Chốt kết quả (sau khi phiên kết thúc)
                            </Button>
                          </Space>
                        )}
                        {m.status === 'DONE' && <Tag color="success" style={{ width: '100%', textAlign: 'center' }}>Đã xong</Tag>}
                        {m.status === 'PENDING' && <Tag style={{ width: '100%', textAlign: 'center' }}>Chưa đủ đội</Tag>}
                      </div>
                    </Card>
                  )
                })}
            </Space>
          </Col>
        ))}
      </Row>
    </div>
  )
}

export default function TournamentsPage() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form] = Form.useForm()

  const { data: tournaments = [], isLoading } = useQuery<Tournament[]>({
    queryKey: ['tournaments'],
    queryFn: () => api.get('/admin/tournaments').then((r) => r.data),
  })
  const { data: quizzes = [] } = useQuery<Quiz[]>({
    queryKey: ['quizzes'],
    queryFn: () => api.get('/admin/quizzes').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (values: { name: string; quizId: string; teamNamesText: string }) =>
      api.post('/admin/tournaments', {
        name: values.name,
        quizId: values.quizId,
        teamNames: values.teamNamesText.split('\n').map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      message.success('Đã tạo giải đấu và bốc thăm vòng 1')
      void qc.invalidateQueries({ queryKey: ['tournaments'] })
      setModalOpen(false)
      form.resetFields()
    },
    onError: (e) => message.error(getErrorMessage(e, 'Không thể tạo giải đấu — kiểm tra số đội phải là luỹ thừa của 2')),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/tournaments/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tournaments'] })
      setSelectedId(null)
    },
  })

  const selected = tournaments.find((t) => t.id === selectedId)
  if (selected) return <TournamentDetail tournament={selected} onBack={() => setSelectedId(null)} />

  return (
    <div className="page-stack">
      <header className="page-title-row" style={{ marginBottom: 16 }}>
        <div>
          <Text className="page-eyebrow">3800Quiz</Text>
          <Title level={1}>Giải đấu loại trực tiếp</Title>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Tạo giải đấu</Button>
      </header>
      <Text type="secondary">Mỗi trận tái dùng nguyên phiên Đấu trường có sẵn — số đội đăng ký phải là luỹ thừa của 2 (2, 4, 8, 16...).</Text>

      {isLoading ? null : tournaments.length === 0 ? (
        <Empty description="Chưa có giải đấu nào" />
      ) : (
        <Row gutter={[16, 16]}>
          {tournaments.map((t) => (
            <Col key={t.id} xs={24} sm={12} md={8}>
              <Card
                hoverable
                onClick={() => setSelectedId(t.id)}
                title={t.name}
                extra={<Tag color={STATUS_TAG[t.status].color}>{STATUS_TAG[t.status].label}</Tag>}
                actions={[
                  <Popconfirm key="del" title="Xoá giải đấu này?" onConfirm={(e) => { e?.stopPropagation(); deleteMutation.mutate(t.id) }}>
                    <span onClick={(e) => e.stopPropagation()}>Xoá</span>
                  </Popconfirm>,
                ]}
              >
                <Text type="secondary">{t.quiz.title}</Text><br />
                <Text>{t.teams.length} đội · Vòng {t.currentRound}/{t.totalRounds}</Text>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title="Tạo giải đấu loại trực tiếp"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields() }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item name="name" label="Tên giải đấu" rules={[{ required: true, message: 'Nhập tên giải đấu' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="quizId" label="Bộ đề" rules={[{ required: true, message: 'Chọn bộ đề' }]}>
            <Select options={quizzes.map((q) => ({ value: q.id, label: q.title }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item
            name="teamNamesText"
            label="Danh sách đội (mỗi dòng 1 đội — số đội phải là luỹ thừa của 2)"
            rules={[{ required: true, message: 'Nhập danh sách đội' }]}
          >
            <Input.TextArea rows={6} placeholder={'Đội A\nĐội B\nĐội C\nĐội D'} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
