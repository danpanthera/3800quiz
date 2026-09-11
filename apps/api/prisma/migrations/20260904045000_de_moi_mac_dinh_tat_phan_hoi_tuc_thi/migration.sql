-- Bộ đề tạo mới mặc định TẮT phản hồi tức thì (an toàn cho kỳ thi chính thức).
-- Các bộ đề đã có giữ nguyên giá trị true mà migration trước đã gán, để phần
-- luyện tập hiện tại vẫn chạy chế độ Quizizz.
ALTER TABLE "quizzes" ALTER COLUMN "instant_feedback" SET DEFAULT false;
