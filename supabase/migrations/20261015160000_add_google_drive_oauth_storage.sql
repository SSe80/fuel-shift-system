-- Store one administrator-authorized Google Drive connection.
-- The refresh token is AES-GCM encrypted by the Worker before it reaches this table.
CREATE TABLE IF NOT EXISTS public.drive_oauth_connection (
  id integer PRIMARY KEY CHECK (id = 1),
  encrypted_refresh_token text NOT NULL,
  google_email text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drive_oauth_connection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.drive_oauth_connection FROM anon, authenticated;
DROP POLICY IF EXISTS "No client access to Drive OAuth credentials" ON public.drive_oauth_connection;
COMMENT ON TABLE public.drive_oauth_connection IS
  'Server-only Google OAuth connection. encrypted_refresh_token must contain Worker-side AES-GCM ciphertext; never expose through client APIs.';
