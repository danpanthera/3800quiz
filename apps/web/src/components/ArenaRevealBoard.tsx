// Bảng công bố kết quả từng đội sau khi reveal — trung tâm của yêu cầu "hiện
// đội nào đúng/sai/nhanh nhất/thời gian/điểm". Dùng chung màn MC (đầy đủ,
// gồm rawResponseMs khi cần soi) và màn người chơi (tự động rút gọn qua CSS
// responsive, không cần prop riêng).

import { Typography } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined, CrownOutlined } from '@ant-design/icons'
import { formatResponseTime, formatSignedPoints, rankDeltaLabel } from '../lib/arena-format'
import type { ArenaTeamRoundResult } from '../lib/arena-types'

const { Text } = Typography

function outcomeIcon(outcome: ArenaTeamRoundResult['outcome']) {
  if (outcome === 'correct') return <CheckCircleOutlined />
  if (outcome === 'wrong') return <CloseCircleOutlined />
  return <MinusCircleOutlined />
}

function outcomeLabel(outcome: ArenaTeamRoundResult['outcome']) {
  if (outcome === 'correct') return 'Đúng'
  if (outcome === 'wrong') return 'Sai'
  return 'Không trả lời'
}

export function ArenaRevealBoard({
  results,
  myTeamId,
  showRawTime = false,
}: {
  results: ArenaTeamRoundResult[]
  myTeamId?: string | null
  /** MC bật để soi thời gian THÔ (chưa bù trễ) cạnh thời gian chính thức. */
  showRawTime?: boolean
}) {
  return (
    <div className="arena-reveal-board">
      {results.map((r, i) => {
        const isMine = r.teamId === myTeamId
        return (
          <div
            key={r.teamId}
            className={`arena-result-row arena-result-${r.outcome}${isMine ? ' arena-result-mine' : ''}${
              r.isFastestCorrect ? ' arena-result-fastest' : ''
            }`}
            style={{ ['--arena-i' as string]: i }}
          >
            <span className="arena-result-outcome-icon">{outcomeIcon(r.outcome)}</span>
            <span className="arena-result-team" style={{ ['--arena-chip-color' as string]: r.teamColor }}>
              <span className="arena-result-dot" />
              <Text strong={isMine}>{r.teamName}</Text>
              {r.isFastestCorrect && <CrownOutlined className="arena-crown" title="Nhanh nhất đúng" />}
            </span>
            <span className="arena-result-outcome-label">{outcomeLabel(r.outcome)}</span>
            <span className="arena-result-time arena-time-pill">
              {formatResponseTime(r.responseMs)}
              {showRawTime && r.rawResponseMs != null && r.rawResponseMs !== r.responseMs && (
                <span className="arena-result-time-raw"> (thô {formatResponseTime(r.rawResponseMs)})</span>
              )}
            </span>
            <span
              className={`arena-points-delta ${r.pointsDelta > 0 ? 'arena-points-delta-plus' : r.pointsDelta < 0 ? 'arena-points-delta-minus' : ''}`}
            >
              {formatSignedPoints(r.pointsDelta)}
            </span>
            <span className="arena-result-total">{r.scoreAfter} đ</span>
            {r.rankDelta !== 0 && (
              <span
                className={`arena-rank-badge ${r.rankDelta > 0 ? 'arena-rank-badge-up' : 'arena-rank-badge-down'}`}
              >
                {rankDeltaLabel(r.rankDelta)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
