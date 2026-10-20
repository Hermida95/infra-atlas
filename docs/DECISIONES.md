# Decisiones de arquitectura: Infra Atlas (nombre provisional)
Fecha: 2026-10-20 · Estado: aceptadas

## Contexto
Web de portfolio y base de conocimiento: el "cerebro" de un senior DevOps & AI engineer.
Se presenta como un **viaje visual** de una aplicación desde `localhost` hasta producción en AWS
(Docker → Terraform → Kubernetes → AWS → CI/CD → observabilidad → IA), apoyado en un grafo de
conocimiento buscable que crece con el tiempo.

- **Público:** el propio autor (estudio, AWS SAA-C03), profesionales y reclutadores.
- **Escala:** tráfico bajo al principio; contenido pensado para crecer hasta cientos o miles de fichas.
- **Presupuesto:** 0–5 €/mes en AWS más el dominio.
- **Idioma del contenido:** inglés. La documentación interna está en español.
- **Restricciones:** stack base Python; el diseño es prioritario; más adelante habrá cuentas y contenido de pago.
- **Principio rector:** *el proyecto se despliega siguiendo el viaje que enseña*. Cada parada enlaza a código real del repo.
- **Enfoque (decidido el 2026-10-20):** **explicaciones interactivas, no una enciclopedia.**
  - Cada concepto se entiende *viéndolo y tocándolo*: por ejemplo, en Docker se ve cómo un Dockerfile genera capas, cómo las capas forman una imagen y cómo la imagen arranca un contenedor.
  - El texto acompaña al visual, no al revés.
  - Prima la calidad de cada parada sobre el número de fichas.
  - El pago pasa a ser secundario.

## Resumen del stack
| Capa | Elección | Por qué |
|---|---|---|
| Forma | Web (Next.js) + API Python + pipeline de contenido | Impacto visual en TS, la ingeniería en Python |
| Repo | Monorepo: pnpm (JS) + uv (Python) + Makefile | Un solo PR cambia contenido, web, API e infraestructura juntos |
| Frontend | Next.js (App Router, TypeScript) | Base para logins y muros de pago (SSR y middleware) |
| Diseño | Tailwind v4 + primitivas Radix/shadcn muy personalizadas + Motion + GSAP ScrollTrigger + React Flow | Animación con scroll para el viaje y diagramas interactivos |
| Contenido | MDX en git: nodos atómicos tipados + recorridos (journeys) en YAML | El grafo sale de los metadatos; los trozos pequeños dan buen RAG |
| Esquema | Pydantic como única fuente de verdad → JSON Schema → tipos TS y Zod | Python y TypeScript nunca discrepan sobre qué es una ficha |
| Pipeline | CLI en Python `brain` (Typer): `new`, `validate`, `graph`, `embed` | Disciplina de metadatos automatizada; aquí está el Python de ingeniería |
| Backend | FastAPI en imagen Docker → AWS Lambda (Lambda Web Adapter) | La misma imagen corre en compose, en kind y en Lambda |
| Búsqueda | F1: búsqueda de texto en el cliente (índice generado al compilar). F2: búsqueda semántica en la API | Coste cero primero, IA después |
| Vectores | LanceDB sobre S3 (generado en CI) | Sin base de datos encendida: céntimos al mes |
| IA | Claude vía Amazon Bedrock (modelo pequeño para RAG) + embeddings en Bedrock | Se queda en AWS, autenticación por IAM sin claves de API |
| Datos de usuario (F3) | DynamoDB bajo demanda | Serverless, capa gratuita amplia, sin servidor |
| Auth (F3) | Amazon Cognito | Nativo de AWS, JWT verificable por Next.js y FastAPI, gestionado con Terraform |
| Pagos (F3) | Stripe Checkout + webhooks → Lambda | Estándar; no se toca ningún dato de tarjeta |
| Hosting web | OpenNext → Lambda + S3 + CloudFront, todo con Terraform | Infraestructura como código propia; casi 0 € con poco tráfico |
| IaC | Terraform: módulos + `envs/dev`, `envs/prod`; estado en S3 con bloqueo nativo | Estándar del mercado y núcleo del portfolio |
| CI/CD | GitHub Actions + OIDC hacia AWS | Sin claves de AWS de larga duración |
| Kubernetes | Chart de Helm de la API, probado en un cluster `kind` dentro de CI; módulo de EKS documentado y desplegable bajo demanda | K8s real demostrado a 0 €/mes |
| Observabilidad | CloudWatch + Powertools for AWS Lambda (Python) + X-Ray + alarmas de AWS Budgets | Logs estructurados, trazas y control de gasto |
| Local | Docker Compose (web + api + LocalStack) | `make dev` y el viaje empieza en localhost de verdad |
| Calidad | ruff, pyright, pytest · eslint, vitest, Playwright · tflint, checkov, trivy | Cada capa con su red de seguridad |

