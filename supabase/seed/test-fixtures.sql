-- Identidades de prueba — SOLO dev y test.
--
-- No es una migración a propósito: nunca debe correr en producción. Existen
-- únicamente para satisfacer la referencia org.user_account -> auth.users que
-- necesitan las pruebas de integración.
--
-- No pueden iniciar sesión: encrypted_password está vacío, así que ningún
-- intento de autenticación contra ellas puede tener éxito.
--
-- Aplicar con el rol administrativo del entorno de pruebas:
--   supabase db execute --file supabase/seed/test-fixtures.sql

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'alpha.owner@fleeter.test', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"fixture":true}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'beta.owner@fleeter.test', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"fixture":true}'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'alpha.auditor@fleeter.test', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"fixture":true}'),
  -- Sin membresía inicial: existe para probar el ciclo de invitación y alta.
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'alpha.invitee@fleeter.test', '',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"fixture":true}')
on conflict (id) do nothing;
