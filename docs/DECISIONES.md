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

## Estado actual
Comprobado contra el repo el 2026-10-22. Las decisiones de abajo son el **diseño objetivo**; esta tabla dice qué existe hoy.
**Hecho** = está en `main` y se prueba · **Parcial** = existe una parte · **Pendiente** = no existe todavía · **Distinto** = se hizo de otra forma que la decidida.

| Pieza | Estado | Hoy |
|---|---|---|
| Monorepo pnpm + uv + Makefile | Hecho | `pnpm-workspace.yaml`, `pyproject.toml`, `Makefile`. |
| Web Next.js (App Router, TS) | Hecho | `apps/web`, Next 16, React 19. |
| Diseño de la web | Parcial | Tailwind v4, three.js y `@react-three/fiber`. No hay Radix/shadcn, Motion, GSAP ni React Flow. |
| `packages/ui` (sistema de diseño) | Pendiente | No existe: solo `packages/brain`. Los componentes viven en `apps/web/src/components`. |
| Contenido: nodos MDX tipados | Hecho | 53 fichas en `content/nodes/<dominio>/`. |
| Contenido: recorridos (`content/journeys`) | Pendiente | No existe el directorio; hay `domains.yaml`, `requirements.yaml` y `planner-cases.yaml`. |
| Esquema Pydantic → JSON Schema | Hecho | `brain schema` y `packages/brain/schema/node.schema.json`. Tipos TS/Zod generados: no comprobado. |
| CLI `brain` | Hecho | `new`, `validate`, `graph`, `embed`, `schema` y `plan`. |
| API FastAPI | Hecho | `apps/api`: `/graph`, `/nodes`, `/search`, `/plan`, `/health`, `/ready`, `/metrics`. `/ask` (RAG) no existe. |
| Búsqueda en el cliente (F1) y semántica (F2) | Hecho | ⌘K con búsqueda local y por significado vía `GET /search`; evaluación en CI. |
| Vectores: LanceDB | **Distinto** | El índice va **dentro de la imagen** (`apps/api/Dockerfile`, `COPY apps/api/data/vectors.lance`), no en S3. Ver [BUSQUEDA.md](BUSQUEDA.md). |
| Embeddings en Bedrock | Parcial | `BedrockEmbedder` existe como extra opcional (`brain[bedrock]`); el proveedor por defecto es local (bge-small). |
| Claude en Bedrock (RAG) | Pendiente | Fase 3. |
| Imagen Docker de la API, target Lambda | Hecho | El target `lambda` añade el Lambda Web Adapter. `modules/api-lambda` ya declara la función que lo corre, pero **no hay** ninguna desplegada. |
| Chart de Helm + kind en CI | Hecho | `infra/helm/api`, `k8s-smoke.yml`. El módulo de EKS: pendiente. |
| Terraform (`infra/terraform`) | Parcial | `bootstrap/` y los módulos `github-oidc`, `api-lambda`, `web-opennext` y `observability`, cableados en `envs/dev` y `envs/prod`. Estado en S3 con `use_lockfile`. CI comprueba fmt, validate, tflint y checkov; **nunca se ha aplicado** (no hay cuenta de AWS). Faltan `brain-store`, `auth` y `eks-demo`. |
| Hosting web (OpenNext + CloudFront) | Parcial | `modules/web-opennext`: S3 privado, CloudFront con OAC, CSP y HSTS, y caché propia. Falta el build de OpenNext y publicar: hoy `next build` no genera un sitio estático. El Lambda de SSR está descrito en `ssr.tf`, no construido (fase 3). |
| CI | Hecho | `ci.yml`, `k8s-smoke.yml`, `release.yml` (imagen firmada, SBOM) y `security.yml`. |
| `deploy.yml` | Parcial | Existe: OIDC sin claves, `plan` comentado en el PR, imagen construida una vez (llama a `release.yml`) y `apply` promocionando ese digest a dev y luego a prod tras aprobación. El `apply` está **dormido** hasta que existan el `bootstrap`, los environments y las variables del repositorio; la publicación de la imagen no, porque no necesita AWS. No publica la web todavía. |
| `content.yml` | Hecho | Workflow propio con filtros por ruta: `brain validate`, deriva de `node.schema.json`, grafo e informe de calidad de la búsqueda. |
| Docker Compose | Parcial | `compose.yaml` declara `web` (servidor de desarrollo con recarga, `apps/web/Dockerfile`), `api` y `localstack`. `docker compose config` se comprueba; nada en CI arranca la pila. |
| Calidad | Parcial | ruff, pytest, eslint, vitest, trivy, tflint y checkov sí (`make tf-check` corre los cuatro de Terraform en local). pyright y Playwright: no están configurados. |
| Observabilidad | Parcial | Logs JSON, métricas Prometheus y `x-request-id`. Alarmas de Budgets (5 € y 10 €) y de 5xx escritas en `modules/observability`, sin aplicar. X-Ray se activa con `enable_xray`. Powertools: pendiente. |
| Auth, pagos y datos de usuario (F3) | Pendiente | Cognito, Stripe y DynamoDB no se han empezado. |

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
| Vectores | LanceDB, índice generado en CI. **Hoy dentro de la imagen**; S3 queda como opción si el índice crece | Sin base de datos encendida: céntimos al mes |
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
- **Opciones valoradas:** pgvector en RDS o Neon, OpenSearch, LanceDB (en S3 o dentro de la imagen), numpy en memoria.
- **Elegida y motivo:**
  - F1: índice de texto en el cliente, sin coste.
  - F2: embeddings calculados en CI y guardados como tabla LanceDB; la API consulta por significado. Hoy el índice va dentro de la imagen (cada despliegue lleva el que corresponde a su contenido); subirlo a S3 solo compensa si crece o debe cambiar sin redesplegar.
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

