import { ArenaLatencyService } from './arena-latency.service';

describe('ArenaLatencyService', () => {
  let service: ArenaLatencyService;

  beforeEach(() => {
    service = new ArenaLatencyService();
  });

  it('chưa có mẫu nào thì getRttMs trả 0', () => {
    expect(service.getRttMs('socket-1')).toBe(0);
  });

  it('chưa có mẫu nào thì không bù (getCompensationMs = 0)', () => {
    expect(service.getCompensationMs('socket-1', 5000)).toBe(0);
  });

  it('getRttMs trả giá trị MIN của các mẫu, không phải trung bình', () => {
    service.record('socket-1', 300);
    service.record('socket-1', 100);
    service.record('socket-1', 200);
    expect(service.getRttMs('socket-1')).toBe(100);
  });

  it('cửa sổ chỉ giữ 8 mẫu gần nhất', () => {
    for (let i = 1; i <= 10; i++) service.record('socket-1', i * 100);
    // Mẫu 100 và 200 đã bị đẩy ra khỏi cửa sổ (window = 8) — min còn lại là 300
    expect(service.getRttMs('socket-1')).toBe(300);
  });

  it('loại bỏ mẫu âm', () => {
    service.record('socket-1', -50);
    expect(service.getRttMs('socket-1')).toBe(0);
  });

  it('loại bỏ mẫu quá lớn (> 5000ms, coi là client treo chứ không phải mạng)', () => {
    service.record('socket-1', 6000);
    expect(service.getRttMs('socket-1')).toBe(0);
  });

  it('loại bỏ mẫu không hữu hạn (NaN/Infinity)', () => {
    service.record('socket-1', NaN);
    service.record('socket-1', Infinity);
    expect(service.getRttMs('socket-1')).toBe(0);
  });

  it('client cố tình trả ack chậm không kéo được min xuống (chống gian lận)', () => {
    service.record('socket-1', 50); // mẫu thật, RTT mạng thực tế
    service.record('socket-1', 3000); // client cố tình trả chậm để "tạo lợi thế" giả
    service.record('socket-1', 2000);
    // min vẫn là 50 — mẫu chậm không hạ được ước lượng, chỉ có thể làm nó cao hơn
    expect(service.getRttMs('socket-1')).toBe(50);
  });

  it('getCompensationMs kẹp theo trần tuyệt đối 800ms', () => {
    service.record('socket-1', 2000); // RTT rất lớn nhưng vẫn hợp lệ (<5000)
    expect(service.getCompensationMs('socket-1', 10000)).toBe(800);
  });

  it('getCompensationMs kẹp theo tỉ lệ tối đa 1/2 thời gian thô', () => {
    service.record('socket-1', 2000);
    // rawResponseMs nhỏ (600ms) nên trần theo tỉ lệ (300ms) chặt hơn trần tuyệt đối (800ms)
    expect(service.getCompensationMs('socket-1', 600)).toBe(300);
  });

  it('getCompensationMs bù đúng RTT khi dưới mọi trần', () => {
    service.record('socket-1', 100);
    expect(service.getCompensationMs('socket-1', 5000)).toBe(100);
  });

  it('forget() xoá sạch mẫu của socket, quay về trạng thái chưa đo', () => {
    service.record('socket-1', 100);
    service.forget('socket-1');
    expect(service.getRttMs('socket-1')).toBe(0);
  });

  it('các socket độc lập với nhau', () => {
    service.record('socket-1', 50);
    service.record('socket-2', 400);
    expect(service.getRttMs('socket-1')).toBe(50);
    expect(service.getRttMs('socket-2')).toBe(400);
  });
});
