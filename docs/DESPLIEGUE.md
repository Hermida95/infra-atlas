# El primer despliegue, en orden

Qué tienes que hacer **tú** —en AWS, en GitHub y en tu máquina— para pasar de un repositorio
con infraestructura escrita a un despliegue real. A partir del segundo, no hay nada que hacer:
un merge a `main` despliega solo.

Esta guía encadena los pasos y avisa de lo que muerde. El detalle de cada uno está en su sitio
y no se repite aquí:

- [infra/terraform/bootstrap/README.md](../infra/terraform/bootstrap/README.md) — el bootstrap y la lista de variables de repositorio.
- [infra/terraform/README.md](../infra/terraform/README.md) — el primer apply en dos pasos y por qué el estado es como es.
- [infra/terraform/envs/dev/README.md](../infra/terraform/envs/dev/README.md) y [envs/prod](../infra/terraform/envs/prod/README.md) — lo propio de cada entorno.

Cuenta con una tarde. Casi todo es esperar a CloudFront.

## 0 · Antes de tocar nada

- [ ] **Una cuenta de AWS** con un usuario o sesión SSO con `AdministratorAccess`. El bootstrap
      crea roles de IAM: no sale con permisos pequeños.
- [ ] **Elige la región y no la cambies**: tiene que ser la misma en `envs/*/versions.tf` y en
      la variable `AWS_REGION`. Para Europa, `eu-west-1`.
- [ ] **Mira la cuota de concurrencia de Lambda** *antes* del primer apply. Una cuenta nueva
      suele traerla en 10, y los entornos reservan 2 y 5; Lambda exige dejar un mínimo sin
      reservar y el apply falla si no llega. El comando y qué hacer, en los READMEs de los
      entornos.
- [ ] **Pon la alarma de facturación tú mismo** en la consola, a 10 €, antes de nada. Las de
      Terraform llegan en el paso 3, y hasta entonces no hay red.
- [ ] Ten `terraform` ≥ 1.10, `aws` y `docker` a mano.

## 1 · AWS: el bootstrap, una sola vez

Crea el bucket de estado, el proveedor OIDC, los cuatro roles de despliegue y el permissions
boundary. Se aplica **a mano, con tus credenciales**: es el huevo y la gallina del estado
remoto y no tiene solución elegante.

Sigue [bootstrap/README.md](../infra/terraform/bootstrap/README.md) y, al terminar, **guarda
`terraform.tfstate`** en algún sitio donde lo tengas dentro de seis meses. Está en el
`.gitignore` a propósito. Si lo pierdes no se rompe nada, pero tendrás que importar cinco
recursos a mano, y el README dice cuáles.

Apunta las cuatro salidas que pide el paso siguiente:

```bash
terraform output -raw state_bucket
terraform output -raw execution_boundary_arn
terraform output -json plan_role_arns
terraform output -json apply_role_arns
```

## 2 · GitHub: entornos y variables

Terraform no puede crear nada de esto, y el repositorio no lo intenta.

- [ ] Crea los entornos **`dev`** y **`prod`**. Los nombres son exactos: el rol de apply solo
      confía en el sujeto `repo:Hermida95/infra-atlas:environment:<nombre>`, así que un entorno
      llamado `production` no obtiene credenciales.
- [ ] Pon **al menos un revisor obligatorio en `prod`**. Es la puerta de aprobación entera: sin
      ella, un merge a `main` llega a producción sin que nadie lo mire.
