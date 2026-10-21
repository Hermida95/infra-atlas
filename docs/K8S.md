# Kubernetes: la API en un cluster kind

La decisión 8 de [DECISIONES.md](DECISIONES.md) dice "Kubernetes demostrado, no pagado". La misma imagen de `apps/api` que corre en Compose y correrá en Lambda se despliega con Helm en un cluster kind efímero, en local y en cada PR (`.github/workflows/k8s-smoke.yml`). No hay un cluster gestionado que pagar.

```
infra/helm/api/          Chart de Helm de la API
labs/k8s/kind-config.yaml  Cluster kind: 1 control-plane + 1 worker
labs/k8s/smoke.sh        port-forward + curl a /health, /ready, /graph y /search
```

## Qué hay en el chart y por qué

| Objeto | Para qué |
| --- | --- |
| `Deployment` | Declara "quiero 2 réplicas de este Pod". Crea un `ReplicaSet`, y este mantiene los Pods vivos: si uno muere, crea otro. `RollingUpdate` con `maxUnavailable: 0` y `maxSurge: 1` sube un Pod nuevo antes de bajar uno viejo, así que un upgrade nunca deja menos de 2 réplicas sirviendo. |
| `Service` (ClusterIP) | Una IP y un nombre DNS estables (`atlas-api.default.svc`) delante de Pods cuyas IPs cambian. Encuentra los Pods por **labels** (`selector`) y solo envía tráfico a los que están **Ready**. ClusterIP significa "solo accesible dentro del cluster". |
| `Ingress` (opcional) | Una regla HTTP (host y path → Service) que aplica un Ingress Controller (nginx, AWS Load Balancer Controller...). Viene desactivado (`ingress.enabled: false`) porque kind no trae controller. |
| `ServiceAccount` | Una identidad propia para la API, nunca la `default` del namespace. Sin token montado. En EKS es donde se engancha un rol IAM (IRSA o Pod Identity) si la API necesita Bedrock o S3. |
| `PodDisruptionBudget` | `minAvailable: 1`: un drenado de nodo o una actualización del cluster nunca tira todas las réplicas a la vez. Solo protege de interrupciones **voluntarias**; si un nodo se cae, no hay PDB que valga. |
| `NetworkPolicy` | **Default deny.** Solo entra TCP al puerto de la API y **no sale nada**: el modelo y el índice van en la imagen, así que la API no necesita salir a internet. Si alguien compromete el proceso, no puede exfiltrar datos ni llegar al endpoint de metadatos de la nube. Solo la aplica una CNI que lo soporte (Calico, Cilium, VPC CNI con network policy); kindnet la ignora. `allowDNS: true` abre solo el puerto 53; cualquier otra salida (p. ej. HTTPS a Bedrock) se añade con `networkPolicy.extraEgress`, que se copia tal cual como reglas de egress. Por defecto está vacío: sin salida. |
| `values.yaml` | La interfaz del chart: imagen, réplicas, recursos, configuración. Los templates no se tocan; se cambia con `--set` o con `-f otros-values.yaml`. |
| `values.schema.json` | Valida los values antes de instalar: un tipo erróneo, una clave mal escrita o `allowPrivilegeEscalation: true` hacen fallar `helm install`. |
| `NOTES.txt` | El texto que imprime `helm install`: cómo hacer el port-forward y qué endpoints probar. |

Detalles que el CKAD pregunta:

- **Labels y selector.** `selector.matchLabels` del Deployment tiene que coincidir con las labels del template del Pod, y no se puede cambiar después de crearlo. El Service usa las mismas labels (`app.kubernetes.io/name` + `instance`).
- **`resources`, medidos, no inventados.** El contenedor usa unos 300 MiB tras la primera búsqueda (modelo ONNX, LanceDB, pyarrow; medido en CI con `docker stats`). Por eso `requests.memory: 320Mi` y `limits.memory: 512Mi`. Con el primer chart (96Mi / 256Mi) el Pod habría acabado `OOMKilled` en la primera búsqueda, y el smoke test no lo veía porque no llamaba a `/search`; ahora sí lo hace.
  - `requests` es lo que el scheduler reserva en el nodo para colocar el Pod. Si es irreal, el nodo se sobrecompromete y los Pods se matan entre sí por memoria.
  - `limits.memory` es el techo: si lo pasa, el kernel mata el contenedor (`OOMKilled`).
  - No hay `limits.cpu` a propósito: un límite de CPU aplica *throttling* aunque el nodo esté libre. Para una API pequeña basta con el request.
  - Con requests < limits la QoS class es `Burstable`. Compruébalo con `kubectl get pod -o jsonpath='{.status.qosClass}'`.
