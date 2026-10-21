# Seguridad y despliegue

Auditoría de la API, la imagen, el chart de Helm y la CI, con el estado de cada hallazgo y qué hace cada control. Cada capa supone que la anterior puede fallar (*defensa en profundidad*).

```bash
make audit     # pip-audit, pnpm audit y zizmor, lo mismo que la CI
```

## Estado

| # | Riesgo | Hallazgo | Estado |
| --- | --- | --- | --- |
| S1 | Medio | Actions de la CI por tag flotante (`@v7`): un tag se puede mover, como pasó con `tj-actions/changed-files` en 2025 | ✅ Todas fijadas por SHA de commit, con el tag en un comentario |
| S2 | Medio | Sin escaneo continuo de dependencias, imagen, código ni workflows | ✅ `security.yml` (pip-audit, Trivy, CodeQL, zizmor) y Dependabot |
| S3 | Bajo | pillow 12.3 con 8 CVE en decodificadores de imagen (inalcanzables: la API solo procesa texto) | ✅ Forzado a pillow 13 con `override-dependencies` y validado en CI con el modelo real |
| S4 | Medio | DoS por coste: sin límite de peticiones ni de tamaño de body; `requirements` sin tope | ✅ Límite por IP en `/search` y `/plan`, body ≤ 16 KiB, ≤ 20 requisitos |
| S5 | Bajo | Los 503 devolvían rutas internas y texto de excepciones | ✅ Mensajes genéricos; el detalle va al log |
| S6 | Bajo | CORS fijo y `allow_headers=*`; `/docs` siempre público | ✅ `CORS_ORIGINS` y `API_DOCS` por variable de entorno, cabeceras CORS explícitas |
| S7 | Bajo | El modelo se descargaba sin comprobar sus bytes | ✅ SHA-256 del ONNX fijado (`PINNED_ONNX_SHA256`): otro archivo falla al cargar |
| S8 | Bajo | Imágenes base por tag mutable | ✅ Por digest, actualizadas por Dependabot |
| D1 | **Alto** | Límite de 256 Mi con un consumo real de ~300 MiB: `/search` acababa en OOMKilled | ✅ 320 Mi de request, 512 Mi de límite, y el smoke test llama a `/search` |
| D2 | **Alto** | Readiness en `/health`: un Pod sin índice o sin modelo se marcaba Ready | ✅ `/ready` real, precalentamiento al arrancar y `startupProbe` |
| D3 | Medio | La imagen no podía correr en Lambda | ✅ Target `lambda` del Dockerfile con el Lambda Web Adapter; la imagen por defecto (Kubernetes) no lo lleva |
| D4 | Medio | Dos réplicas sin PDB ni reparto entre nodos | ✅ PodDisruptionBudget y `topologySpreadConstraints` |
| D5 | Medio | Imagen sin publicar, sin SBOM ni firma, con tag mutable | ✅ `release.yml`: escaneo, push a GHCR, SBOM, provenance y firma cosign |
| D6 | Medio | Imagen de 809 MB (lancedb y pyarrow) | ⏳ Aceptado: LanceDB es lo que permite el índice en S3 (decisión 6). A revisar cuando se decida Lambda o EKS |
| D7 | Bajo | Sin logs estructurados, request-id ni métricas | ✅ Logs JSON con request-id y `/metrics` de Prometheus |
| D8 | Bajo | Sin NetworkPolicy ni ServiceAccount propia | ✅ NetworkPolicy *default deny* (sin salida) y SA dedicada sin token |

## La API

