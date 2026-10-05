alter table public.interview_submissions
  alter column submitted_at drop not null,
  add column if not exists interview_mode text check (interview_mode in ('text', 'video')),
  add column if not exists current_question_index integer,
  add column if not exists question_start_times jsonb not null default '[]'::jsonb,
  add column if not exists session_expired_at timestamptz;
