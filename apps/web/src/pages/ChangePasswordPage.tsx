import { Button, Form, Input, Typography, message } from 'antd'
import { KeyOutlined, LockOutlined } from '@ant-design/icons'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { getDefaultRoute } from '../lib/permissions'

const { Title, Text } = Typography

interface ChangePasswordValues {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

export default function ChangePasswordPage() {
  const { user, markPasswordChanged } = useAuth()
  const navigate = useNavigate()

  const mutation = useMutation({
    mutationFn: ({ oldPassword, newPassword }: ChangePasswordValues) =>
      api.post('/auth/change-password', { oldPassword, newPassword }),
    onSuccess: () => {
      markPasswordChanged()
      message.success('Đổi mật khẩu thành công')
      if (user) navigate(getDefaultRoute(user.role), { replace: true })
    },
    onError: () => message.error('Không thể đổi mật khẩu. Vui lòng kiểm tra mật khẩu cũ.'),
  })

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="change-password-title">
        <div className="auth-panel-heading">
          <KeyOutlined aria-hidden />
          <div>
            <Title id="change-password-title" level={2}>Đổi mật khẩu</Title>
            <Text>Vui lòng đổi mật khẩu trước khi tiếp tục.</Text>
          </div>
        </div>

        <Form<ChangePasswordValues>
          layout="vertical"
          onFinish={(values) => mutation.mutate(values)}
          requiredMark={false}
        >
          <Form.Item
            label="Mật khẩu hiện tại"
            name="oldPassword"
            rules={[{ required: true, message: 'Vui lòng nhập mật khẩu hiện tại' }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            label="Mật khẩu mới"
            name="newPassword"
            rules={[
              { required: true, message: 'Vui lòng nhập mật khẩu mới' },
              { min: 6, message: 'Mật khẩu mới phải có ít nhất 6 ký tự' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="Nhập lại mật khẩu mới"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Vui lòng nhập lại mật khẩu mới' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || getFieldValue('newPassword') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('Mật khẩu nhập lại không khớp'))
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending} block>
            Cập nhật mật khẩu
          </Button>
        </Form>
      </section>
    </main>
  )
}