- **`securityContext`.**
  - `runAsNonRoot` + `runAsUser: 10001`: el kubelet se niega a arrancar el contenedor como root. Para poder comprobarlo necesita un UID numérico, por eso el Dockerfile ahora usa `USER 10001:10001` en vez de `USER app`.
  - `readOnlyRootFilesystem: true`: la app no puede escribir en su imagen. `/tmp` se monta como `emptyDir` por si Python o uvicorn necesitan escribir algo temporal.
  - `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]` y `seccompProfile: RuntimeDefault` reducen lo que el proceso puede pedir al kernel. Es lo que exige el perfil *restricted* de Pod Security Standards.
- **`automountServiceAccountToken: false`.** La API no habla con la API de Kubernetes, así que el Pod no lleva token.
- **`topologySpreadConstraints`.** Reparte las réplicas entre nodos y zonas de disponibilidad. Con `ScheduleAnyway` es una preferencia: en un cluster de un nodo (kind) se programan igual.
- **`preStop: sleep 5` + `terminationGracePeriodSeconds: 30`.** Cuando se borra un Pod, quitarlo de los endpoints del Service y mandarle SIGTERM ocurren a la vez. Esos 5 segundos dan tiempo a que el balanceador deje de enviarle tráfico antes de que uvicorn deje de aceptar conexiones. Sin ellos, cada despliegue corta algunas peticiones.
- **Imagen por digest.** `image.digest: sha256:...` gana al tag: el release despliega exactamente los bytes que la CI escaneó y firmó (ver [SEGURIDAD.md](SEGURIDAD.md)).

## Probes

Tres probes, tres preguntas distintas:

| Probe | Endpoint | Pregunta | Si falla `failureThreshold` veces seguidas |
| --- | --- | --- | --- |
| `startupProbe` | `/health` | ¿Ha terminado de arrancar? | Reinicia. Mientras no pase, las otras dos **no se ejecutan**. |
| `readinessProbe` | `/ready` | ¿Puede recibir tráfico **ahora**? | El Pod sale de los endpoints del Service, pero **no se reinicia**. |
| `livenessProbe` | `/health` | ¿Está vivo o colgado? | El kubelet **reinicia el contenedor** (`RESTARTS` sube). |

- **Al arrancar, la API precalienta**: carga el grafo, abre el índice, carga el modelo y lanza una búsqueda de prueba (el *lifespan* de FastAPI). Uvicorn no acepta conexiones hasta terminar. La `startupProbe` le da 60 s (`failureThreshold 30 × periodSeconds 2`) sin que la liveness lo mate a medias.
- **`/ready` comprueba de verdad las dependencias**: devuelve 200 solo si el grafo, el índice y el modelo están cargados y son compatibles, y si no, 503 con el motivo (`{"checks": {"model": "unavailable"}}`). Antes la readiness iba a `/health`: un Pod sin índice se marcaba Ready y respondía 503 a cada búsqueda.
- **`/health` no comprueba nada más que el proceso.** Si la liveness comprobara el índice o una base de datos, un fallo externo haría que Kubernetes reiniciara todos los Pods en bucle sin arreglar nada.
- `helm install --wait` espera a que todos los Pods estén Ready, es decir, con el modelo cargado.

## Qué hace kind

