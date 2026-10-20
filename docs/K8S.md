# Kubernetes: la API en un cluster kind

La decisión 8 de [DECISIONES.md](DECISIONES.md) dice "Kubernetes demostrado, no pagado". La misma imagen de `apps/api` que corre en Compose y correrá en Lambda se despliega con Helm en un cluster kind efímero, en local y en cada PR (`.github/workflows/k8s-smoke.yml`). No hay un cluster gestionado que pagar.

```
infra/helm/api/          Chart de Helm de la API
labs/k8s/kind-config.yaml  Cluster kind: 1 control-plane + 1 worker
labs/k8s/smoke.sh        port-forward + curl a /health y /graph
```

## Qué hay en el chart y por qué

| Objeto | Para qué |
| --- | --- |
| `Deployment` | Declara "quiero 2 réplicas de este Pod". Crea un `ReplicaSet`, y este mantiene los Pods vivos: si uno muere, crea otro. `RollingUpdate` con `maxUnavailable: 0` y `maxSurge: 1` sube un Pod nuevo antes de bajar uno viejo, así que un upgrade nunca deja menos de 2 réplicas sirviendo. |
| `Service` (ClusterIP) | Una IP y un nombre DNS estables (`atlas-api.default.svc`) delante de Pods cuyas IPs cambian. Encuentra los Pods por **labels** (`selector`) y solo envía tráfico a los que están **Ready**. ClusterIP significa "solo accesible dentro del cluster". |
| `Ingress` (opcional) | Una regla HTTP (host y path → Service) que aplica un Ingress Controller (nginx, AWS Load Balancer Controller...). Viene desactivado (`ingress.enabled: false`) porque kind no trae controller. |
| `values.yaml` | La interfaz del chart: imagen, réplicas, recursos, puerto. Los templates no se tocan; se cambia con `--set` o con `-f otros-values.yaml`. |
| `NOTES.txt` | El texto que imprime `helm install`: cómo hacer el port-forward. |

Detalles que el CKAD pregunta:

- **Labels y selector.** `selector.matchLabels` del Deployment tiene que coincidir con las labels del template del Pod, y no se puede cambiar después de crearlo. El Service usa las mismas labels (`app.kubernetes.io/name` + `instance`).
- **`resources`.**
  - `requests` es lo que el scheduler reserva en el nodo para colocar el Pod.
  - `limits.memory` es el techo: si lo pasa, el kernel mata el contenedor (`OOMKilled`).
  - No hay `limits.cpu` a propósito: un límite de CPU aplica *throttling* aunque el nodo esté libre. Para una API pequeña basta con el request.
  - Con requests < limits la QoS class es `Burstable`. Compruébalo con `kubectl get pod -o jsonpath='{.status.qosClass}'`.
- **`securityContext`.**
  - `runAsNonRoot` + `runAsUser: 10001`: el kubelet se niega a arrancar el contenedor como root. Para poder comprobarlo necesita un UID numérico, por eso el Dockerfile ahora usa `USER 10001:10001` en vez de `USER app`.
  - `readOnlyRootFilesystem: true`: la app no puede escribir en su imagen. `/tmp` se monta como `emptyDir` por si Python o uvicorn necesitan escribir algo temporal.
  - `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]` y `seccompProfile: RuntimeDefault` reducen lo que el proceso puede pedir al kernel. Es lo que exige el perfil *restricted* de Pod Security Standards.
- **`automountServiceAccountToken: false`.** La API no habla con la API de Kubernetes, así que el Pod no lleva token.

## Probes

Las dos van contra `GET /health`, que devuelve `{"status": "ok"}`, pero responden a preguntas distintas:

| | Pregunta | Si falla `failureThreshold` veces seguidas |
| --- | --- | --- |
| `readinessProbe` | ¿Puede recibir tráfico **ahora**? | El Pod sale de los endpoints del Service (no recibe tráfico) pero **no se reinicia**. |
| `livenessProbe` | ¿Está vivo o colgado? | El kubelet **reinicia el contenedor** (`RESTARTS` sube). |

- La readiness empieza antes (`initialDelaySeconds: 2`) y comprueba más a menudo (`periodSeconds: 5`). `helm install --wait` espera justo a que todos los Pods estén Ready.
- La liveness es más paciente (`10s` / `10s`). Una liveness agresiva reinicia en bucle un Pod que solo iba lento (`CrashLoopBackOff`).
- Existe una tercera, `startupProbe`, para apps que tardan en arrancar: desactiva las otras dos hasta que pasa. Aquí no hace falta porque uvicorn arranca en menos de 1 s.
- Mejora futura: cuando la API tenga dependencias (base de datos, embeddings), la readiness debería comprobarlas en su propio endpoint (`/ready`) y la liveness quedarse en `/health`. Si la base de datos cae, no queremos que Kubernetes reinicie todos los Pods.

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
kubectl port-forward svc/atlas-api 8000:8000                # y en otra terminal: curl localhost:8000/health
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
| `kind load docker-image` | Imagen en **ECR**. El CI la sube con OIDC (sin claves) y `image.repository` pasa a `<cuenta>.dkr.ecr.<región>.amazonaws.com/infra-atlas-api`, con tag = SHA del commit. |
| Ingress desactivado | **AWS Load Balancer Controller**: `ingress.enabled=true`, `className: alb` y anotaciones (`alb.ingress.kubernetes.io/scheme`, certificado de ACM). Crea un ALB por Ingress. |
| 2 réplicas fijas | Un **HPA** sobre CPU (requiere metrics-server) y un `PodDisruptionBudget` para que las actualizaciones de nodos no tiren todas las réplicas. |
| Sin permisos de AWS | Si la API necesita S3 o Bedrock: un ServiceAccount con **IRSA** o **EKS Pod Identity**, que da un rol IAM al Pod sin credenciales en la imagen. |
| Nodos como contenedores | Managed node groups o **Fargate**. Los `requests` deciden cuántos Pods caben por nodo y, por tanto, el coste. |
| `helm install` desde el CI | Igual, o GitOps (Argo CD / Flux) leyendo el chart del repo. |

El chart no cambia: solo cambia un `values-eks.yaml`. Esa es la gracia de separar templates y values.
