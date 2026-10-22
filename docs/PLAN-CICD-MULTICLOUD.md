# Plan: CI/CD en el cerebro y elección de proveedor (AWS / Azure / GCP)

Fecha: 2026-10-21 · Estado: aprobado (ver DECISIONES.md, puntos 11 y 12)
Ejecuta: una fase por PR. Cada fase deja `main` verde y la web funcionando.

## 1. Qué se quiere

Dos cosas que hoy no existen en el modelo de contenido:

1. **CI/CD como parada de primera clase del viaje.** Hoy el dominio `cicd` tiene tres fichas
   (`gha`, `oidc`, `tests`) y todo lo que pasa después del `docker build` cabe en una sola etapa
   (`ship`). El despliegue —entornos, aprobaciones, estrategia de release, rollback, GitOps— no
   está en el cerebro, y es justo la mitad del trabajo de un DevOps.
2. **Elegir proveedor.** Hoy el atlas es AWS y solo AWS: `lambda`, `s3`, `rds`, `iam`, `cloudwatch`.
   Se quiere que el usuario diga "esto en Azure" y que el mapa y el planificador respondan con los
   servicios de Azure, sin duplicar el contenido conceptual.

## 2. La decisión de modelo que lo sostiene todo: capacidad + proveedor

La tentación es crear `content/nodes/compute/azure-functions.mdx` y repetir el texto. Eso triplica
el contenido, triplica el mantenimiento y no enseña nada nuevo: el concepto *"función serverless
que escala a cero"* es el mismo en los tres sitios.

El modelo propuesto separa dos cosas que hoy están mezcladas en una ficha:

- **Capacidad** (`capability`): qué necesita la aplicación. *Almacenamiento de objetos*,
  *función serverless*, *Kubernetes gestionado*, *registro de imágenes*. Es una ficha **neutra**,
  sin proveedor: ahí vive la explicación, el `lead`, el teardown 3D y el `planner.when`.
- **Servicio** (`provider` + `capability`): cómo lo llama cada nube. `s3` / `blob` / `gcs`.
  Ficha corta: qué nombre tiene, qué cambia respecto a la capacidad, límites y precio típico.

Consecuencias, todas buenas:

- El planificador razona en **capacidades**, no en servicios: una sola regla `when` sirve para los
  tres proveedores. Cambiar de nube no cambia la ruta, cambia la etiqueta de cada parada.
- `alternative_to` deja de escribirse a mano: dos fichas con la misma `capability` y distinto
  `provider` son alternativas por construcción, y el grafo las enlaza solo.
- Aparece gratis la **vista comparativa** (el tipo de nodo `comparison`, hoy sin usar): una
  capacidad, tres columnas.
- La cobertura es medible: matriz capacidad × proveedor. Un hueco es un dato, no un olvido.

**Regla de filtrado del planificador** (clave para no romper nada): el proveedor **no** es un
`requirement`. La gramática de `when` se queda exactamente como está. Se filtra antes de evaluar:

```
elegible(nodo) = nodo.provider is None or nodo.provider == proveedor_seleccionado
ruta = [n for n in nodos if elegible(n) and evaluate(parse(n.planner.when), requisitos)]
```

Con `provider` por defecto `aws`, los casos dorados de `content/planner-cases.yaml` siguen pasando
sin tocarlos.

## 3. Fases

| Fase | Qué entrega | Depende de | Tamaño |
|---|---|---|---|
| F1 | CI/CD completo en el cerebro (etapa `deliver`, ~14 fichas, labs) | — | grande |
| F2 | Eje de proveedor en el modelo, con solo AWS poblado | — | mediano |
| F3 | Azure sobre el núcleo del viaje | F2 | mediano |
| F4 | GCP sobre el núcleo del viaje | F3 | pequeño (el camino ya está) |
| F5 | Planificador comparativo y coste estimado por nube | F3 | mediano |
| F6 | El repo practica su propio CD (`deploy.yml`) y lo enlaza desde las fichas | F1 + Terraform | grande |

F1 y F2 son **independientes**: se pueden hacer en paralelo o en el orden que apetezca. El resto
es una cadena.

---

## Fase 1 · CI/CD dentro del cerebro

### Objetivo
Que el viaje no termine en "GitHub Actions hace build": que explique integración continua y
entrega continua con el mismo nivel de detalle visual que tiene Docker hoy.

### 1.1 Nueva etapa `deliver`