### 11. Multinube: el contenido se organiza por capacidad, no por proveedor
Aceptada el 2026-10-21. Plan de ejecución: [PLAN-CICD-MULTICLOUD.md](PLAN-CICD-MULTICLOUD.md), fases 2 a 5.

- **Opciones valoradas:** seguir solo con AWS; una ficha por servicio y nube (`s3`, `blob`, `gcs` como tres fichas completas e independientes); separar **capacidad** (ficha neutra) de **servicio** (ficha por nube).
- **Elegida y motivo:** capacidad + proveedor. El concepto *"almacenamiento de objetos"* es el mismo en las tres nubes: la explicación, el `lead`, el teardown 3D y la regla `planner` viven una sola vez en la ficha de capacidad, y cada nube aporta una ficha corta (`provider: aws`, `capability: objectstore`) con su nombre, sus límites y lo que cambia.
  - El planificador razona en capacidades: **una sola regla `when` sirve para los tres proveedores**. Elegir nube no cambia la ruta, cambia la etiqueta de cada parada.
  - El proveedor **no** es un `requirement`: se filtra antes de evaluar la expresión (`provider is None or provider == seleccionado`). La gramática de `when` no se toca y `content/planner-cases.yaml` sigue siendo válido sin editarlo.
  - `alternative_to` se deriva de la capacidad en vez de escribirse a mano, y aparece gratis la vista comparativa (el tipo de nodo `comparison`, hoy sin usar).
  - Fuentes de verdad nuevas: `content/providers.yaml` y `content/capabilities.yaml`. `brain coverage` imprime la matriz capacidad × proveedor y falla en CI si un proveedor declarado como cubierto tiene huecos en el núcleo.
