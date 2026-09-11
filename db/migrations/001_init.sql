-- 3800Quiz — Khởi tạo cơ sở dữ liệu (migration đầu tiên)
-- Schema PostgreSQL
-- Chạy bằng: psql -U postgres -d quiz3800 -f 001_init.sql

-- Bật extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Các kiểu enum
CREATE TYPE user_role AS ENUM ('STAFF', 'ADMIN', 'TRAINER');
CREATE TYPE question_type AS ENUM ('SINGLE', 'MULTIPLE');
CREATE TYPE assignment_status AS ENUM ('ACTIVE', 'CLOSED', 'DRAFT');
CREATE TYPE submission_status AS ENUM ('PENDING_SYNC', 'SYNCED', 'GRADED', 'SYNC_ERROR');
CREATE TYPE sync_status AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- Phòng ban
CREATE TABLE departments (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR(255) NOT NULL,
    code       VARCHAR(100) NOT NULL UNIQUE,
    parent_id  UUID REFERENCES departments(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Người dùng
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(255) NOT NULL,
    email         VARCHAR(255),
    department_id UUID REFERENCES departments(id),
    role          user_role NOT NULL DEFAULT 'STAFF',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bài quiz
CREATE TABLE quizzes (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title        VARCHAR(500) NOT NULL,
    description  TEXT,
    topic        VARCHAR(255),
    duration_min INTEGER NOT NULL DEFAULT 30,
    pass_score   INTEGER,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phiên bản quiz (snapshot khi publish)
CREATE TABLE quiz_versions (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quiz_id    UUID NOT NULL REFERENCES quizzes(id),
    version    INTEGER NOT NULL DEFAULT 1,
    snapshot   JSONB NOT NULL, -- toàn bộ nội dung quiz tại thời điểm version này
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (quiz_id, version)
);

-- Câu hỏi
CREATE TABLE questions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quiz_id       UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,
    question_type question_type NOT NULL DEFAULT 'SINGLE',
    order_index   INTEGER NOT NULL DEFAULT 0,
    points        INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phương án của câu hỏi (đáp án lựa chọn)
CREATE TABLE question_options (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    is_correct  BOOLEAN NOT NULL DEFAULT FALSE,
    order_index INTEGER NOT NULL DEFAULT 0
);

-- Giao bài (giao quiz cho người dùng/phòng ban)
CREATE TABLE assignments (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quiz_id       UUID NOT NULL REFERENCES quizzes(id),
    user_id       UUID REFERENCES users(id),        -- giao cá nhân
    department_id UUID REFERENCES departments(id),  -- giao phòng ban
    start_at      TIMESTAMPTZ,
    end_at        TIMESTAMPTZ,
    status        assignment_status NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT assignment_target_check CHECK (user_id IS NOT NULL OR department_id IS NOT NULL)
);

-- Bài nộp (UUID từ app làm idempotency key)
CREATE TABLE submissions (
    id              UUID PRIMARY KEY, -- UUID do app tạo, idempotent
    user_id         UUID NOT NULL REFERENCES users(id),
    quiz_id         UUID NOT NULL REFERENCES quizzes(id),
    quiz_version_id UUID NOT NULL REFERENCES quiz_versions(id),
    status          submission_status NOT NULL DEFAULT 'PENDING_SYNC',
    score           NUMERIC(5,2),
    is_passed       BOOLEAN,
    started_at      TIMESTAMPTZ,
    submitted_at    TIMESTAMPTZ,
    synced_at       TIMESTAMPTZ,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    last_retry_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Câu trả lời trong bài nộp
CREATE TABLE submission_answers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id       UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    question_id         UUID NOT NULL REFERENCES questions(id),
    selected_option_ids JSONB NOT NULL, -- mảng UUID của các phương án
    answered_at         TIMESTAMPTZ NOT NULL
);

-- Outbox đồng bộ (hàng đợi đồng bộ dữ liệu từ app lên server)
CREATE TABLE sync_outbox (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type  VARCHAR(50) NOT NULL,  -- 'submission'
    entity_id    UUID NOT NULL,
    payload      JSONB NOT NULL,
    status       sync_status NOT NULL DEFAULT 'PENDING',
    retry_count  INTEGER NOT NULL DEFAULT 0,
    last_tried_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nhật ký audit
CREATE TABLE audit_logs (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id),
    action     VARCHAR(100) NOT NULL, -- LOGIN, DOWNLOAD_QUIZ, START_QUIZ, SUBMIT, SYNC
    entity_id  UUID,
    meta       JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chỉ mục
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_assignments_quiz ON assignments(quiz_id);
CREATE INDEX idx_assignments_user ON assignments(user_id);
CREATE INDEX idx_assignments_dept ON assignments(department_id);
CREATE INDEX idx_submissions_user ON submissions(user_id);
CREATE INDEX idx_submissions_quiz ON submissions(quiz_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_synced_at ON submissions(synced_at);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_sync_outbox_status ON sync_outbox(status);