`packages/brain/src/brain/models.py`:

```python
Stage = Literal[
    "build", "containerize", "infra", "run", "data", "secure", "ship", "deliver", "observe"
]
```

- `ship` = integración continua: construir, probar, escanear, firmar, publicar el artefacto.
- `deliver` = entrega continua: entornos, aprobación, estrategia de despliegue, verificación,
  rollback.

Hay que replicarlo en `apps/web/src/lib/graph.ts` (`STAGES`) y en el `STAGE_LABEL` de
`apps/web/src/lib/planner.ts`. Etiqueta sugerida: "Ship" → *Build & publish*, "Deliver" → *Release*.

### 1.2 Fichas nuevas (dominio `cicd`)

Integración continua (`stage: ship`):

| id | tipo | qué cuenta |
|---|---|---|
| `pipeline` | concept, **hub** | Qué es una tubería: disparador → trabajos → artefacto. Hub neutro del dominio, futura capacidad `ci` (F2). |
| `runner` | concept | Dónde corre: máquina efímera, hosted vs self-hosted, por qué importa el aislamiento. |
| `matrix` | pattern | La misma prueba en varias versiones o sistemas a la vez. |
| `buildcache` | pattern | Caché de dependencias y de capas: por qué un CI lento se deja de usar. |
| `artifacts` | concept | Lo que un trabajo pasa al siguiente y lo que sobrevive al pipeline. |
| `lint` | tool | Estilo y errores antes de ejecutar nada (ruff, eslint). |
| `sast` | concept | Análisis estático de seguridad (CodeQL, ya en `security.yml`). |
| `sca` | concept | Dependencias con CVE (pip-audit, Dependabot). |
| `imagescan` | concept | Escaneo de la imagen (trivy, ya en `ci.yml` y `release.yml`). |
| `sbom` | concept | Inventario de lo que lleva la imagen, y para qué sirve el día del CVE. |
| `signing` | concept | Firma y procedencia (cosign, ya en `release.yml`). |
| `pinning` | pattern | Fijar acciones por SHA: cadena de suministro del propio CI. |

Entrega continua (`stage: deliver`):

| id | tipo | qué cuenta |
|---|---|---|
| `delivery` | concept, **hub** | CI vs CD vs despliegue continuo. El segundo hub del dominio. |
| `environments` | concept | dev / prod, secretos por entorno, quién puede desplegar a cada uno. |
| `approval` | pattern | La puerta manual: por qué un `apply` en prod la lleva. |
| `promotion` | pattern | El mismo artefacto sube de entorno; no se reconstruye por entorno. |
| `bluegreen` | pattern | Dos versiones, un interruptor. |
| `canary` | pattern | Un porcentaje del tráfico primero. |
| `rolling` | pattern | Sustitución progresiva de réplicas (enlaza con `deployment`, `hpa`). |
| `rollback` | pattern | Volver atrás en minutos: versión anterior vs migración ya aplicada. |
| `smoketest` | pattern | Verificación post-despliegue; si falla, revierte sola. |
| `migrations` | pattern | El problema difícil: la base de datos no hace rollback sola. |
| `gitops` | pattern | El repo como estado deseado; Argo CD / Flux reconcilian. |
| `tfapply` | howto | `plan` comentado en el PR, `apply` al mergear, con aprobación. |
| `dora` | concept | Las cuatro métricas: frecuencia, lead time, fallo de cambios, MTTR. |

Son 25 fichas. Si es demasiado para un PR, el corte mínimo con sentido es:
`pipeline`, `runner`, `artifacts`, `sbom`, `signing`, `delivery`, `environments`, `approval`,
`promotion`, `bluegreen`, `canary`, `rollback`, `gitops`, `tfapply` (14). El resto, en una
ampliación posterior.

**Relaciones**: `part_of: [pipeline]` para las de CI, `part_of: [delivery]` para las de CD.
`gha` pasa a `part_of: [pipeline]` y sigue siendo la implementación concreta. `tests`,
`oidc`, `ecr`, `terraform`, `tfplan`, `deployment`, `hpa` ganan `related` hacia las nuevas.

**Reglas del planificador** (ejemplos, a afinar al escribir cada ficha):

