# Solución de problemas autohospedados

Utilice esta página si siguió a [Rejourney autohospedado](/docs/selfhosted) y algo falla o se comporta de manera extraña. Los comandos se ejecutan desde **raíz del repositorio** (donde vive `docker-compose.selfhosted.yml`).

---

## Comprobaciones rápidas

### Estado del servicio

```bash
./scripts/selfhosted/deploy.sh status
```

### Registros API

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Cargar registros de retransmisión

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Registros de trabajadores

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. La instalación o actualización falla antes o durante el arranque

### Síntomas

- `bootstrap` sale de un valor distinto de cero
- los servicios de aplicaciones nunca se vuelven saludables
- `status` muestra API o trabajadores esperando en el arranque
- instalar o actualizar salidas con `Database authentication failed before bootstrap.`

### cheques

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Causas comunes:

- malo `DATABASE_URL`
- las credenciales no coinciden (por ejemplo, de una implementación fallida anterior)
- falta `STORAGE_ENCRYPTION_KEY`
- Credenciales S3 no válidas
- URL de punto final S3 externa rota
- en **ARM64**, falta compatibilidad con imágenes (configure `DOCKER_DEFAULT_PLATFORM=linux/amd64` o use `./scripts/selfhosted/deploy.sh`, que lo configura cuando no está configurado)

Recuperación:

1. Si todavía tienes el `.env.selfhosted` original, restáuralo y ejecuta:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Si no necesita datos antiguos, borre y vuelva a instalar:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Mensajes de esquema/migración:** En una instalación normal, la base de datos comienza vacía y el arranque configura todo. Si ingresa **Postgres restaurado desde una copia de seguridad** a un nuevo servidor pero faltan metadatos de migración, o apuntó la pila a **base de datos incorrecta**, el arranque puede salir con un error sobre una base de datos inconsistente en lugar de sobrescribir sus datos. A menos que esté realizando una recuperación avanzada, corrija `DATABASE_URL` y restaure una copia de seguridad consistente, o comience desde un volumen limpio. Para una recuperación deliberada de solo migración, algunas configuraciones usan `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` en `.env.selfhosted` (consulte los documentos del mantenedor o soporte antes de usar esto).

### Arreglar

1. Si tiene el `.env.selfhosted` original, restáurelo y vuelva a ejecutar:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Si no tiene el `.env.selfhosted` original, limpie y reinstale:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` vuelve a ejecutar la sincronización del esquema, la semilla y el punto final de almacenamiento. `reset` elimina contenedores autohospedados y volúmenes de datos para que una instalación nueva pueda generar nuevas credenciales de forma segura.

---

## 2. Las sesiones se cuentan pero la reproducción permanece vacía

### Lo que esto suele significar ahora

Con la arquitectura actual, esto suele ser una de dos cosas:

- `ingest-upload` no pudo almacenar los bytes del artefacto
- `ingest-worker` no pudo procesar un artefacto cargado

El dispositivo ya no carga directamente en MinIO/S3, por lo que la accesibilidad al depósito desde el teléfono ya no es el principal sospechoso.

### cheques

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Buscar:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Causas comunes

- Credenciales S3 incorrectas en `.env.selfhosted`
- Falta el cucharón externo S3
- Punto final externo S3 inalcanzable desde la red Docker
- cargar retransmisión en mal estado
- trabajador atascado al volver a intentar artefactos fallidos

### Arreglar

- verificar los valores `S3_*`
- Si cambió la configuración de almacenamiento, vuelva a ejecutar:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. El panel se carga, pero las llamadas de autenticación o API fallan

### cheques

- El host del panel DNS apunta al servidor.
- El host API DNS apunta al servidor
- El host de ingesta DNS apunta al servidor.
- Los puertos `80` y `443` están abiertos.
- Let’s Encrypt ha emitido certificados

Inspeccionar:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS o problemas con certificados

Traefik gestiona los certificados automáticamente.

### cheques

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Asegúrese de que ambos nombres se resuelvan en el servidor que ejecuta la pila.

Si DNS estuvo mal durante la primera instalación, corrija DNS y vuelva a ejecutar:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. El S3 externo funciona en CLI, pero el Rejourney no puede cargar

Recuerde que la ruta de carga es del lado del servidor.

La ruta de red importante es:

- Contenedor `ingest-upload` -> su punto final S3

Pruebe desde el servidor revisando los registros de retransmisión y confirmando el punto final/depósito/claves en `.env.selfhosted`.

Si los cambió, vuelva a ejecutar:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Instalación integrada de MinIO, pero los artefactos aún fallan

### cheques

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

El one-shot `minio-setup` debería crear el depósito denominado `S3_BUCKET`.

Si cambió el nombre del depósito después de la primera instalación, ejecute:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Las páginas de facturación muestran facturación deshabilitada.

Esto es lo esperado a menos que se configuren las claves Stripe.

La pila ya no deshabilita la facturación porque es "autohospedada". Deshabilita la facturación porque Stripe no está configurado.

Si no configura las claves Stripe:

- La interfaz de usuario de facturación permanece en el estado autohospedado/ilimitado.
- Stripe el pago y los webhooks permanecen deshabilitados

---

## 8. El punto final de almacenamiento en Postgres es incorrecto después de cambiar `.env.selfhosted`

Correr:

```bash
./scripts/selfhosted/deploy.sh update
```

La ruta de actualización vuelve a ejecutar el arranque y resincroniza la fila activa `storage_endpoints`.

---

## 9. Necesidad de detener los servicios sin perder datos.

Usar:

```bash
./scripts/selfhosted/deploy.sh stop
```

Esto detiene únicamente los contenedores. No elimina volúmenes.

---

## 10. Necesita registros más profundos para un servicio

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
