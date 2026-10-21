# Búsqueda semántica

La fase 2 de la decisión 6 de [DECISIONES.md](DECISIONES.md): buscar por **significado**, no por palabras. "Where do I keep database passwords" tiene que llevar a *Secrets* aunque esa ficha no diga "database" ni "keep".

```
content/*.mdx ──brain embed──▶ fragmentos ──modelo──▶ vectores ──▶ apps/api/data/vectors.lance
                                                                         │
GET /search?q=… ──▶ vector de la consulta ──▶ vecinos más cercanos ──────┘ ──▶ mejor fragmento por concepto
```

```bash
make embed                          # trocea, calcula embeddings y escribe el índice (idempotente)
make api                            # y en otra terminal:
curl -s --get localhost:8000/search --data-urlencode "q=run code without managing servers"
uv run python -m api.evaluation     # recall@k y MRR, semántica frente a palabra clave
```

## Qué es un embedding

Un **embedding** es una lista de números (un vector) que representa el significado de un texto. Un modelo entrenado con millones de pares "pregunta → respuesta relevante" aprende a colocar textos parecidos en significado cerca unos de otros, aunque no compartan palabras.

- Aquí, `BAAI/bge-small-en-v1.5` convierte cada texto en un vector de **384** dimensiones.
- "Cerca" se mide con la **similitud coseno**: el coseno del ángulo entre dos vectores. Vale 1 si apuntan igual y valores cercanos a 0 si no tienen relación. Los vectores están normalizados (longitud 1), así que el coseno es un simple producto escalar.
- Buscar es: calcular el vector de la consulta y devolver los vectores guardados más cercanos (*nearest neighbours*).
- Consultas y documentos deben pasar por **el mismo modelo**. Los vectores de modelos distintos viven en espacios distintos y compararlos no significa nada. Por eso el índice guarda qué modelo lo creó y la API devuelve 503 si se le pide consultar con otro.
- BGE espera una instrucción delante de las consultas cortas (`Represent this sentence for searching relevant passages: `), pero no delante de los documentos. Es una asimetría habitual en los modelos de recuperación.

## Por qué se trocea el contenido

Un vector resume **todo** el texto que recibe. Si metes una ficha larga entera, el vector se convierte en una media difusa de todos sus temas. Si la partes en fragmentos con un solo tema, cada vector es nítido.

`brain embed` crea, por cada concepto publicado:

| Fragmento | Texto | Para qué |
| --- | --- | --- |
| `overview` | título, resumen, lead y cuerpo | la idea general del concepto |
| `part` (uno por pieza del despiece) | `Título: pieza. texto` | preguntas sobre una pieza concreta ("the daemon that runs images" → Docker) |

- Cada pieza lleva delante el título del concepto. Sin él, "Engine. The daemon…" no diría de qué tecnología es una vez convertido en vector (*contextual chunking*).
- Al buscar se piden más fragmentos de los necesarios y se queda **el mejor de cada concepto**: la API devuelve conceptos, no fragmentos repetidos.
- Las fichas de hoy son cortas, así que no hace falta trocear por tamaño (*sliding windows*). Si crecen, esa es la siguiente palanca.

## LanceDB: una base de datos vectorial sin servidor

