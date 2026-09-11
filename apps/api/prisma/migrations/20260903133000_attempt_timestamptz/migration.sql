ALTER TABLE "quiz_attempts"
  ALTER COLUMN "started_at" TYPE TIMESTAMPTZ(3) USING "started_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deadline_at" TYPE TIMESTAMPTZ(3) USING "deadline_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "last_saved_at" TYPE TIMESTAMPTZ(3) USING "last_saved_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "finalized_at" TYPE TIMESTAMPTZ(3) USING "finalized_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "quiz_attempt_answers"
  ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';