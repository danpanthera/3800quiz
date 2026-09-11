import type { Key, ReactNode } from 'react'
import { Card, Checkbox, List, Table } from 'antd'
import type { ColumnsType, TableProps } from 'antd/es/table'
import type { PaginationConfig } from 'antd/es/pagination'
import { useDeviceType } from '../hooks/useDeviceType'

export interface ManageTableCardField<T> {
  label: string
  render: (record: T) => ReactNode
}

// Record<string, any> — bắt buộc dùng `any` chứ không phải `unknown` ở đây: các interface record
// hiện có trong repo (Quiz, Question, CanBoItem...) không khai báo index signature, nên chỉ thoả mãn
// ràng buộc generic Record<string, X> khi X là `any` (kiểm chứng bằng tsc: đổi qua `unknown` làm vỡ
// build ở toàn bộ 9 trang đang dùng component này).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ManageTableProps<T extends Record<string, any>>
  extends Omit<TableProps<T>, 'columns' | 'dataSource' | 'rowKey' | 'size'> {
  rowKey: string | ((record: T) => string)
  columns: ColumnsType<T>
  dataSource: T[]
  /** Áp dụng cho nhánh Table (desktop/tablet ngang) — mặc định 'small' như các trang quản lý hiện có */
  size?: TableProps<T>['size']
  /** Dòng tiêu đề đậm trong thẻ (thường là tên/nội dung chính của bản ghi) */
  cardHeading: (record: T) => ReactNode
  /** Badge/trạng thái ở góc phải dòng tiêu đề, tuỳ chọn */
  cardBadge?: (record: T) => ReactNode
  /** Lưới key-value hiển thị dưới tiêu đề — để mảng rỗng nếu không cần */
  cardMeta: ManageTableCardField<T>[]
  /** Khối nội dung phụ (vd danh sách đáp án) — nằm dưới meta, trên actions */
  cardExtra?: (record: T) => ReactNode
  /** Nút thao tác — bỏ qua nếu trang chỉ đọc */
  cardActions?: (record: T) => ReactNode
  emptyText?: string
}

/** Phân trang mặc định cho các trang quản lý — 50 dòng/trang, cho phép đổi */
const PHAN_TRANG_MAC_DINH = {
  defaultPageSize: 50,
  showSizeChanger: true,
  pageSizeOptions: ['20', '50', '100', '200'],
}

/**
 * Bảng dữ liệu thích ứng thiết bị: hiển thị Table antd bình thường từ tablet ngang/desktop (≥768px),
 * chuyển sang danh sách thẻ (List/Card) trên phone — tổng quát hoá pattern đã dùng ở QuizzesPage.
 *
 * Nhánh Table nhận nguyên mọi prop Table antd khác (components, expandable, onChange, rowClassName...)
 * qua passthrough — migrate 1 bảng đang có sẵn chỉ cần bọc lại, không mất tính năng ở desktop/tablet ngang.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ManageTable<T extends Record<string, any>>(props: ManageTableProps<T>) {
  const {
    cardHeading, cardBadge, cardMeta, cardExtra, cardActions, emptyText,
    columns, dataSource, rowKey, loading, rowSelection, size, pagination,
    ...restTableProps
  } = props
  const { screens } = useDeviceType()
  const isCardView = !screens.md
  // `pagination={false}` (tắt hẳn) vẫn được giữ nguyên, chỉ điền mặc định khi trang không khai báo
  const phanTrang = pagination ?? PHAN_TRANG_MAC_DINH

  const getKey = (record: T): string =>
    typeof rowKey === 'function' ? rowKey(record) : String(record[rowKey])

  if (!isCardView) {
    return (
      <Table<T>
        rowKey={rowKey}
        columns={columns}
        dataSource={dataSource}
        loading={loading}
        size={size ?? 'small'}
        pagination={phanTrang}
        rowSelection={rowSelection}
        {...restTableProps}
      />
    )
  }

  const selectedKeys = (rowSelection?.selectedRowKeys ?? []) as Key[]

  return (
    <List
      className="manage-card-list"
      loading={loading}
      dataSource={dataSource}
      // Cấu hình phân trang Table/List của antd tương thích cấu trúc nhưng khai báo type riêng — ép kiểu về đúng type của List
      pagination={phanTrang as PaginationConfig | false | undefined}
      locale={{ emptyText: emptyText ?? 'Không có dữ liệu' }}
      renderItem={(record) => {
        const key = getKey(record)
        const checked = selectedKeys.includes(key)
        return (
          <List.Item key={key}>
            <Card className="manage-record-card" bordered={false}>
              <div className="manage-record-heading">
                {rowSelection && (
                  <span className="manage-record-select">
                    <Checkbox
                      checked={checked}
                      onChange={(e) => {
                        const nextKeys = e.target.checked
                          ? [...selectedKeys, key]
                          : selectedKeys.filter((k) => k !== key)
                        const nextRows = dataSource.filter((r) => nextKeys.includes(getKey(r)))
                        rowSelection.onChange?.(nextKeys, nextRows, { type: 'multiple' })
                      }}
                    />
                  </span>
                )}
                <div>{cardHeading(record)}</div>
                {cardBadge?.(record)}
              </div>

              {cardMeta.length > 0 && (
                <dl className="manage-record-meta">
                  {cardMeta.map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd>{field.render(record)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {cardExtra && <div className="manage-record-extra">{cardExtra(record)}</div>}
              {cardActions && <div className="manage-record-actions">{cardActions(record)}</div>}
            </Card>
          </List.Item>
        )
      }}
    />
  )
}