```yaml
# environments
planner: {stage: deliver, when: "true", why: "Keeps dev and prod apart, with different secrets."}
# canary
planner: {stage: deliver, when: "scale or global", why: "Sends a slice of traffic to the new version first."}
# bluegreen
planner: {stage: deliver, when: "not cheap and not k8s", why: "Two versions, one switch: rollback is instant."}
# gitops
planner: {stage: deliver, when: "k8s", why: "The cluster pulls its desired state from git."}
# migrations
planner: {stage: deliver, when: "sql", why: "The database does not roll back with the deploy."}
```

### 1.3 Teardowns 3D

Las fichas hub necesitan `parts` con primitivas que hoy no existen. Añadir a `PartKind`
(`models.py`, `node.schema.json` regenerado con `brain schema`, y `graph.ts`), y una forma por cada
una en `apps/web/src/components/teardown/shapes.ts`:

- `gate` — la puerta de aprobación: un arco que se abre.
- `lanes` — carriles de entornos (dev → prod), para `promotion` y `environments`.
- `split` — tráfico que se bifurca, para `canary` y `bluegreen`.
- `loop` — el bucle de reconciliación de `gitops`.

`layout: row` sirve para casi todas. Evaluar un `layout: "lanes"` nuevo en
`teardown/layouts.ts` solo si `row` no da bien la idea de promoción entre entornos.

### 1.4 Lab interactiva: `PipelineLab`

Junto a `DockerLab.tsx`, una lab en `apps/web/src/components/teardown/labs/PipelineLab.tsx`
enlazada desde `pipeline` con `lab: pipeline`:

- El usuario enciende y apaga trabajos y ve el DAG recalcularse (`needs:` en vivo).
- Hace fallar una prueba: la cadena se pone roja y el despliegue no ocurre.
- Mueve un deslizador de canary y ve el reparto de tráfico.

Es el diferenciador del proyecto ("explicaciones interactivas, no enciclopedia") aplicado a la
parte más abstracta del viaje. Si hay que recortar F1, esto es lo último que se recorta, no lo
primero.

### 1.5 Campo nuevo: `evidence`

El principio rector del proyecto es *"el proyecto se despliega siguiendo el viaje que enseña"*,
pero hoy nada en el contenido enlaza con el código real. Propuesta de campo en
`NodeFrontmatter`:

```yaml
evidence:
  - path: .github/workflows/release.yml
    lines: [96, 112]
    text: "Así firma este repo su propia imagen."
```

- `brain validate` comprueba que el fichero existe y que el rango de líneas cabe en él: **una ficha
  que apunta a código borrado rompe el CI**.
- La página de ficha muestra el fragmento con enlace a GitHub.
- Vale para todo el atlas, no solo para CI/CD (`dockerfile` → `apps/api/Dockerfile`, `helm` →
  `infra/helm/api`), pero es en CI/CD donde más se nota, porque el repo ya tiene las pruebas
  hechas: pinning por SHA, trivy, cosign, SBOM, CodeQL, zizmor.

### 1.6 Validación, pruebas y aceptación

- `brain validate`: regla nueva "toda ficha con `stage: deliver` declara al menos un `part_of`
  o `related`" (evita fichas huérfanas en un dominio que crece rápido).
- Regenerar `content/planner-cases.yaml`: cambia la lista de nodos y aparece la etapa `deliver`
  en todos los casos. Comprobar que las tres suites (`packages/brain/tests/test_planner.py`,
  `apps/api`, `apps/web/src/lib/__tests__/planner.test.ts`) leen el fichero nuevo y pasan.
- `apps/web/src/lib/__tests__/search.test.ts`: las fichas nuevas entran en el índice; revisar que
  el conjunto de evaluación de `docs/BUSQUEDA.md` no se degrada (hay holdout en CI).
- **Aceptación**: `make test` y `make lint` en verde; el planificador con el caso
  `fastapi-postgres-login-uploads-budget` muestra una etapa *Release* con al menos
  `environments`, `approval`, `promotion`, `migrations`; la ficha `pipeline` abre su teardown y su
  lab; una ficha con `evidence` apuntando a una línea inexistente hace fallar `brain validate`.

---

## Fase 2 · El eje de proveedor en el modelo (solo AWS poblado)

### Objetivo
Meter toda la fontanería multinube **sin añadir una sola ficha de Azure o GCP**. Al terminar la
fase, el usuario no ve nada nuevo y todo sigue igual; pero el modelo ya sabe de proveedores. Así el
riesgo de la fontanería y el riesgo del contenido no se suman en el mismo PR.

### 2.1 `content/providers.yaml`

