#!/usr/bin/env bash
#
# Prepara un PostgreSQL efímero con el esquema completo del BOS.
#
# Lo usan CI y quien quiera correr las pruebas de integración sin depender de un
# proyecto Supabase. Aplica, en orden:
#
#   1. El sustituto de `auth` y las contraseñas de los roles (solo local).
#   2. Todas las migraciones de supabase/migrations, en orden de nombre.
#   3. Las identidades de prueba.
#
# Es idempotente: reejecutarlo sobre la misma base no rompe nada.
#
#   bash scripts/setup-local-db.sh "postgresql://postgres@127.0.0.1:5433/bos_test?sslmode=require"
#
# Contra un proyecto real NO debe ejecutarse: el paso 1 crearía un auth.users
# falso y el 3 sembraría identidades de prueba. Para eso está `supabase db push`.
set -euo pipefail

TARGET="${1:?Falta la URL de PostgreSQL}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$TARGET" in
  *supabase.co*|*supabase.com*|*pooler.supabase*)
    echo "Este script no debe correr contra Supabase. Usa 'supabase db push'." >&2
    exit 1
    ;;
esac

psql "$TARGET" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed/local-postgres-bootstrap.sql"

for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "── $(basename "$migration")"
  psql "$TARGET" -q -v ON_ERROR_STOP=1 -f "$migration"
done

psql "$TARGET" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed/test-fixtures.sql"

echo "Esquema listo."