- **Qué se pierde / riesgo:** el alcance, que es el riesgo nº 1 del proyecto. Tres nubes completas son más de 60 fichas de servicio. Se mitiga con un **núcleo de 14 capacidades** por nube y un `status` por proveedor (`full` / `core` / `planned`) que la interfaz enseña tal cual, en vez de ofrecer un selector que lleva a un mapa medio vacío. Riesgo menor: el grafo entero viaja hoy en el bundle de la web (`import data from "@/data/graph.json"`); con posiciones por proveedor hay que medirlo y, si crece, pasar a `fetch` por nube.
- **Qué no incluye:** desplegar nada en Azure o GCP. El atlas **enseña** tres nubes; el proyecto se **despliega** en una. No habrá Terraform ni estado remoto para las otras dos.
- **Cuándo revisarla:** si el núcleo de Azure no se cubre en un plazo razonable, replegar a "AWS con notas comparativas" en vez de sostener tres mapas a medias.

### 12. CI/CD como parada de primera clase del viaje
Aceptada el 2026-10-21. Plan de ejecución: [PLAN-CICD-MULTICLOUD.md](PLAN-CICD-MULTICLOUD.md), fases 1 y 6. Es el contenido que corresponde a la infraestructura ya decidida en el punto 9.

- **Opciones valoradas:** dejar CI/CD como está (tres fichas y una etapa `ship`); ampliar solo con fichas de integración continua; modelar también la entrega continua con etapa propia.
- **Elegida y motivo:** etapa nueva `deliver` entre `ship` y `observe`, y dos hubs en el dominio `cicd`.
  - `ship` queda como **integración continua**: construir, probar, escanear, firmar y publicar el artefacto.
  - `deliver` es **entrega continua**: entornos, aprobación manual, promoción del mismo artefacto, estrategia de despliegue (blue/green, canary, rolling), verificación post-despliegue, migraciones y rollback.
  - Se añade `deliver` en vez de renombrar `ship` a `ci`/`cd`: renombrar toca los casos dorados, la API, la web y el prototipo sin ganar nada.
  - Un solo dominio `cicd` con los hubs `pipeline` y `delivery`. Partirlo en dos dominios obligaría a recolocar posiciones en el espacio 3D y a rehacer el equilibrio visual del mapa.
  - Campo nuevo `evidence` (fichero, rango de líneas y una frase): cada ficha enlaza con el código real del repo que la demuestra. `brain validate` comprueba que la línea existe, así que **borrar código rompe el CI del contenido**. Es el principio rector ("el proyecto se despliega siguiendo el viaje que enseña") hecho comprobable, y en CI/CD las pruebas ya están escritas: pinning por SHA, trivy, cosign, SBOM, CodeQL y zizmor.
- **Qué se pierde / riesgo:** el dominio pasa de 3 fichas a unas 25 y se vuelve el más denso del mapa; hay que vigilar que no se apelmace. La etapa nueva obliga a regenerar `content/planner-cases.yaml` y a comprobar las tres suites (Python, API y web) a la vez. `evidence` crea una dependencia entre contenido y código que puede romper el CI en un refactor: es el efecto buscado, pero conviene que los rangos de líneas sean generosos.
- **Cuándo revisarla:** si el dominio supera las 30 fichas, partirlo en `ci` y `cd` con posiciones 3D propias.

### 13. Dentro de AWS hay un segundo cerebro, con casos reales
Aceptada el 2026-11-05.

