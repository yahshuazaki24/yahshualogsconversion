CREATE TABLE public.ai_detection_access_state (id text PRIMARY KEY, message text NOT NULL, blocked_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.ai_detection_access_state TO service_role;
ALTER TABLE public.ai_detection_access_state ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ai_detection_access_state IS 'Service-only AI access-denial circuit breaker. Never stores uploaded samples, names, IDs or payroll logs.';