[LanceDB](https://lancedb.github.io/lancedb/) es una base de datos **embebida**, como SQLite: la tabla es una carpeta de archivos Lance (columnar, sobre Apache Arrow) que el proceso lee directamente. No hay que levantar nada, ni pagar una instancia encendida.

- Para unos cientos de fragmentos, la búsqueda es exhaustiva y tarda milisegundos. Con muchos más, LanceDB crea un índice ANN (IVF-PQ) sin cambiar el código.
- La carpeta va dentro de la imagen. Cada despliegue lleva el índice que corresponde a su contenido, y si el contenido cambia, se regenera en CI.
- `brain embed` es **idempotente**: guarda en los metadatos de la tabla el proveedor, el modelo, su versión, las dimensiones y una huella (SHA-256) de todos los fragmentos más el modelo. Si la huella coincide, no recalcula nada. Si cambia el texto o el modelo, regenera el índice entero en una carpeta temporal y la cambia de golpe.
- Alternativas que no hacen falta aún: pgvector (base de datos encendida, unos 15 $/mes como mínimo en RDS) u OpenSearch (bastante más). DECISIONES.md fija cuándo revisarlo: más de unas 50k fichas o filtros complejos.

## Cómo se evalúa: recall@k y MRR

Sin medir, "parece que funciona" no vale. [`content/search-eval.yaml`](../content/search-eval.yaml) tiene 27 preguntas en lenguaje natural con el concepto que debería salir. Están redactadas **por significado**, evitando las palabras del título y del resumen de su concepto.

- **recall@k**: proporción de preguntas cuyo concepto esperado aparece entre los k primeros resultados. recall@3 = 0,8 quiere decir que 8 de cada 10 veces la respuesta está en el top 3.
- **MRR** (*Mean Reciprocal Rank*): media de 1/posición del concepto esperado (1 si sale primero, 0,5 si sale segundo, 0 si no está en el top 10). Premia que salga **arriba**, no solo que salga.

Resultados en CI sobre el set (27 preguntas):

| Método | recall@1 | recall@3 | MRR |
| --- | --- | --- | --- |
| Semántica (bge-small-en-v1.5) | — | — | — |
| Palabra clave BM25 (cualquier palabra) | — | — | — |
| Palabra clave `/search/keyword` (todas las palabras) | — | — | — |

`apps/api/tests/test_search_eval.py` falla si la búsqueda semántica baja de **recall@3 ≥ —** o **MRR ≥ —**, un poco por debajo de lo medido. Así, un cambio en el troceado, en la instrucción de consulta o en el modelo que empeore la búsqueda no entra sin que se note. En CI (`REQUIRE_EMBEDDINGS=1`) el test no puede saltarse.

## Pasar a Bedrock y a S3

El proveedor ya está implementado (`EMBEDDINGS_PROVIDER=bedrock`, Amazon Titan Text Embeddings v2, 512 dimensiones) y probado contra un cliente simulado, pero no está activo. Para activarlo:

| | Local (hoy) | Bedrock + S3 |
| --- | --- | --- |
| **Dónde está el modelo** | dentro de la imagen (~67 MB), en CPU | servicio gestionado, llamada HTTP por texto |
| **Coste** | 0 por consulta; paga el tamaño de la imagen y la RAM | por tokens: Titan v2 cuesta del orden de 0,02 $ por millón de tokens. Indexar todo el contenido cuesta céntimos; el riesgo está en las consultas públicas sin límite |
| **Latencia** | unos milisegundos en la propia CPU | una llamada de red por consulta (decenas de ms) más el arranque en frío de Lambda |
| **IAM** | nada | el rol de la Lambda o el Pod necesita `bedrock:InvokeModel` sobre el ARN del modelo (y nada más: mínimo privilegio), y el modelo hay que habilitarlo en la cuenta y la región |
| **Índice** | carpeta en la imagen | `lancedb.connect("s3://bucket/vectors.lance")`: la CI escribe el índice en S3 y la API lo lee. Necesita `s3:GetObject`/`ListBucket` de lectura para la API y escritura solo para el rol de la CI (OIDC) |
| **Cambiar de modelo** | — | Titan y bge no son compatibles: hay que **regenerar** el índice. La API lo detecta por los metadatos y responde 503 hasta entonces |

Para la SAA, lo importante es que la búsqueda pasa a depender de **dos servicios con permisos** (Bedrock y S3), con un coste por uso que hay que acotar. La decisión 6 ya prevé hacerlo con throttling en API Gateway, cuotas y una alarma de Budgets.
