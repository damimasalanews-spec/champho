CREATE TABLE IF NOT EXISTS public.migration_runner_test_state (
  id integer PRIMARY KEY,
  value integer NOT NULL
);

INSERT INTO public.migration_runner_test_state (id, value)
VALUES (1, 1)
ON CONFLICT (id)
DO UPDATE SET value = public.migration_runner_test_state.value + 1;
