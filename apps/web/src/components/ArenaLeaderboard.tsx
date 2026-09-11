// Bảng xếp hạng có hoạt ảnh đổi hạng (kỹ thuật FLIP, xem hooks/useFlipRows.ts)
// — dùng chung màn MC (đầy đủ) và màn người chơi (rút gọn qua prop `compact`).

import { Avatar, Typography } from 'antd'
import { TrophyOutlined } from '@ant-design/icons'
import { useFlipRows } from '../hooks/useFlipRows'
import { formatSignedPoints, rankDeltaLabel } from '../lib/arena-format'
import type { ArenaLeaderboardRow } from '../lib/arena-types'

const { Text } = Typography

export function ArenaLeaderboard({
  teams,
  highlightTeamId,
  compact = false,
}: {
  teams: ArenaLeaderboardRow[]
  highlightTeamId?: string | null
  compact?: boolean
}) {
  const sorted = [...teams].sort((a, b) => a.rank - b.rank)
  const bindRow = useFlipRows(sorted.map((t) => t.teamId).join(','))

  return (
    <div className="arena-leaderboard">
      {sorted.map((team) => {
        const isMine = team.teamId === highlightTeamId
        return (
          <div
            key={team.teamId}
            ref={bindRow(team.teamId)}
            className={`arena-lb-row${isMine ? ' arena-lb-row-mine' : ''}`}
          >
            <span className="arena-lb-rank">#{team.rank}</span>
            {!compact && (
              <Avatar size="small" style={{ backgroundColor: team.teamColor, flexShrink: 0 }}>
                {team.teamName[0]?.toUpperCase()}
              </Avatar>
            )}
            <Text strong={isMine} className="arena-lb-name">{team.teamName}</Text>
            {team.rank === 1 && <TrophyOutlined style={{ color: 'var(--arena-gold, #E0B44C)' }} />}
            {team.rankDelta !== 0 && (
              <span
                className={`arena-rank-badge ${team.rankDelta > 0 ? 'arena-rank-badge-up' : 'arena-rank-badge-down'}`}
              >
                {rankDeltaLabel(team.rankDelta)}
              </span>
            )}
            {team.lastPointsDelta !== 0 && (
              <span
                className={`arena-points-delta ${team.lastPointsDelta > 0 ? 'arena-points-delta-plus' : 'arena-points-delta-minus'}`}
              >
                {formatSignedPoints(team.lastPointsDelta)}
              </span>
            )}
            <span className="arena-lb-score">{team.score} đ</span>
          </div>
        )
      })}
    </div>
  )
}