- [ ] Limita las ramas de despliegue de los dos entornos a `main`.
- [ ] Define las **nueve variables de repositorio** (variables, no secretos) de la tabla de
      [bootstrap/README.md](../infra/terraform/bootstrap/README.md#repository-variables).

Dos que se equivocan solas:

- `WEB_BUCKET_NAME_DEV` / `_PROD` tienen que empezar por `infra-atlas-dev-` y
  `infra-atlas-prod-`. El rol de apply solo alcanza buckets con ese prefijo, así que un nombre
  bonito falla con `AccessDenied` en `CreateBucket`.
- `ALERT_EMAILS` es un **array JSON**: `["tu@correo.com"]`, no `tu@correo.com`.

Mientras `AWS_REGION` o `TF_STATE_BUCKET` estén vacías, `deploy.yml` se salta entero. Eso es a
propósito: el pipeline está dormido hasta que hay una cuenta detrás.

## 3 · El primer apply de `dev`, que son dos

`modules/api-lambda` crea el registro **y** la función que corre una imagen de ese registro, así
que la primera vez no hay imagen que desplegar. Los pasos exactos están en
[infra/terraform/README.md](../infra/terraform/README.md#first-deployment-in-order).

Lo que de verdad muerde, si trabajas en un Mac con Apple Silicon: la imagen del arranque se
construye con `docker buildx build --platform linux/amd64 --provenance=false`. Sin
`--platform` sale una imagen arm64 que Lambda acepta al desplegar y revienta en la primera
invocación con `exec format error`; sin `--provenance=false`, buildx publica un índice OCI que
Lambda rechaza. El README lleva el comando entero.

Al acabar tendrás la API en línea. Compruébalo:

```bash
curl "$(terraform output -raw api_endpoint)/health"
curl "$(terraform output -raw api_endpoint)/search?q=kubernetes"
```

## 4 · `prod`, y confirmar los correos

Lo mismo en `envs/prod`. Después, **confirma por correo las suscripciones de SNS**: una
suscripción sin confirmar es la razón habitual de que una alarma «no saltara».

## 5 · Qué tienes al terminar, y qué no

**Sí:** la API en Lambda detrás de API Gateway, CloudFront con sus cabeceras de seguridad, el
bucket de assets, las alarmas de presupuesto a 5 y 10 € y la de 5xx, y el pipeline encendido:
a partir de aquí, un merge a `main` construye la imagen, la firma, la promociona por digest y
aplica `dev` y luego `prod` con tu aprobación.

**No: la web no se sube.** `deploy.yml` despliega la infraestructura y la API, pero nada copia
`apps/web/out/` al bucket ni invalida CloudFront. El sitio existe y se genera (`pnpm --filter
web build` escribe 80 ficheros HTML), pero el bucket se queda vacío y la raíz dará 404 hasta
que exista ese paso. Son unas veinte líneas en `deploy.yml` —`aws s3 sync` y una invalidación,
con los permisos ya concedidos— y es el único trozo que falta para que el viaje esté entero.

Mientras tanto, subirlo a mano:

```bash
NEXT_PUBLIC_SITE_URL="https://tu-dominio" pnpm --filter web build
aws s3 sync apps/web/out "s3://$(terraform output -raw web_bucket_name)" --delete
aws cloudfront create-invalidation --distribution-id "$(terraform output -raw cloudfront_distribution_id)" --paths '/*'
```

`NEXT_PUBLIC_SITE_URL` importa: sin ella el `sitemap.xml` sale con `localhost`.

## 6 · Cuando algo falle

- **El workflow no aparece**: las variables están vacías, o el cambio no tocó ninguna de las
  rutas que lo disparan.
- **`AccessDenied` en el `init`**: el bucket de estado o el prefijo no cuadran con los de la
  variable; mira `ListOwnStatePrefix` en `modules/github-oidc`.
- **`AccessDenied` creando un rol**: `PERMISSIONS_BOUNDARY_ARN` está vacía. Vacío no significa
  «sin límite», significa que la condición no se cumple.
- **El primer paso falla y no sabes por dónde ibas**: el apply es idempotente, se repite sin
  miedo. Lo que no se repite es el bootstrap si pierdes su estado.

Cada error del pipeline nombra la variable o el permiso que falta: el workflow comprueba
primero y falla alto, en vez de morir a mitad de un apply.
