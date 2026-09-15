import { InvalidCredentialsError } from 'ldapts';
import { LdapAuthService } from './ldap.service';

const bindMock = jest.fn();
const unbindMock = jest.fn();

jest.mock('ldapts', () => {
  const actual = jest.requireActual('ldapts');
  return {
    ...actual,
    Client: jest.fn().mockImplementation(() => ({
      bind: bindMock,
      unbind: unbindMock,
    })),
  };
});

describe('LdapAuthService.binhBangMatKhauAD', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    unbindMock.mockResolvedValue(undefined);
  });

  it('bind thành công → { ok: true }', async () => {
    bindMock.mockResolvedValue(undefined);
    const service = new LdapAuthService();

    const result = await service.binhBangMatKhauAD('nguyenvana', 'mat-khau-dung');

    expect(result).toEqual({ ok: true });
    expect(bindMock).toHaveBeenCalledWith('CORP\\nguyenvana', 'mat-khau-dung');
    expect(unbindMock).toHaveBeenCalled();
  });

  it('AD từ chối vì sai mật khẩu (InvalidCredentialsError) → { ok: false, lyDo: saiMatKhau }', async () => {
    bindMock.mockRejectedValue(new InvalidCredentialsError());
    const service = new LdapAuthService();

    const result = await service.binhBangMatKhauAD('nguyenvana', 'sai-mat-khau');

    expect(result).toEqual({ ok: false, lyDo: 'saiMatKhau' });
  });

  it('lỗi mạng/timeout (không phải sai mật khẩu) → { ok: false, lyDo: khongKetNoiDuoc }, không ném lỗi', async () => {
    bindMock.mockRejectedValue(new Error('connect ETIMEDOUT 10.73.0.11:636'));
    const service = new LdapAuthService();

    const result = await service.binhBangMatKhauAD('nguyenvana', 'bat-ky');

    expect(result).toEqual({ ok: false, lyDo: 'khongKetNoiDuoc' });
  });

  it('unbind lỗi (chưa từng bind được) không làm vỡ kết quả đã có', async () => {
    bindMock.mockResolvedValue(undefined);
    unbindMock.mockRejectedValue(new Error('chưa bind'));
    const service = new LdapAuthService();

    const result = await service.binhBangMatKhauAD('nguyenvana', 'mat-khau-dung');

    expect(result).toEqual({ ok: true });
  });
});
