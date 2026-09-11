import { useState } from 'react'
import { Form, Input, Button, Typography, message } from 'antd'
import { BankOutlined, UserOutlined, LockOutlined, SafetyOutlined } from '@ant-design/icons'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api, { getErrorMessage } from '../lib/api'
import { useAuth } from '../lib/useAuth'

const { Title, Text } = Typography

interface LoginResponse {
  accessToken?: string
  user?: Parameters<ReturnType<typeof useAuth>['login']>[1]
  requiresTotp?: boolean
  pendingToken?: string
}

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  // Tài khoản bật xác thực 2 lớp: bước 1 chỉ trả pendingToken, phải nhập tiếp
  // mã 6 chữ số ở bước 2 mới lấy được access token thật.
  const [pendingToken, setPendingToken] = useState<string | null>(null)

  const finishLogin = (data: LoginResponse) => {
    if (!data.accessToken || !data.user) return
    login(data.accessToken, data.user)
    navigate('/')
  }

  const mutation = useMutation({
    mutationFn: (values: { username: string; password: string }) =>
      api.post('/auth/login', values).then((r) => r.data as LoginResponse),
    onSuccess: (data) => {
      if (data.requiresTotp && data.pendingToken) {
        setPendingToken(data.pendingToken)
        return
      }
      finishLogin(data)
    },
    onError: (e) => message.error(getErrorMessage(e, 'Sai tài khoản hoặc mật khẩu')),
  })

  const totpMutation = useMutation({
    mutationFn: (values: { code: string }) =>
      api
        .post('/auth/login/verify-totp', { pendingToken, code: values.code })
        .then((r) => r.data as LoginResponse),
    onSuccess: finishLogin,
    onError: (e) => message.error(getErrorMessage(e, 'Mã xác thực không đúng')),
  })

  return (
    <main className="login-page">
      <section className="login-brand" aria-label="3800Quiz">
        <div className="login-brand-lockup">
          <span className="login-brand-mark"><BankOutlined /></span>
          <Text>Hệ thống thi thử nghiệp vụ</Text>
        </div>
        <div className="login-brand-title">
          <Title level={1}>3800Quiz</Title>
          <p className="login-brand-statement">Thi thử nghiệp vụ<br />Đấu trường kiến thức</p>
        </div>
        <Text className="login-brand-footer">Agribank Chi nhánh Quảng Bình</Text>
      </section>

      <section className="login-form-region">
        <div className="login-form-wrap">
          <div className="login-mobile-brand">
            <span className="login-brand-mark"><BankOutlined /></span>
            <strong>3800Quiz</strong>
          </div>

          <header className="login-form-heading">
            <Text>{pendingToken ? 'Bảo mật 2 lớp' : 'Chào mừng trở lại'}</Text>
            <Title level={2}>{pendingToken ? 'Nhập mã xác thực' : 'Đăng nhập'}</Title>
          </header>

          {pendingToken ? (
            <Form layout="vertical" onFinish={totpMutation.mutate} size="large" requiredMark={false}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                Mở ứng dụng xác thực (Google Authenticator, Microsoft Authenticator...) và nhập mã 6 chữ số đang hiển thị.
              </Text>
              <Form.Item
                label="Mã xác thực"
                name="code"
                rules={[{ required: true, message: 'Vui lòng nhập mã 6 chữ số' }]}
                style={{ marginBottom: 24 }}
              >
                <Input
                  prefix={<SafetyOutlined />}
                  placeholder="123456"
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </Form.Item>
              <Form.Item className="login-submit-row">
                <Button type="primary" htmlType="submit" block loading={totpMutation.isPending}>
                  Xác nhận
                </Button>
              </Form.Item>
              <Button type="link" block onClick={() => setPendingToken(null)}>
                Quay lại đăng nhập
              </Button>
            </Form>
          ) : (
          <Form layout="vertical" onFinish={mutation.mutate} size="large" requiredMark={false}>
            <Form.Item
              label="User AD (VD: ducleminh6)"
              name="username"
              rules={[{ required: true, message: 'Vui lòng nhập User AD' }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="ducleminh6"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              label="Mật khẩu"
              name="password"
              rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }]}
              style={{ marginBottom: 24 }}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Mật khẩu này độc lập với mật khẩu vào máy"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item className="login-submit-row">
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={mutation.isPending}
              >
                Đăng nhập
              </Button>
            </Form.Item>
          </Form>
          )}

          <Text className="login-support">Liên hệ IT nếu tài khoản bị khóa.</Text>
        </div>
      </section>
    </main>
  )
}
