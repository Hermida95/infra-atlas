# Dirección de diseño: Infra Atlas
Fecha: 2026-10-20 · Estado: fase 1 en la app Next.js (`apps/web`): mapa holográfico, planificador, despiece y laboratorio de Docker. El prototipo HTML (`prototypes/brain/`) queda como referencia.

## Idea central
La home es un **holograma 3D de conocimiento**, en la línea de la interfaz de Jarvis en Iron Man.
- **El cerebro:** un grafo de conceptos (Docker, Pod, VPC, RAG…) flotando dentro de una nube de partículas con forma de cerebro.
- **La base:** un proyector de anillos que giran debajo del cerebro.
- **El orden:** los dominios se colocan siguiendo el viaje, de izquierda a derecha: **Local → Containers → IaC / Kubernetes → AWS → Data / AI**.
- **El planificador** ("What are you deploying?"): describes tu app y la ruta necesaria se enciende en dorado, con pulsos que viajan de local a la nube.

## Despiece de cada tecnología (vista "Take it apart")
Al entrar en una tecnología, esta se proyecta como un **objeto 3D ensamblado** con su logo flotando encima, y al hacer scroll **se desmonta en sus partes**, al estilo de las páginas de producto.
- **Composición:**
  - A la izquierda, el objeto 3D fijo en pantalla (*sticky*).
  - A la derecha, una columna de texto con una sección por parte.
- **Mecánica:**
  - El primer tramo de scroll separa las piezas.
  - Después, la sección que estás leyendo ilumina su pieza en 3D y atenúa las demás. Se detecta con `IntersectionObserver`, sin escuchar el evento de scroll.
  - Cada pieza lleva una línea guía con su nombre.
- **Al abrir:** las piezas llegan volando desde fuera y se ensamblan.
- **Al terminar:** conceptos conectados y vuelta al mapa (también con Esc).
- **Contenido:** el prototipo incluye el despiece de Docker, Kubernetes, Terraform, GitHub Actions, AWS, Lambda, CloudWatch, Bedrock y Localhost.
- **En producción:** cada ficha MDX declara sus `parts` (nombre y explicación) en el frontmatter, y la vista se genera sola.
- **Siguiente nivel:**
  - Geometría propia por tecnología. Por ejemplo, Kubernetes como nodos con pods dentro, no como capas apiladas.
  - Paso de "despiece" a "laboratorio": en Docker, el demo interactivo de construir capas, ejecutar contenedores y comprobar la caché.

## Parada de referencia: Docker
Es la plantilla para todas las demás paradas. Tiene tres actos en un mismo scroll:

1. **Ensamblado:** el objeto completo con su logo.
2. **Despiece**, con geometría propia para cada parte:
   - Imagen base: retícula de sistema de archivos.
   - Dependencias: paquetes cúbicos.
   - Código: líneas de código.
   - Metadatos: marco discontinuo y sin relleno, porque no añaden archivos.
   - Capa de escritura: placa discontinua.
3. **Laboratorio**, donde la escena 3D cambia de modo:
   - **Build next step:** recorre el Dockerfile línea a línea y cada capa cae en su sitio. `COPY requirements.txt` deja la capa a medias y `RUN pip install` la completa.
   - **docker run:** hasta 3 contenedores, cada uno con su capa de escritura, flotan sobre **la misma imagen** y se unen a ella con líneas guía.
   - **Edit app.py and rebuild:** la base y las dependencias destellan como `cached`, el código y los metadatos vuelven a caer como `rebuilt`, y el Dockerfile marca cada línea.

Patrón que hereda cada tecnología:
- `parts[]` con `kind` (geometría) en el frontmatter.
- Un `lab` opcional con pasos declarativos.
- La lógica de animación es común a todas.

Pendiente de la parada Docker:
- Los contenedores se solapan en perspectiva cuando hay 3: separarlos también en profundidad.
- Mostrar el tamaño real de cada capa con un `docker history` simulado.

## Logos
- Fuente: **Simple Icons** (licencia CC0), fijado a `simple-icons@13.0.0` y servido desde jsDelivr.
  - En el prototipo cargan 26 logos reales.
  - Cuando no hay logo (CloudFront, ECR, Bedrock, y conceptos sin marca como State o Pod) se genera un **monograma hexagonal** propio.
- Se tiñen en el color del holograma (cian, o dorado si están en tu ruta) para que formen parte de la estética y no parezcan pegatinas.
- **Iconos de AWS (fase 0):** Simple Icons 15 retiró los iconos de servicios de AWS, así que se usan los **AWS Architecture Icons oficiales** (paquete del 31/07/2025).
  - Están en `apps/web/public/icons/aws/`, sin modificar, con su `NOTICE.md`. Se regeneran con `scripts/vendor-aws-icons.mjs`.
  - En el frontmatter, la ficha los referencia como `logo: aws:<nombre>`.
  - Los **paneles HTML** muestran el icono original, con su color y fondo.
  - El **holograma 3D** usa solo su glifo (los `<path>`, sin el cuadrado de fondo) teñido en cian, para que siga la estética.
  - AWS permite usarlos para crear diagramas de arquitectura. Si su guía de uso prohibiera recolorear, el 3D volvería al monograma: es un cambio de una línea en `build-logos.mjs`.
