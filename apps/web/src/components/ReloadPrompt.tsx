import { useEffect } from 'react'
import { App, Button, Space } from 'antd'
import { useRegisterSW } from 'virtual:pwa-register/react'

// Tab để mở lâu (máy phòng giao dịch treo cả ngày) vẫn biết có bản mới, không
// cần đợi người dùng tự mở lại tab.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const NOTIFICATION_KEY = 'pwa-new-version'

// vite.config.ts đặt registerType: 'prompt' để bản mới KHÔNG tự tải lại giữa lúc
// đang làm bài. Nhưng 'prompt' nghĩa là app phải tự hỏi người dùng — không có
// component này thì service worker mới chỉ được kích hoạt khi đóng HẾT các tab,
// cán bộ có thể kẹt ở bản cũ nhiều ngày sau khi máy chủ đã cập nhật.
export default function ReloadPrompt() {
  const { notification } = App.useApp()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS)
    },
  })

  useEffect(() => {
    if (!needRefresh) return
    notification.info({
      key: NOTIFICATION_KEY,
      message: 'Có phiên bản mới của 3800Quiz',
      description: 'Tải lại trang để dùng bản mới nhất. Nếu đang làm bài, hãy nộp bài xong rồi mới tải lại.',
      placement: 'bottomRight',
      duration: 0,
      onClose: () => setNeedRefresh(false),
      btn: (
        <Space>
          <Button size="small" onClick={() => notification.destroy(NOTIFICATION_KEY)}>
            Để sau
          </Button>
          <Button size="small" type="primary" onClick={() => void updateServiceWorker(true)}>
            Tải lại ngay
          </Button>
        </Space>
      ),
    })
  }, [needRefresh, notification, setNeedRefresh, updateServiceWorker])

  return null
}