```yaml
- id: aws
  name: "AWS"
  order: 0
  hue: 32          # el acento con el que se tiñen sus servicios en el mapa
  logo: "aws:aws"
  status: full     # full | core | planned
- id: azure
  name: "Azure"
  order: 1
  hue: 205
  logo: microsoftazure
  status: planned
- id: gcp
  name: "Google Cloud"
  order: 2
  hue: 140
  logo: googlecloud
  status: planned
```

`status` es lo que la interfaz usa para decir "Azure: núcleo del viaje cubierto, 14 de 22
capacidades" en vez de mentir con un selector que lleva a un mapa medio vacío.

### 2.2 `content/capabilities.yaml`

```yaml
- id: objectstore
  name: "Object storage"
  domain: data
  core: true       # forma parte del núcleo del viaje: exige cobertura en todo provider `core`
```

### 2.3 Campos nuevos en `NodeFrontmatter`

```python
provider: Slug | None = None  # None = ficha neutra (concepto, patrón, herramienta)
capability: Slug | None = None  # a qué capacidad pertenece o qué capacidad define
```

Combinaciones legales:

| `provider` | `capability` | significa |
|---|---|---|
| `None` | `None` | concepto o herramienta neutra (`docker`, `canary`, `terraform`) |
| `None` | `objectstore` | **ficha de capacidad**: la explicación y el teardown viven aquí |
| `aws` | `objectstore` | **ficha de servicio**: `s3`, corta, lo que cambia en AWS |
| `aws` | `None` | servicio sin equivalente conceptual (`budgets`); legal pero avisa |

### 2.4 Migración del contenido actual

Las 53 fichas de hoy no se reescriben: se les añade `provider: aws` a las de servicio AWS
(`lambda`, `ecs`, `eks`, `ec2`, `s3`, `rds`, `dynamodb`, `elasticache`, `sqs`, `ecr`, `vpc`, `alb`,
`apigw`, `cloudfront`, `route53`, `waf`, `iam`, `ssm`, `cognito`, `cloudwatch`, `xray`, `budgets`,
`bedrock`) y `capability` a las que la tengan. Las conceptuales (`docker`, `kubernetes`,
`terraform`, todo `cicd` y todo `local`) se quedan sin tocar.

Las fichas de capacidad neutras **no se crean en esta fase**: se crean en F3, cuando haya un
segundo proveedor que justifique extraer la explicación común. En F2, `capability` en una ficha AWS
solo declara a qué familia pertenece.

### 2.5 Dónde toca el código

| Fichero | Cambio |
|---|---|
| `brain/models.py` | `Provider`, `Capability`, campos nuevos en `NodeFrontmatter` |
| `brain/loader.py` | cargar `providers.yaml` y `capabilities.yaml`; `LoadResult` crece |
| `brain/validate.py` | reglas nuevas (abajo) |
| `brain/graph.py` | exportar `providers`, `capabilities`, `provider`/`capability` por nodo; derivar los enlaces `alternative_to` entre hermanos de capacidad |
| `brain/layout.py` | **posiciones por proveedor** (abajo) |
| `brain/planner.py` | `plan(..., provider: str = "aws")` con el filtro de elegibilidad |
| `brain/cli.py` | `--provider` en `plan`; comando nuevo `brain coverage` |
| `apps/api` | `?provider=` en `/plan`, `/nodes`, `/search`; `/providers` |
| `apps/web/src/lib/graph.ts`, `planner.ts` | tipos y filtro espejo del de Python |
| `apps/web/.../Planner.tsx`, `BrainMap.tsx` | selector de proveedor |

### 2.6 Reglas de validación nuevas

1. `provider` desconocido → error.
2. `capability` desconocida → error.
3. Dos fichas con la misma pareja (`capability`, `provider`) → error.
4. Una ficha con `capability` y sin `provider` tiene que ser la única así para esa capacidad
   (es la ficha neutra) → error si hay dos.
5. Una relación `requires` / `part_of` de una ficha con proveedor hacia una ficha de **otro**
   proveedor → error. El puente entre nubes pasa por la capacidad, nunca por una arista directa.
6. `alternative_to` escrito a mano entre hermanos de la misma capacidad → aviso: es redundante,
   el grafo ya lo deriva.
7. Una capacidad con `core: true` sin ficha para un proveedor con `status: core` o `full` →
   error. Para `status: planned`, aviso.