[kind](https://kind.sigs.k8s.io) (*Kubernetes IN Docker*) levanta cada **nodo** del cluster como un contenedor Docker con kubelet y containerd dentro. `labs/k8s/kind-config.yaml` crea dos:

- `control-plane`: apiserver, etcd, scheduler y controller-manager.
- `worker`: donde acaban los Pods de la API.

Como no hay registry, la imagen se copia directamente al containerd de cada nodo con `kind load docker-image`. Por eso `image.pullPolicy` es `IfNotPresent`: con `Always` el kubelet intentaría descargarla y fallaría con `ErrImagePull`.

## Reproducirlo en local

Requisitos: Docker, [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation), kubectl y [Helm](https://helm.sh/docs/intro/install/) 4.

```bash
make k8s-up       # crea el cluster "infra-atlas"
make k8s-deploy   # brain graph → docker build → kind load → helm upgrade --install --wait → smoke test
make k8s-down     # borra el cluster
```

Para explorar a mano:

```bash
kubectl get deploy,rs,pods,svc -l app.kubernetes.io/instance=atlas
kubectl describe pod -l app.kubernetes.io/instance=atlas   # eventos: scheduling, probes, pulls
kubectl port-forward svc/atlas-api 8000:8000                # y en otra terminal: curl localhost:8000/ready
helm template atlas infra/helm/api | less                   # el YAML que Helm aplica
helm upgrade atlas infra/helm/api --reuse-values --set replicaCount=3   # y mira el rollout
kubectl rollout history deploy/atlas-api
```

Ejercicios para el CKAD:

- Borra un Pod (`kubectl delete pod ...`) y mira cómo el ReplicaSet crea otro.
- Cambia `probes.liveness.path` a `/nope` con `helm upgrade` y observa los reinicios.
- Vuelve con `helm rollback atlas 1`.

## Qué cambiaría en EKS

| En kind | En EKS |
| --- | --- |
| `kind load docker-image` | Imagen de un registry. `release.yml` ya publica en **GHCR**, escaneada, con SBOM, provenance y firma cosign; en AWS sería **ECR** subida con OIDC. Se despliega con `image.digest`, no con un tag. |
| Ingress desactivado | **AWS Load Balancer Controller**: `ingress.enabled=true`, `className: alb` y anotaciones (`alb.ingress.kubernetes.io/scheme`, certificado de ACM). Crea un ALB por Ingress. |
| 2 réplicas fijas | Un **HPA** sobre CPU (requiere metrics-server). El `PodDisruptionBudget` y el reparto por zonas ya están en el chart. |
| NetworkPolicy ignorada (kindnet) | La VPC CNI con *network policy* activada (o Calico/Cilium) **sí** la aplica: el *default deny* de salida pasa a ser real. |
| Sin permisos de AWS | Si la API necesita S3 o Bedrock: un ServiceAccount con **IRSA** o **EKS Pod Identity**, que da un rol IAM al Pod sin credenciales en la imagen. |
| Nodos como contenedores | Managed node groups o **Fargate**. Los `requests` deciden cuántos Pods caben por nodo y, por tanto, el coste. |
| `helm install` desde el CI | Igual, o GitOps (Argo CD / Flux) leyendo el chart del repo. |

### Rate limit con Ingress

El límite de la app (`config.rateLimitPerMinute`, 60/min por IP y por Pod, en memoria) es una **red de seguridad**, no el límite real: cada réplica cuenta por separado y no ve el tráfico de las demás. El límite efectivo se pone **en el borde**: anotaciones del Ingress (`nginx.ingress.kubernetes.io/limit-rpm`), reglas de rate en AWS WAF, o throttling de API Gateway si la API corre en Lambda.

Para que el límite de la app cuente por usuario y no por controlador, uvicorn tiene que confiar en `X-Forwarded-For`: con `ingress.enabled=true` hay que poner `config.forwardedAllowIps` al CIDR de los Pods del controller (p. ej. `10.0.0.0/8`). Con el valor por defecto `127.0.0.1` el chart **se niega a renderizar**: uvicorn vería siempre la IP del controller y todos los usuarios de un Pod compartirían un solo cubo.

El chart no cambia: solo cambia un `values-eks.yaml`. Esa es la gracia de separar templates y values.