| Control | Dónde | Por qué |
| --- | --- | --- |
| **Rate limit** por IP (60/min en `/search` y `/plan`, `RATE_LIMIT_PER_MINUTE`) | `api/middleware.py` | Cada búsqueda gasta CPU calculando un embedding. Va en memoria y por proceso: con N réplicas el límite efectivo es N veces mayor. Es un respaldo; **el límite real va en el borde** (throttling de API Gateway, anotaciones del Ingress o una regla *rate-based* de WAF), que ve el tráfico de todas las réplicas. Devuelve 429 con `Retry-After`. |
| **Tamaño de body** ≤ 16 KiB (`MAX_BODY_BYTES`) | `api/middleware.py` | Sin límite, un body de varios GB se lee entero en memoria. Se aplica también sin `Content-Length` (subidas por trozos). Devuelve 413. |
| **Validación de entrada** | `api/schemas.py`, `main.py` | `q` ≤ 200 caracteres, `k` ≤ 20, `text` ≤ 1000, como mucho 20 `requirements` de ≤ 32 caracteres. Pydantic responde 422 antes de que el código lo vea. |
| **Errores genéricos** | `main.py` | El cliente recibe "search index not available; run `brain embed`". La ruta y la excepción van al log. Una ruta interna o una traza le sirven a un atacante, no a un usuario. |
| **Cabeceras de seguridad** | `api/middleware.py` | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y `Content-Security-Policy: default-src 'none'`: una API JSON nunca debe renderizarse como página. `/docs` lleva todas menos la CSP, porque Swagger UI carga de un CDN, y se puede desactivar con `API_DOCS=0`. |
| **CORS** | `main.py` | Solo los orígenes de `CORS_ORIGINS`, solo `GET` y `POST`, solo `content-type` y `x-request-id`, y **sin credenciales**. CORS no es autenticación: protege a los navegadores de los usuarios, no a la API (un `curl` lo ignora). |
| **Sin cabecera `Server`** | `Dockerfile` (`--no-server-header`) | No anuncia uvicorn ni su versión. |
| **IP real tras un proxy** | `--proxy-headers` + `FORWARDED_ALLOW_IPS` | Uvicorn solo cree `X-Forwarded-For` si viene de un proxy de confianza. Si se confiara en cualquiera, un cliente podría falsear su IP y saltarse el rate limit. |

## La imagen

| Control | Por qué |
| --- | --- |
| **Usuario no root** (UID 10001) y **archivos de root** | El proceso no puede modificar su código, el modelo ni el índice, ni siquiera con el sistema de archivos escribible. |
| **Base por digest** (`python:3.12-slim@sha256:…`) | Un tag puede cambiar de contenido de un día para otro; un digest no. Dependabot propone el digest nuevo. |
| **Modelo e índice dentro**, `HF_HUB_OFFLINE=1` | Arranca sin red, siempre con los mismos bytes, y permite cerrar toda la salida con la NetworkPolicy. |
| **Integridad del modelo** | El SHA-256 del `.onnx` está fijado en `PINNED_ONNX_SHA256`: si el repositorio de Hugging Face cambia los bytes, cargar el modelo falla (`ModelIntegrityError`) en vez de cambiar en silencio todos los vectores. El digest también forma parte de la versión del modelo guardada en el índice. |
| **Escaneo con Trivy** en cada PR y antes de publicar | Falla con vulnerabilidades HIGH o CRITICAL que tengan arreglo. Las aceptadas se apuntan en `.trivyignore`, con el motivo. |

## Kubernetes

Está en [K8S.md](K8S.md). En resumen:
- Pod Security **restricted**, aplicada al namespace en CI: no root, sin escalada, `drop: [ALL]`, seccomp y sistema de archivos de solo lectura. `values.schema.json` impide desactivarlo por error.
- **NetworkPolicy *default deny***: solo entra el puerto de la API y **no sale nada**, ni siquiera al endpoint de metadatos de la nube.
- ServiceAccount propia sin token.
- PDB y reparto entre nodos y zonas.
- Recursos medidos.
- Probes que distinguen arrancar, estar listo y estar vivo.

## La cadena de suministro (CI/CD)