- **Opciones valoradas:** meter los servicios de AWS como fichas más en el mapa del viaje; dar a la ficha `aws` un teardown mucho más largo; **un segundo grafo con su propio contenido, su propia disposición 3D y su propia página**.
- **Elegida y motivo:** el segundo grafo, en `content/aws/`, renderizado en `/aws` con el mismo holograma.
  - Las dos preguntas son distintas. El mapa del viaje responde *"¿qué necesito para desplegar esto?"* y por eso se ordena en etapas, de `localhost` a producción. El atlas de AWS responde *"¿qué hay dentro de AWS y cuál de estos servicios resuelve lo que tengo delante?"* y por eso se ordena **de la cuenta hacia fuera**: todo corre dentro de una VPC, el borde está delante, y gobierno, seguridad y operación lo envuelven. Mezclarlos habría roto las dos lecturas: 156 fichas de AWS sobre 77 del viaje dejan el viaje ilegible, y las etapas no dicen nada de un servicio de migración.
  - **Nada nuevo en la tubería.** `brain validate` y `brain graph` ya aceptan `--content` y `--out`, así que el segundo grafo es una invocación más (`make content` hace las dos) y hereda esquema, validación, disposición determinista y formato de salida. El coste del segundo cerebro es contenido, no código de construcción.
  - **Campo `connects`**, una arista con frase: `to` más el texto que dice *qué cruza por ahí*. Era el criterio de aceptación —"las conexiones entre servicios son visibles y comprensibles"— y una lista de ids no lo cumple. Una `connects` dibuja la misma línea que una `related` y además se explica, así que las dos conviven sin duplicar nada: 245 de las 385 aristas del atlas llevan frase.
  - **Casos en `content/aws/cases.yaml`.** Un caso describe una situación real, enciende en el mapa todos los servicios que toca y ofrece de dos a cuatro **opciones** con veredicto `best`, `works` o `avoid`, cada una con su porqué, su coste y lo que te muerde después. Elegir una opción reduce lo encendido a lo suyo, pintado del color de su veredicto: comparar dos formas de resolver algo es entonces un diff que se ve, no dos listas que comparar a ojo. `brain validate` exige **exactamente un `best`** por caso (un caso no puede quedarse en "depende"), que un `avoid` diga qué sale mal, y que los servicios de una opción sean un subconjunto de los del caso (elegir una opción nunca añade servicios al mapa).
  - **Campo `exam`** (`saa`, `sap`): filtra el atlas por certificación sin inventar un segundo eje de clasificación.
  - El holograma, el teardown, el panel de detalle y ⌘K pasaron a recibir un `World` (grafo + índices) en vez de leer el módulo del mapa. Es el cambio que hace que el segundo cerebro no sea un segundo componente.
- **Qué se pierde / riesgo:** el bundle de la web crece con un segundo `graph.json` (156 fichas); si pesa, se carga `/aws` con `fetch` en vez de `import`. El índice semántico de la API solo cubre `/content`, así que dentro de `/aws` el ⌘K es léxico (búsqueda por texto, sin "por significado"): embeber el atlas es trabajo aparte. Y 156 fichas de AWS son 156 fichas que envejecen: `reviewed` y el aviso de caducidad a los 365 días son la red.
- **Cuándo revisarla:** si aparece un tercer cerebro (Azure, GCP), extraer el patrón "grafo anidado" a algo declarativo en vez de copiar `/aws`.

### 14. El mundo es un dato: descriptor por mundo y vocabulario de certificaciones propio
Aceptada el 2026-11-05. Es la revisión que la decisión 13 se dejó anotada ("si aparece un tercer cerebro, extraer el patrón en vez de copiar `/aws`"), ejecutada al añadir el atlas de Kubernetes: `content/k8s/`, 133 fichas en 14 áreas, 391 aristas (347 explicadas) y 10 casos, apuntando a CKAD, CKA y CKS.

