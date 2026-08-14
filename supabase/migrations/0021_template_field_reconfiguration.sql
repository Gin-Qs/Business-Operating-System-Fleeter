-- 0021 — La única excepción a "bos_app no borra"
--
-- 0004 concede SELECT/INSERT/UPDATE y nunca DELETE, porque docs/03 §14.1
-- prohíbe el borrado físico de transacciones. Esa regla es correcta y se
-- mantiene: una entrega, una cotización o un asiento no se borran jamás.
--
-- `plt.document_template_field` no es una transacción. Es la CONFIGURACIÓN de un
-- borrador de plantilla: qué marcador del formato del tenant se llena con qué
-- dato. Reconfigurarla significa reemplazar el conjunto —quitar el campo que ya
-- no aparece en el formato nuevo, no dejarlo colgando—, y sin DELETE el tenant
-- solo puede agregar campos, nunca corregir los que sobran.
--
-- El hueco lo encontró una prueba de integración corriendo como `bos_app`, no
-- una revisión: la verificación manual de 0019 se hizo en psql como superusuario
-- y por eso el privilegio que faltaba no se notó. Vale la pena anotarlo: probar
-- con el rol de la aplicación es lo que distingue "funciona" de "funciona para
-- quien lo va a usar".
--
-- Lo que NO se relaja al conceder esto, y por eso es seguro:
--
--   1. RLS sigue vigente. La política `tenant_isolation` es `for all`, así que
--      su `using` también filtra el DELETE: nadie borra campos de otro tenant.
--   2. El trigger `document_template_field_frozen_when_published` cubre
--      `insert or update or delete`. Los campos de una plantilla PUBLICADA no se
--      borran: se versiona la plantilla.
--   3. Un documento ya emitido no depende de esta tabla. `plt.document_render`
--      guarda el cuerpo, el hash y los valores usados, así que reconfigurar un
--      borrador no puede alterar lo que alguien ya firmó.
--
-- El privilegio se concede en esta tabla y en ninguna otra.

grant delete on plt.document_template_field to bos_app;

comment on table plt.document_template_field is
  'Configuración de un marcador del formato del tenant. Única tabla donde bos_app puede borrar: es configuración de borrador, no una transacción, y el trigger la congela al publicar.';