| Control | Dónde | Por qué |
| --- | --- | --- |
| **Actions fijadas por SHA** | todos los workflows | Una action se ejecuta con tu token y ve tu código. Un tag (`@v7`) puede reasignarse a un commit malicioso; un SHA no. |
| **`permissions: contents: read`** por defecto | todos los workflows | El token solo puede leer. Cada job pide lo que necesita (`packages: write` para publicar, `id-token: write` para firmar). |
| **`persist-credentials: false`** | cada `checkout` | Si no, el token queda guardado en `.git/config` y cualquier paso o artefacto posterior puede leerlo. |
| **Sin cachés al publicar** | `release.yml` | Una caché envenenada acabaría dentro de una imagen firmada. El job que firma no confía en nada que no haya construido él. |
| **pip-audit** | `security.yml` | CVE en las dependencias de Python que lleva la imagen (sin las de desarrollo). |
| **Trivy** (repositorio) | `security.yml` | CVE en `uv.lock` y `pnpm-lock.yaml`, secretos subidos por error y malas configuraciones en el Dockerfile, el chart y los workflows. Los resultados van a la pestaña *Security*. |
| **CodeQL** | `security.yml` | Análisis estático de Python, TypeScript y los propios workflows (inyecciones, flujos de datos inseguros). |
| **zizmor** | `security.yml` | Fallos típicos de GitHub Actions: inyección de plantillas, credenciales persistentes, cache poisoning, permisos excesivos. |
| **Dependabot** | `.github/dependabot.yml` | PRs semanales para Python, npm, actions e imágenes base. Fijar sin actualizar solo congela las vulnerabilidades. |
| **Semanal, aunque nada cambie** | `security.yml` (`schedule`) | Las CVE nuevas aparecen en dependencias que llevan meses sin tocarse. |

## Publicar y verificar una imagen

`release.yml` corre solo en `main`. Construye la imagen, la **escanea** (falla con HIGH o CRITICAL), la publica en `ghcr.io/hermida95/infra-atlas-api` con un tag por SHA del commit, adjunta un **SBOM** (qué lleva dentro) y la **provenance** SLSA (cómo, dónde y desde qué commit se construyó), y la **firma con cosign sin claves**: la identidad es la del propio workflow, emitida por el OIDC de GitHub y registrada en el log público de Sigstore. El resumen del job muestra el digest.

Quien despliega comprueba la firma antes de usar la imagen:

```bash
cosign verify ghcr.io/hermida95/infra-atlas-api@sha256:<digest> \
  --certificate-identity-regexp '^https://github.com/Hermida95/infra-atlas/.github/workflows/release.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

helm upgrade --install atlas infra/helm/api \
  --set image.repository=ghcr.io/hermida95/infra-atlas-api \
  --set image.digest=sha256:<digest>
```

En un cluster real, un *admission controller* (Kyverno, o el policy-controller de Sigstore) puede exigir esa firma y rechazar cualquier imagen sin ella. La primera vez, el paquete de GHCR se crea privado: hazlo público en *Package settings* si quieres que cualquiera pueda descargarlo.

## Lambda

El Dockerfile tiene un target `lambda`: la misma imagen más el [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) en `/opt/extensions`. En Lambda se ejecuta el `CMD` de la imagen, que es lo que arranca uvicorn; el adaptador es una extensión de Lambda que corre al lado, espera a que `/ready` responda 200 y hace de proxy: traduce los eventos de Lambda a peticiones HTTP contra ese uvicorn.

```bash
docker build -f apps/api/Dockerfile --target lambda -t infra-atlas-api:lambda .
```

La imagen por defecto (Compose, Kubernetes, CI) no lo lleva: menos componentes, menos superficie de ataque. Además, ECR Public limita las descargas anónimas (los runners de GitHub ya topan con su *429 Data limit exceeded*), así que la CI no depende de él. Al desplegar en Lambda:
- Memoria ≥ 1024 MB: la CPU de Lambda escala con la memoria, y el modelo necesita ~300 MiB.
- El precalentamiento ocurre en la fase *init*, una vez por entorno de ejecución, no en cada petición.
- El rol de ejecución solo necesita permisos de logs (y `bedrock:InvokeModel` si se cambia de proveedor).
- El límite de peticiones va en API Gateway (throttling por stage o por clave).
- Construir el target desde AWS (CodeBuild) o con `docker login public.ecr.aws`: las descargas autenticadas no tienen ese límite.

## Pendiente

- **D6, tamaño de imagen:** medir la alternativa con numpy en memoria (unos −350 MB) cuando se decida entre Lambda y EKS.
- **Edge:** WAF (reglas gestionadas de AWS más una *rate-based*) y throttling de API Gateway, al montar la infraestructura con Terraform.
- **Licencia:** el repositorio no declara ninguna. Elegirla también es una decisión de seguridad legal para quien lo reutilice.