## Diagrama
```
                         ┌──────────────── AWS ────────────────────────────────┐
 Usuario ──HTTPS──▶ CloudFront (CDN, cabeceras de seguridad)                    │
                     ├── /_next/static, /assets ─▶ S3 (estáticos)               │
                     ├── páginas (SSG/SSR) ──────▶ Lambda: servidor Next (OpenNext)
                     └── /api/* ─────────────────▶ API Gateway ─▶ Lambda: FastAPI (imagen en ECR)
                                                      │            ├─▶ S3: LanceDB (vectores) + graph.json
                                                      │            ├─▶ Bedrock: embeddings + Claude (RAG)
                                                      │            └─▶ DynamoDB: usuarios, cuotas, suscripciones (F3)
                                                    Cognito (F3)   Stripe webhooks (F3)
                         └──────────────────────────────────────────────────────┘

 git push ─▶ GitHub Actions ─(OIDC)─▶ brain validate · tests · build · docker → ECR
                                      kind + helm (prueba K8s) · terraform plan/apply
```

## Decisiones

### 1. Frontend: Next.js
- **Opciones valoradas:** Astro + islas de React, Next.js, SvelteKit.
- **Elegida y motivo:** Next.js. Habrá logins y contenido de pago, y eso pide SSR y middleware. Además suma en el CV.
- **Qué se pierde / riesgo:** la web pesa más que con Astro, y el pipeline de contenido hay que montarlo a mano (MDX + esquema).
- **Cuándo revisarla:** no aplica a corto plazo.

### 2. Hosting: OpenNext + Terraform en AWS, por fases
- **Opciones valoradas:** OpenNext + Terraform, Amplify Hosting, Vercel.
- **Elegida y motivo:** OpenNext + Terraform. La infraestructura es tuya y visible en el repo, y el despliegue de la propia web es una parada del viaje.
  - F1: páginas públicas generadas de forma estática.
  - F3: se activan SSR y middleware para el muro de pago.
- **Qué se pierde / riesgo:** más trabajo inicial; las funciones nuevas de Next.js pueden llegar con retraso a OpenNext.
- **Cuándo revisarla:** si una versión de Next.js que necesitemos tarda más de dos meses en estar soportada, valorar Amplify.

### 3. Modelo de contenido: nodos atómicos tipados + recorridos
- **Opciones valoradas:** nodos atómicos, páginas largas por tema, CMS externo.
- **Elegida y motivo:** nodos atómicos (`concept`, `service`, `tool`, `pattern`, `howto`, `comparison`, `lab`) con relaciones tipadas (`requires`, `part-of`, `alternative-to`, `used-by`) y recorridos curados que los reutilizan.
- **Ampliación (2026-10-20):** cada ficha declara además `satisfies`, `when` y `stage`. Con esos campos el **planificador** de la home ("¿qué vas a desplegar?") decide qué nodos encender sin reglas escritas en el código. Ver [DISENO.md](DISENO.md).
- **Qué se pierde / riesgo:** exige disciplina con los metadatos. Se mitiga con `brain validate` en CI: una ficha con una relación rota no se publica.
- **Cuándo revisarla:** si el producto pasa a ser un curso lineal.

### 4. Repo: monorepo
- **Opciones valoradas:** monorepo, un repo por pieza.
- **Elegida y motivo:** monorepo. Las piezas cambian juntas (una ficha nueva puede tocar contenido, un diagrama y una lab) y un reclutador lo ve todo en un sitio.
- **Qué se pierde / riesgo:** el CI tiene que filtrar por rutas para no compilarlo todo en cada push.
- **Cuándo revisarla:** si alguna pieza llega a tener otro equipo u otro ciclo de versiones.