- **Opciones valoradas:** copiar los ~790 líneas de `/aws` y renombrarlas a `/k8s`; una ruta dinámica `/[mundo]` que resolviera el grafo en tiempo de construcción; **un descriptor de mundo que los componentes y las rutas reciben como dato**.
- **Elegida y motivo:** el descriptor, en `apps/web/src/lib/atlas.ts`.
  - Copiar habría duplicado el renderizador entero para cambiar unas treinta palabras. De las ~790 líneas específicas de `/aws`, solo 32 eran realmente de AWS; el resto era lógica de mundo con nombres de AWS.
  - Un `Atlas` lleva **ruta, `World`, casos, certificaciones y las palabras que cambian** (cómo se llama una ficha, el rótulo del escenario 3D, los textos del buscador y de la cabecera). `AwsAtlas.tsx` y su panel de casos pasan a `components/atlas/`, sin saber qué mundo dibujan, y `/aws`, `/aws/<id>`, `/k8s` y `/k8s/<id>` son cuatro ficheros de nueve líneas sobre los mismos componentes. Las URLs y los enlaces profundos (`?case=`, `?focus=`, `&open=1`) no cambian: los tests existentes siguen verdes sin tocarlos.
  - **La ruta no se configura: es el id del mundo.** `content/k8s/world.yaml` declara `id: k8s`, y de ahí salen la ruta `/k8s`, el directorio de contenido y la URL de edición en GitHub. Un mundo nuevo no puede desincronizar esas tres cosas porque son la misma.
  - **Fichero nuevo `world.yaml` por mundo**, con `id`, `name` y `exams`. Es lo que convierte un directorio de contenido en un mundo que se describe a sí mismo, y `brain graph` lo copia al `graph.json` (versión 2), así que la web lee las etiquetas de certificación como dato en vez de tener una tabla.
- **Por qué el vocabulario de certificaciones pasa a ser por mundo:** `exam` era `Literal["saa", "sap"]` en `packages/brain/src/brain/models.py`, es decir **vocabulario de AWS dentro del esquema que comparten todos los mundos**. Con eso, `exam: [ckad]` era inválido en Kubernetes y `exam: [saa]` era válido en el mapa del viaje, que no se estudia para ningún examen. Ahora cada mundo declara sus ids en su `world.yaml` y `brain validate` rechaza una etiqueta que ese mundo no declare (y avisa de una declarada que nadie usa, porque sería una pastilla de filtro que vacía el mapa). Siete tests nuevos en `packages/brain/tests/test_validate.py` cubren la regla; el mapa del viaje declara `exams: []`, así que una etiqueta ahí es un error en vez de pasar inadvertida.
- **Cómo se cosen los mundos:** `apps/web/src/lib/worlds.ts` tiene las puertas. El nodo `aws` y el nodo `kubernetes` del mapa del viaje bajan a `/aws` y a `/k8s`, y el nodo `eks` del atlas de AWS baja a `/k8s` -- porque EKS es un plano de control gestionado y nada por encima del apiserver, que es justo donde empieza el otro atlas. Un lector baja del viaje a AWS y de AWS a Kubernetes, y el botón "Go inside AWS" deja de ser un `if` sobre un id concreto.
- **Orden del contenido:** el atlas de AWS se lee de la cuenta hacia fuera; este se lee **del objeto hacia el clúster** (el objeto y la API en el centro, el plano de control y el nodo a la izquierda, lo que consume una carga de trabajo a la derecha, y seguridad y observabilidad envolviéndolo). Ordenarlo por dominios de examen habría sido ordenarlo por el temario y no por cómo funciona.
- **Qué se pierde / riesgo:** la web importa ya tres `graph.json` (77 + 156 + 133 fichas); si el bundle pesa, el arreglo es cargar cada atlas con `fetch` en vez de `import`, y ahora es un cambio en un sitio. El `Graph` sube a versión 2 por el bloque `world`, así que un `graph.json` viejo sin ese bloque no sirve para un atlas (el descriptor falla con un mensaje claro en vez de renderizar un mundo sin nombre). El índice semántico de la API sigue cubriendo solo `/content`, así que dentro de `/k8s` el ⌘K es léxico. Y son 133 fichas más que envejecen: `reviewed` y el aviso a los 365 días son la red.
- **Cuándo revisarla:** si un cuarto mundo necesita algo que el descriptor no lleva (otro modelo de casos, otro eje de filtrado), convertir `AtlasCopy` en parte del `world.yaml` en vez de ampliar el tipo en TypeScript.

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
│   ├── aws/                  # segundo mundo: el atlas de AWS (world.yaml, nodes/, domains.yaml, cases.yaml)
│   ├── k8s/                  # tercer mundo: el atlas de Kubernetes (misma forma)
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