8. `brain coverage` imprime la matriz capacidad × proveedor y sale con código 1 si la regla 7
   falla. Va en `ci.yml` junto a `brain validate`.

### 2.7 Posiciones en el mapa 3D

`compute_layout` es determinista pero depende del conjunto de nodos: si se ocultan los de Azure,
quedarían huecos. Dos opciones:

- **(a) Recomendada**: calcular el layout una vez **por proveedor** (nodos neutros + los de ese
  proveedor) y exportar `positions: {aws: [...], azure: [...], gcp: [...]}` por nodo. Cambiar de
  nube pasa a ser una **transición animada** del mapa: los nodos comunes se quedan y los de servicio
  se desplazan a su sitio. Es el momento más vistoso de toda la funcionalidad y sale casi gratis.
- (b) Un `graph.<provider>.json` por nube. Más simple, pero no permite animar la transición y
  multiplica las peticiones.

Ojo al tamaño: `apps/web/src/lib/graph.ts` hace `import data from "@/data/graph.json"`, es decir,
el grafo entero va en el bundle. Con tres proveedores y posiciones triples, medirlo en F3; si pasa
de ~500 KB, mover a `fetch` por proveedor y dejar en el bundle solo el slice por defecto.

### 2.8 Aceptación

- `provider` por defecto `aws` en toda la API y en la web.
- `content/planner-cases.yaml` **sin cambios** y las tres suites en verde: es la prueba de que la
  fontanería no alteró el comportamiento.
- `brain coverage` imprime la matriz con AWS al 100 % y las otras dos a 0.
- Pruebas nuevas: filtro de elegibilidad, derivación de `alternative_to`, reglas 1–7, layout
  determinista por proveedor.

---

## Fase 3 · Azure

### Objetivo
Cubrir el núcleo del viaje en Azure y, con ello, estrenar las fichas de capacidad neutras.

### 3.1 Extraer las capacidades

Para cada capacidad del núcleo se crea la ficha neutra (se le mueve el `lead`, el teardown y la
regla `planner` desde la ficha AWS, que adelgaza a "qué es en AWS y qué cambia"). Núcleo propuesto,
14 capacidades:

| capability | dominio | AWS | Azure |
|---|---|---|---|
| `serverlesshttp` | compute | `lambda` | `azfunctions` |
| `managedk8s` | orch | `eks` | `aks` |
| `containerrun` | compute | `ecs` | `aca` (Container Apps) |
| `vm` | compute | `ec2` | `azvm` |
| `objectstore` | data | `s3` | `blob` |
| `sqldb` | data | `rds` | `azsql` |
| `nosql` | data | `dynamodb` | `cosmos` |
| `queue` | data | `sqs` | `servicebus` |
| `registry` | containers | `ecr` | `acr` |
| `cdn` | network | `cloudfront` | `frontdoor` |
| `privatenet` | network | `vpc` | `vnet` |
| `secrets` | security | `ssm` | `keyvault` |
| `identity` | security | `iam` | `entra` |
| `telemetry` | obs | `cloudwatch` | `azmonitor` |

Fuera del núcleo, para después: `dns`, `loadbalancer`, `apigateway`, `cache`, `tracing`, `budget`,
`userauth`, `llm`.

### 3.2 Lo que trae gratis

- **Vista comparativa**: la ficha de capacidad muestra una tabla con sus implementaciones. Es el
  primer uso real del tipo `comparison`.
- **CI/CD nativo de cada nube**: `pipeline` (F1) pasa a ser capacidad `ci`, con `gha` como
  implementación neutra y `azpipelines` como la de Azure. El eje de proveedor y el trabajo de F1 se
  encuentran justo aquí.
- **OIDC sin claves** es el mismo patrón en las tres nubes (`oidc` se queda neutra, con una línea
  por proveedor): un detalle que vende solo en una entrevista.

### 3.3 Aceptación
`providers.yaml` pone Azure en `status: core`; `brain coverage` da 14/14 en el núcleo; casos
dorados nuevos con `provider: azure` para los mismos requisitos que los de AWS, comprobando que la
ruta tiene la misma forma con otros nombres; el selector del mapa cambia de nube con la transición
animada.

---

## Fase 4 · GCP

Idéntica a F3 con `cloudrun`, `gke`, `gce`, `gcs`, `cloudsql`, `firestore`, `pubsub`,
`artifactregistry`, `cloudcdn`, `vpc` (id `gcpvpc`), `secretmanager`, `gcpiam`, `cloudops`,
`cloudbuild`. No hay decisiones nuevas que tomar: si F3 duele, el dolor está en el modelo y se
arregla antes de empezar F4.