- **Ojo legal:** CC0 cubre el archivo SVG, no la marca. Se usan solo para identificar la tecnología (uso nominativo), sin sugerir patrocinio.
  - Para producción, valorar los **AWS Architecture Icons** oficiales, revisando sus condiciones de uso.
  - En producción, los SVG se empaquetan en el repo; no se piden a un CDN en tiempo de ejecución.

## Principios
1. **Modo oscuro único.** Decisión explícita del autor.
2. **Dos colores con significado fijo:**
   - **Cian holográfico `#7FE3FF`:** la interfaz y el conocimiento en reposo.
   - **Dorado `#FFC46B`:** lo que pertenece a *tu* ruta (nodos, requisitos activos, pasos).
   - El naranja `#FF8A6B` se reserva para avisos de trade-off.
3. **Los dominios son variaciones de cian a azul** (tono 170–230). Nunca compiten con el dorado.
4. **Estética HUD con mesura:**
   - Esquinas marcadas con corchetes en los paneles.
   - Etiquetas mono en mayúsculas solo para nodos principales y cabeceras.
   - Líneas de escaneo muy sutiles.
   - Lecturas del HUD **solo con datos reales**: conceptos, relaciones, componentes de la ruta, foco actual. Nada de cifras decorativas inventadas.
5. **El movimiento tiene que explicar algo:**
   - **Arranque:** los nodos se encienden de izquierda a derecha, en el sentido del viaje.
   - **Reposo:** rotación lenta para que se perciba el volumen.
   - **Clic:** la cámara vuela al concepto.
   - **Ruta:** los pulsos dorados indican la dirección del despliegue.
   - Con `prefers-reduced-motion` todo queda estático.
6. **Tipografía:** Geist y Geist Mono. Se evitan a propósito las fuentes "sci-fi" de cliché (Orbitron y similares): lo futurista lo dan el color, la luz y la composición.
7. **Formas:** paneles con radio de 4 px (técnicos), chips y botones con forma de píldora.

## Tokens
| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#04070B` con un degradado radial hacia `#0A1A26` | Fondo |
| `--panel` | `rgba(6,16,24,.62)` con desenfoque de 14 px | Paneles |
| `--holo` | `#7FE3FF` | Interfaz, nodos en reposo, botón principal |
| `--gold` | `#FFC46B` | Solo para la ruta del usuario |
| `--alert` | `#FF8A6B` | Avisos de trade-off |
| `--text` / `--muted` / `--faint` | `#DCF4FF` / `#7FA3B5` / `#476373` | Jerarquía de texto |

## Decisiones técnicas que salen de aquí
- **3D en producción:** Three.js a través de **React Three Fiber** y drei, cargado de forma diferida (*lazy load*) en un componente de cliente de Next.js.
  - El prototipo usa Three.js directamente y simula el brillo con sprites que suman su luz.
  - En producción, añadir un efecto de *bloom* real (`@react-three/postprocessing`) para que los puntos de luz resplandezcan.
- **Layout:** el prototipo calcula las posiciones con una relajación de fuerzas en 3D al cargar la página. En producción, calcularlas en el build con Python (pipeline `brain graph`) y servirlas en `graph.json`, para no hacer el cálculo en el navegador.
- **Alternativa obligatoria:** si el dispositivo no tiene WebGL o el usuario pide menos movimiento, servir el mapa 2D de la v1. También como modo "lista" accesible.
- **Las reglas del planificador salen del contenido**, no del código. Cada ficha declara en su frontmatter:
  - qué necesidades cubre: `satisfies`,
  - en qué condiciones conviene: `when`,
  - en qué grupo de la ruta aparece: `stage`.
- **Entender texto libre:**
  - F1: palabras clave.
  - F3: Claude con salida estructurada.

## Pendiente de iterar
- Efecto bloom real y rendimiento en portátiles modestos (objetivo: 60 fps con unos 300 nodos).
- Etiquetas que se solapan en las zonas densas.
- Transición del holograma a la parada: clic en Docker → la cámara entra → la explicación interactiva de capas se proyecta como panel holográfico.
- Revisión en móvil (holograma reducido, con el planificador debajo).

## Implementación en Next.js (fase 1)
- **Planificador:** `src/lib/planner.ts` evalúa el `planner.when` de cada ficha con el mismo lenguaje que `brain` (Python). Los dos se prueban contra `content/planner-cases.yaml`, sacado del prototipo original.
- **Despiece:** `src/components/teardown/`.
  - Canvas propio y fijo, cuya separación de piezas avanza con el scroll de la superposición (se lee en cada fotograma, sin escuchar el evento de scroll).
  - `IntersectionObserver` para saber qué pieza se está leyendo.
  - El mapa principal deja de renderizar (`frameloop="never"`) mientras el despiece está abierto.
- **Laboratorios:** se registran por id en `Teardown.tsx` (`LABS`) y la ficha los referencia con `lab: docker-layers`. Los pasos del Dockerfile viven en `labs/DockerLab.tsx`.
- **Canvas opacos:** con canvas transparente, el blending aditivo de Three.js moderno pinta de negro la geometría aún apagada. Por eso los dos canvas son opacos y el resplandor de fondo se dibuja dentro de la escena.
