# Nube distribuida versus nube de un solo nodo

Rejourney admite dos formas de implementación oficiales autohospedadas:

- **Nodo único Docker Compose** para un servidor o VPS
- **Distribuido K3s** para clusters de producción y escalamiento horizontal

Ambos ahora usan el mismo modelo de backend central:

- los puntos finales de almacenamiento están respaldados por bases de datos
- Las cargas de ingesta pasan por el relé de carga propiedad del backend.
- Los trabajadores procesan artefactos verificados.
- la visibilidad de la repetición está basada en artefactos

---

## Comparación de características

| Característica | Nube distribuida | Nube de un solo nodo |
|---------|--------------------|-------------------|
| Plataforma | K3s | Docker Compose |
| Escala | Multinodo | Nodo único |
| Puntos de entrada públicos | Entrada Traefik | Contenedor Traefik |
| Subir ruta | API + servicio de ingesta y carga | API + servicio de ingesta y carga |
| Fuente de almacenamiento de la verdad | Mesa `storage_endpoints` | Mesa `storage_endpoints` |
| Almacenamiento de objetos predeterminado | Externo S3 | Integrado MinIO |
| Soporte externo S3 | Sí | Sí |
| Cifrado secreto | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Flujo de actualización | k8s implementar + trabajos | `deploy.sh update` |

---

## Modelo de almacenamiento compartido

En ambos modelos de implementación, la configuración del almacenamiento en tiempo de ejecución proviene de Postgres, no de un entorno alternativo.

Eso significa:

- el punto final de almacenamiento de objetos activo se almacena en `storage_endpoints`
- Las claves de acceso secretas están cifradas en `key_ref`.
- El tiempo de ejecución lee la fila de la base de datos.
- Los scripts de arranque/instalación son responsables de sincronizar la entrada `.env` en la fila de la base de datos.

Esto hace que el Docker autohospedado esté mucho más cerca de prod y local-k8s que el antiguo modelo alternativo.

---

## Cuándo elegir Docker Compose de nodo único

Elija Docker Compose cuando:

- está implementando en un VPS o en un host básico
- quieres la ruta de instalación más rápida
- desea tener MinIO integrado de forma predeterminada
- no necesita escalado de múltiples nodos ni operaciones Kubernetes

Puntos de entrada oficiales:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Cuándo elegir K3s distribuido

Elija K3s cuando:

- necesitas múltiples nodos
- quieres operaciones nativas Kubernetes y manejo de secretos
- desea escalar los servicios API, carga y trabajadores de forma independiente
- desea implementaciones continuas y un aislamiento de infraestructura más sólido

La ruta K3s se encuentra en `k8s/` y `scripts/k8s/`.

---

## Diferencia operativa

La principal diferencia ya no es el modelo de datos. Su forma operativa es:

- Compose: una máquina, una red Docker, un script de operador
- K3s: múltiples pods, espacios de nombres, ingreso de clúster, trabajos y secretos Kubernetes

---

## Orientación práctica

Comience con Compose de un solo nodo si desea autohospedarse rápidamente.

Vaya a K3s cuando necesite:

- más rendimiento
- Implementaciones continuas de clústeres
- escalado horizontal
- separación de infraestructura más resistente

---

## Documentos de arquitectura interna

Para obtener las últimas imágenes de ingeniería interna y detalles más detallados del operador:

- `dev_docs/ingest-session-recording-lifecycle.md` (diagrama del ciclo de vida de la sesión)
- `dev_docs/storage-and-endpoints.md` (diagrama de topología de múltiples depósitos)
- `dev_docs/allthingscloud.md` (diagrama de configuración de la nube de k3s)

### Ciclo de vida de la sesión

![Arquitectura del ciclo de vida de la sesión](./assets/session-lifecycle.svg)

### Topología de varios depósitos

![Topología de almacenamiento de múltiples depósitos](./assets/multi-bucket-topology.svg)

### Configuración de la nube K3s

![K3s arquitectura de nube distribuida](./assets/k3s-cloud-setup.svg)
