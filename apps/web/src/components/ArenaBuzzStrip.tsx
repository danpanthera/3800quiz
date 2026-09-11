// Dải chip "đội nào đã bấm + thời gian" — hiện ngay khi có đội trả lời, TRƯỚC
// khi công bố đúng/sai (tránh lộ đáp án cho đội chưa trả lời). Dùng chung màn
// MC và màn người chơi.

import { Typography } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { formatResponseTime } from '../lib/arena-format'
import type { ArenaBuzzPayload } from '../lib/arena-types'

const { Text } = Typography

export function ArenaBuzzStrip({ buzzes }: { buzzes: ArenaBuzzPayload[] }) {
  const teamsTotal = buzzes[0]?.teamsTotal ?? 0
  return (
    <div className="arena-buzz-strip">
      <div className="arena-buzz-strip-header">
        <ThunderboltOutlined style={{ color: 'var(--arena-gold, #E0B44C)' }} />
        <Text strong>
          Đội đã trả lời{teamsTotal > 0 ? ` (${buzzes.length}/${teamsTotal})` : ` (${buzzes.length})`}
        </Text>
      </div>
      {buzzes.length === 0 ? (
        <Text type="secondary" className="arena-buzz-strip-empty">Chưa có đội nào trả lời…</Text>
      ) : (
        <div className="arena-buzz-strip-chips">
          {buzzes.map((b) => (
            <span
              key={b.teamId}
              className="arena-buzz-chip"
              style={{ ['--arena-chip-color' as string]: b.teamColor }}
            >
              <span className="arena-buzz-chip-order">#{b.order}</span>
              <span className="arena-buzz-chip-name">{b.teamName}</span>
              <span className="arena-buzz-chip-time arena-time-pill">
                {formatResponseTime(b.responseMs)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
