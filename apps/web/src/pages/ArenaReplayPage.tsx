import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Collapse, List, Skeleton, Space, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, TrophyOutlined } from '@ant-design/icons'
import api from '../lib/api'

const { Text, Title } = Typography

interface ReplayOption { id: string; content: string; isCorrect: boolean }
interface ReplayBuzz {
  id: string
  teamId: string
  selectedOptionIds: string[]
  isCorrect: boolean
  pointsAwarded: number
  correctRank: number | null
  speedRank: number | null
  responseMs: number
  team: { id: string; name: string; color: string }
}
interface ReplayRound {
  id: string
  order: number
  status: string
  question: { id: string; content: string; questionType: string; options: ReplayOption[] }
  buzzes: ReplayBuzz[]
}
interface ReplayTeam { id: string; name: string; color: string; score: number; rank: number | null }
interface ArenaSessionDetail {
  id: string
  name: string
  quiz: { title: string }
  teams: ReplayTeam[]
  rounds: ReplayRound[]
}

function formatMs(ms: number) {
  return `${(ms / 1000).toFixed(2)}s`
}

export default function ArenaReplayPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<ArenaSessionDetail>({
    queryKey: ['arena-session-detail', id],
    queryFn: () => api.get(`/admin/arena-sessions/${id}`).then((r) => r.data),
  })

  if (isLoading) return <Skeleton active />
  if (!data) return <Text type="danger">Không tìm thấy phiên đấu trường</Text>

  const teamById = new Map(data.teams.map((t) => [t.id, t]))

  return (
    <div className="page-stack">
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/manage/arena')}>Quay lại</Button>
        <Title level={1} style={{ margin: 0 }}>Xem lại: {data.name}</Title>
      </Space>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>Bộ đề: {data.quiz.title}</Text>

      <Card title={<span><TrophyOutlined /> Bảng xếp hạng cuối</span>} style={{ marginBottom: 16 }}>
        <List
          dataSource={[...data.teams].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))}
          renderItem={(t, i) => (
            <List.Item>
              <Space>
                <Tag color={t.color}>#{t.rank ?? i + 1}</Tag>
                <Text strong>{t.name}</Text>
              </Space>
              <Text strong>{t.score} điểm</Text>
            </List.Item>
          )}
        />
      </Card>

      <Collapse
        items={data.rounds.map((r) => ({
          key: r.id,
          label: `Câu ${r.order + 1}: ${r.question.content}`,
          children: (
            <div>
              <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
                {r.question.options.map((o) => (
                  <Tag key={o.id} color={o.isCorrect ? 'success' : 'default'} style={{ padding: '4px 12px' }}>
                    {o.isCorrect ? '✓ ' : ''}{o.content}
                  </Tag>
                ))}
              </Space>
              <List
                size="small"
                header={<Text strong>Các đội đã trả lời ({r.buzzes.length})</Text>}
                dataSource={[...r.buzzes].sort((a, b) => a.responseMs - b.responseMs)}
                locale={{ emptyText: 'Không có đội nào trả lời câu này' }}
                renderItem={(b) => (
                  <List.Item>
                    <Space>
                      <Tag color={teamById.get(b.teamId)?.color ?? 'default'}>{teamById.get(b.teamId)?.name ?? b.teamId}</Tag>
                      <Tag color={b.isCorrect ? 'success' : 'error'}>{b.isCorrect ? 'Đúng' : 'Sai'}</Tag>
                      {b.speedRank === 1 && <Tag color="gold">Nhanh nhất</Tag>}
                    </Space>
                    <Space>
                      <Text type="secondary">{formatMs(b.responseMs)}</Text>
                      <Text strong>{b.pointsAwarded >= 0 ? '+' : ''}{b.pointsAwarded} điểm</Text>
                    </Space>
                  </List.Item>
                )}
              />
            </div>
          ),
        }))}
      />
    </div>
  )
}