### 5. Backend: FastAPI en contenedor sobre Lambda
- **Opciones valoradas:** Lambda con contenedor (Web Adapter), Lambda con zip + Mangum, ECS Fargate.
- **Elegida y motivo:** contenedor + Lambda Web Adapter. FastAPI no sabe que está en Lambda, y la **misma imagen** corre en Docker Compose, en el cluster `kind` y en AWS. Es el viaje hecho literal.
- **Qué se pierde / riesgo:** el cold start con imagen de contenedor ronda 1–2 s. Se mitiga con una imagen pequeña (multi-stage, slim).
- **Cuándo revisarla:** tráfico sostenido alto, o latencia crítica → Fargate.

### 6. Cerebro IA: búsqueda en dos fases y RAG
- **Opciones valoradas:** pgvector en RDS o Neon, OpenSearch, LanceDB sobre S3, numpy en memoria.
- **Elegida y motivo:**
  - F1: índice de texto en el cliente, sin coste.
  - F2: embeddings calculados en CI y guardados como tabla LanceDB en S3; la API consulta por significado.
  - F3: asistente RAG con Claude en Bedrock, **solo para usuarios con sesión** (controla el coste y es una ventaja de pago).
- **Qué se pierde / riesgo:** un endpoint de IA público puede dispararse en coste. Se mitiga con: el asistente solo con sesión, throttling en API Gateway, cuota diaria por usuario en DynamoDB y alarma de AWS Budgets.
- **Cuándo revisarla:** más de unas 50k fichas, o necesidad de filtros complejos → pgvector.

### 7. Auth y pagos (fase 3): Cognito + Stripe
- **Opciones valoradas:** Cognito, Auth.js, Clerk · Stripe, Lemon Squeezy.
- **Elegida y motivo:** Cognito, porque es nativo de AWS y sus JWT los valida tanto Next.js como FastAPI. Stripe Checkout, porque la tarjeta nunca pasa por nuestros servidores.
- **Qué se pierde / riesgo:** la experiencia de desarrollo con Cognito es peor que con Clerk.
- **Cuándo revisarla:** al empezar la fase 3, revisar precios y opciones del momento.

### 8. Kubernetes: demostrado, no pagado
- **Opciones valoradas:** EKS siempre encendido, Kubernetes solo didáctico, kind en CI.
- **Elegida y motivo:** chart de Helm real de la API, desplegado en un cluster `kind` dentro de GitHub Actions con un smoke test en cada PR. El módulo de Terraform para EKS está documentado y se puede levantar y destruir para demos.
- **Qué se pierde / riesgo:** no hay un cluster de producción. Se cuenta como decisión consciente ("sé cuándo no usar EKS").
- **Cuándo revisarla:** si el presupuesto sube o el proyecto necesita varios servicios de larga duración.

### 9. IaC y CI/CD
- **Elegida y motivo:**
  - Terraform con módulos (`web-opennext`, `api-lambda`, `brain-store`, `auth`, `observability`, `github-oidc`).
  - Un directorio por entorno.
  - Estado en S3 con `use_lockfile` (bloqueo nativo, sin DynamoDB).
  - En cada PR, `terraform plan` comentado en el propio PR; `apply` al hacer merge a `main`.
  - OIDC: GitHub obtiene credenciales temporales de AWS, sin claves guardadas.
- **Riesgo:** un `apply` automático en prod. Se mitiga con un environment de GitHub que pide aprobación manual.

### 10. Seguridad básica
- IAM de mínimo privilegio por función.
- Secretos en SSM Parameter Store (nivel estándar gratuito).
- Cabeceras de seguridad (CSP, HSTS) en una política de CloudFront.
- Dependabot activado.
- Escaneo de la imagen Docker (trivy) y del código Terraform (checkov).
- Contenido `pro` excluido de la compilación estática.

