-- Motion Runner public leaderboard. Run this once in the Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS public.leaderboard_entries (
  player_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'classic-run' CHECK (mode = 'classic-run'),
  player_name text NOT NULL CHECK (char_length(btrim(player_name)) BETWEEN 1 AND 24),
  score integer NOT NULL CHECK (score BETWEEN 0 AND 220),
  cleared integer NOT NULL CHECK (cleared BETWEEN 0 AND 22),
  collisions integer NOT NULL CHECK (collisions BETWEEN 0 AND 22),
  achieved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, mode),
  CHECK (cleared + collisions <= 22),
  CHECK (score <= cleared * 10),
  CHECK (score >= greatest(0, cleared * 10 - collisions * 5))
);

CREATE INDEX IF NOT EXISTS leaderboard_entries_order
  ON public.leaderboard_entries (mode, score DESC, cleared DESC, achieved_at ASC, player_id ASC);

ALTER TABLE public.leaderboard_entries ENABLE ROW LEVEL SECURITY;

-- The browser never accesses this table directly. Hono uses the server-only Supabase secret.
REVOKE ALL ON TABLE public.leaderboard_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.leaderboard_entries TO service_role;

CREATE OR REPLACE VIEW public.leaderboard_ranked
WITH (security_invoker = true)
AS
SELECT
  row_number() OVER (
    PARTITION BY mode
    ORDER BY score DESC, cleared DESC, achieved_at ASC, player_id ASC
  ) AS rank,
  player_id,
  mode,
  player_name,
  score,
  cleared,
  collisions,
  achieved_at
FROM public.leaderboard_entries;

REVOKE ALL ON TABLE public.leaderboard_ranked FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.leaderboard_ranked TO service_role;

CREATE OR REPLACE FUNCTION public.submit_leaderboard_score(
  p_player_id uuid,
  p_mode text,
  p_player_name text,
  p_score integer,
  p_cleared integer,
  p_collisions integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  did_improve boolean;
BEGIN
  IF p_player_id IS NULL
    OR p_mode <> 'classic-run'
    OR p_player_name IS NULL
    OR char_length(btrim(p_player_name)) NOT BETWEEN 1 AND 24
    OR p_score IS NULL OR p_score NOT BETWEEN 0 AND 220
    OR p_cleared IS NULL OR p_cleared NOT BETWEEN 0 AND 22
    OR p_collisions IS NULL OR p_collisions NOT BETWEEN 0 AND 22
    OR p_cleared + p_collisions > 22
    OR p_score > p_cleared * 10
    OR p_score < greatest(0, p_cleared * 10 - p_collisions * 5)
  THEN
    RAISE EXCEPTION 'Invalid leaderboard score';
  END IF;

  INSERT INTO public.leaderboard_entries (
    player_id, mode, player_name, score, cleared, collisions, achieved_at
  )
  VALUES (
    p_player_id, p_mode, btrim(p_player_name), p_score, p_cleared, p_collisions, now()
  )
  ON CONFLICT (player_id, mode) DO UPDATE SET
    player_name = EXCLUDED.player_name,
    score = EXCLUDED.score,
    cleared = EXCLUDED.cleared,
    collisions = EXCLUDED.collisions,
    achieved_at = EXCLUDED.achieved_at
  WHERE EXCLUDED.score > public.leaderboard_entries.score
  RETURNING true INTO did_improve;

  RETURN coalesce(did_improve, false);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_leaderboard_score(uuid, text, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_leaderboard_score(uuid, text, text, integer, integer, integer)
  TO service_role;
