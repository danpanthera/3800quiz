import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isUserRole } from './permissions'
import { AuthContext, type AuthUser } from './useAuth'

// Xoá sạch mọi dấu vết phía trình duyệt — máy tính tại quầy/phòng giao dịch
// dùng chung nhiều cán bộ, không được để cán bộ sau thấy/kế thừa bất cứ gì
// của cán bộ trước: localStorage (token, user, tuỳ chọn giọng đọc...),
// sessionStorage, và cache asset tĩnh của service worker (Cache Storage API —
// KHÔNG có đề thi/điểm số trong đó, xem ghi chú workbox ở vite.config.ts,
// nhưng vẫn xoá cho triệt để theo đúng yêu cầu). Gọi ở CẢ 2 đầu: logout() bên
// dưới và lúc vào LoginPage (LoginPage.tsx).
export async function xoaSachCacheTrinhDuyet(): Promise<void> {
  localStorage.clear()
  sessionStorage.clear()
  if (typeof caches !== 'undefined') {
    try {
      const tenCacheHienCo = await caches.keys()
      await Promise.all(tenCacheHienCo.map((ten) => caches.delete(ten)))
    } catch {
      // Trình duyệt/ngữ cảnh không hỗ trợ Cache API (VD Safari riêng tư) — bỏ qua, không chặn luồng chính.
    }
  }
}

function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem('user')
  if (!raw) return null

  try {
    const value = JSON.parse(raw) as Partial<AuthUser>
    if (
      typeof value.id !== 'string' ||
      typeof value.username !== 'string' ||
      typeof value.fullName !== 'string' ||
      !isUserRole(value.role)
    ) {
      return null
    }

    return {
      id: value.id,
      username: value.username,
      fullName: value.fullName,
      role: value.role,
      mustChangePassword: value.mustChangePassword === true,
    }
  } catch {
    localStorage.removeItem('user')
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<AuthUser | null>(getStoredUser)

  function login(newToken: string, newUser: AuthUser) {
    localStorage.setItem('token', newToken)
    localStorage.setItem('user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  function markPasswordChanged() {
    if (!user) return
    const updatedUser = { ...user, mustChangePassword: false }
    localStorage.setItem('user', JSON.stringify(updatedUser))
    setUser(updatedUser)
  }

  function logout() {
    queryClient.clear()
    void xoaSachCacheTrinhDuyet()
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, login, markPasswordChanged, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