## Coste mensual estimado
| Concepto | Estimación | Verificado |
|---|---|---|
| Dominio (Route 53 o externo) | ~12–15 €/año | No: comprobar el TLD |
| Hosted zone de Route 53 | ~0,50 $/mes | No |
| CloudFront, Lambda, API Gateway, S3, DynamoDB | ~0 € con poco tráfico (capas gratuitas) | No: revisar las capas gratuitas vigentes |
| ECR (imágenes) | céntimos | No |
| Bedrock (embeddings en CI + RAG) | < 1–3 €/mes con uso bajo y cuotas | No: depende del modelo elegido |
| **Total** | **~1–5 €/mes + dominio** | Alarma de AWS Budgets a 5 € y a 10 € |

## Riesgos y plan de mitigación
1. **Alcance (el riesgo nº 1):** "todo DevOps" no se acaba nunca. Se mitiga con fases cerradas: la F1 sale con 1 recorrido y unas 30 fichas, no con 300.
2. **Coste de la IA:** cuotas, asistente solo con sesión y alarmas (ver decisión 6).
3. **Compatibilidad de OpenNext:** fijar la versión de Next.js y actualizar solo cuando OpenNext la soporte.
4. **Contenido desactualizado:** cada ficha lleva `reviewed: <fecha>`; `brain validate` avisa de las que llevan más de 12 meses sin revisar.
5. **Dependencia de AWS (lock-in):** asumida a propósito (es el foco del portfolio). El contenido es MDX en git y no depende de ningún proveedor.

## Estructura del repo
```
infra-atlas/
├── apps/
│   ├── web/                  # Next.js (App Router, TS): viaje, fichas, grafo, búsqueda
│   └── api/                  # FastAPI: /search, /graph, /ask (F3) · Dockerfile
├── packages/
│   ├── brain/                # Python: esquema Pydantic + CLI (new, validate, graph, embed)
│   └── ui/                   # Sistema de diseño: tokens, componentes, diagramas animados
├── content/
│   ├── nodes/<dominio>/*.mdx # docker/, terraform/, kubernetes/, aws/, cicd/, observability/, ai/
│   ├── journeys/*.yaml       # localhost-to-aws.yaml, …
│   └── assets/
├── infra/
│   ├── terraform/
│   │   ├── bootstrap/        # bucket de estado + rol OIDC (se aplica una sola vez)
│   │   ├── modules/          # web-opennext, api-lambda, brain-store, auth, observability, eks-demo
│   │   └── envs/{dev,prod}/
│   └── helm/api/             # chart de la API (probado en kind dentro de CI)
├── labs/                     # demos didácticas enlazadas desde las fichas (kind, LocalStack…)
├── .github/workflows/        # ci.yml, deploy.yml, content.yml, k8s-smoke.yml
├── docs/                     # DECISIONES.md, diseño, guía de contenido
├── compose.yaml              # web + api + localstack
├── Makefile                  # make dev | test | validate | plan | deploy
├── pnpm-workspace.yaml
└── pyproject.toml            # workspace de uv
```

## Siguientes pasos para construir
- **F0 · Fundaciones (1–2 semanas)**
  - Monorepo y herramientas.
  - Esquema Pydantic y `brain validate`.
  - CI de lint y tests.
  - Compose local funcionando.
- **F0.5 · Dirección de diseño**
  - Moodboard, tokens, tipografía.
  - Prototipo de la home y de una parada del viaje *antes* de construir componentes.
- **F1 · MVP visual**
  - Recorrido "localhost → AWS" con unas 6 paradas y unas 30 fichas.
  - Página de ficha, vista de grafo, búsqueda ⌘K.
  - Despliegue con Terraform + OpenNext + Actions.
- **F2 · Cerebro**
  - API FastAPI en Lambda.
  - Embeddings y búsqueda semántica.
  - Chart de Helm + kind en CI.
- **F3 · Cuentas y pago**
  - Cognito, Stripe, contenido `pro`, asistente RAG.
- **F4 · Escalar**
  - Recorridos nuevos (MLOps en AWS, repaso SAA-C03, plataforma interna).
  - Labs interactivas.

## Qué aprender para mantenerlo
1. **Estado de Terraform:** qué guarda, por qué se bloquea y cómo recuperarse de un estado que no coincide con la realidad (drift).
2. **Caché de CloudFront e invalidaciones:** por qué un despliegue "no se ve" y cómo encaja con el ISR de Next.js.
3. **RAG con evaluación:** cómo medir si las respuestas citan las fichas correctas antes de cambiar de modelo o de forma de trocear el contenido.