---

## Fase 5 · Planificador comparativo y coste

Aquí es donde el eje de proveedor deja de ser una curiosidad y se vuelve la mejor demo del
proyecto.

- **Campo `cost` por ficha de servicio**: `{free_tier: "...", typical: "~0 €/mes con poco tráfico",
  unit: "por millón de invocaciones"}`. Texto, no un modelo de precios: nadie mantiene precios
  reales a mano, y prometerlo es peor que no darlo.
- **Vista "la misma app en tres nubes"**: una ruta, tres columnas, las diferencias resaltadas y una
  línea de coste estimado por columna. Responde a la pregunta que de verdad se hace la gente.
- **Nota honesta de lock-in**: qué piezas de la ruta son portables (Docker, Terraform, Kubernetes,
  OIDC) y cuáles atan (la base de datos gestionada, la auth, el LLM). Es contenido, no código, y es
  lo que distingue a alguien que ha pensado el problema.

---

## Fase 6 · El repo practica su propio CD

Las fichas de F1 explican entornos, aprobación, promoción y rollback; `evidence` las enlaza con
código real. Hoy ese código no existe: `deploy.yml` está pendiente porque depende de Terraform
(`infra/terraform` está vacío, ver DECISIONES.md).

Cuando Terraform exista:

- `deploy.yml`: OIDC → `terraform plan` comentado en el PR → `apply` al mergear, con un
  environment de GitHub que exige aprobación para prod.
- `content.yml`: validación de contenido separada de `ci.yml`, con filtro por rutas.
- Promoción del artefacto: la imagen que se despliega en prod es **la misma** que pasó por dev,
  por digest, no reconstruida. Es la ficha `promotion` hecha realidad, y se enlaza desde ella.
- Smoke test post-despliegue contra `/health` y `/ready`, con rollback automático si falla.

---

## 4. Decisiones que hay que cerrar antes de empezar

1. **¿`deliver` como etapa nueva, o `ship` se divide en `ci` y `cd`?** Recomendación: añadir
   `deliver`. Renombrar `ship` toca los casos dorados, la API, la web y el prototipo sin ganar nada.
2. **¿El dominio `cicd` aguanta 28 fichas, o se parte en `ci` y `cd`?** Recomendación: un dominio
   con dos hubs. Partirlo obliga a recolocar posiciones de dominio en el espacio 3D y a rehacer el
   equilibrio visual del mapa. Revisarlo si el dominio se ve apelmazado.
3. **¿Núcleo de 14 capacidades, o cobertura completa en Azure y GCP?** Recomendación: núcleo. El
   riesgo nº 1 del proyecto, según DECISIONES.md, es el alcance; tres nubes completas son 66 fichas
   de servicio.
4. **¿`evidence` entra en F1 o va aparte?** Recomendación: en F1. Es media tarde de trabajo y es lo
   que convierte el dominio CI/CD de "apuntes" en "mira mi repo".

## 5. Sugerencias extra

- **`brain coverage` como página pública.** La matriz capacidad × proveedor y el porcentaje de
  fichas con `evidence`, renderizadas en `/coverage`. Enseña el estado real sin vender humo, y a un
  reclutador le dice más que cualquier frase del README.
- **Frescura visible.** `reviewed` ya existe y `validate` avisa a los 12 meses. Falta mostrarlo:
  una ficha con más de un año debería llevar una marca en la interfaz. Con tres nubes, el contenido
  caduca tres veces más rápido.
- **Un recorrido (`journey`) "de cero a producción con CI/CD"**, que es el directorio
  `content/journeys` que DECISIONES.md da por pendiente. F1 crea por fin material suficiente para
  que un recorrido curado tenga sentido.
- **`/ask` con filtro de proveedor** (fase 3 del proyecto, RAG): "¿cómo hago esto en GCP?" es la
  pregunta natural en cuanto exista el eje, y los chunks ya llevarán `provider` en los metadatos si
  F2 lo añade a `chunks.py`.
- **Lo que NO haría**: ni Terraform por proveedor en `infra/`, ni desplegar nada en Azure o GCP.
  El atlas *enseña* las tres nubes; el proyecto se *despliega* en una. Eso es una decisión
  defendible y gratis; lo contrario son tres facturas y tres estados de Terraform.
