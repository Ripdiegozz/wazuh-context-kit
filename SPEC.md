# wazuh-context-kit — Especificación

> Spec ejecutable para Claude Code.
> Repo destino: `github.com/Ripdiegozz/wazuh-context-kit` (personal, prototipo).
> Todos los repos de `wazuh/*` se tratan como **solo lectura**. Este proyecto no
> abre PRs contra ellos ni los modifica.

---

## 1. Problema

Los repos del dashboard de Wazuh incorporaron `CLAUDE.md` y skills en 5.0.0. La
calidad es buena; el mecanismo no. Evidencia medida sobre rama `5.0.0`:

Las mismas 6 skills existen en `wazuh-dashboard-plugins`, `wazuh-dashboard` y
`wazuh-dashboard-security-analytics`. **Ninguna es idéntica entre repos:**

| archivo | plugins | dashboard | security-analytics |
|---|---|---|---|
| `create-pr/SKILL.md` | 196 líneas | 172 | 168 |
| `issue-creation/SKILL.md` | 139 | 100 | 103 |
| `analyze-dashboard-vuln/SKILL.md` | 130 | 130 | 130 (3 hashes distintos) |

La deriva mezcla diferencias legítimas (el changelog de `wazuh-dashboard` explica
`changelogs/fragments/*.yml` heredado de OSD) con deriva pura (`check-standards`
corre typecheck en `wazuh-dashboard` pero no en `plugins`; el `settings.json` de
`plugins` permite `yarn format` y `knip`, el de `security-analytics` permite
`cypress` pero no `format`). **Mirando el archivo no se puede distinguir una
decisión de un olvido.** Ese es el fallo de fondo.

Además, `wazuh-indexer-plugins` tiene su propio `.claude/` con una familia de
skills completamente distinta (`docs-review`, `perf-tuning`, `wcs-management`) y
sin `CLAUDE.md` en raíz. Dos familias inventadas por separado en la misma
organización, sin capa común.

Y falta una capa entera. Menciones de `indexer` en los `CLAUDE.md` + `.claude/`:

```
wazuh-dashboard-plugins             0
wazuh-dashboard                     0
wazuh-dashboard-security-analytics  2
```

Cero menciones del cliente de OpenSearch, de `asScoped` vs `asInternalUser`, de
precedencia de configs. Lo documentado es **proceso** (PR, ramas, lint) y
**topología del repo** (`public`/`server`/`common`). Nada sobre el **dominio en
runtime**, que es justamente la parte compartida por todos los repos.

## 2. Objetivo

Construir la capa de contexto de dominio como **artefacto generado y verificable**,
no como prosa mantenida a mano.

Principio rector, que se aplica a cada decisión de diseño de este proyecto:

> Si un dato se puede derivar de un artefacto versionado, se genera.
> Si no se puede derivar, se escribe a mano y se le asigna un dueño.
> Si cambia en runtime, se consulta en runtime.
> Nunca se copia.

## 3. No-objetivos

- **No** vendorear documentación ni mappings dentro de los repos. Es el mismo
  fallo de deriva a escala mayor.
- **No** acoplar los forks upstream a `wazuhCore`. Encarece cada sync con
  upstream, que es el costo que la sección *Fork coexistence* de sus `CLAUDE.md`
  ya está administrando.
- **No** clonar `wazuh/wazuh` completo para contexto. Es el engine; meterlo en
  contexto es exactamente el problema de tokens que se quiere resolver.
- **No** construir un portal tipo Backstage. El problema no es descubrimiento de
  servicios, es conocimiento de dominio.
- **No** construir un sistema que aprenda del uso y se actualice solo. Ver 5.6:
  rompe la reproducibilidad, cierra un loop de retroalimentación sobre salida de
  modelo, y deja afirmaciones sin autor. Es el fallo de la sección 1 amplificado.

## 4. Los dos mundos

Distinción central que atraviesa todo el proyecto. Derivable del manifiesto:

**Mundo A — plugins nativos Wazuh.** Declaran `wazuhCore` en `requiredPlugins`.
Llegan al Server API por el contrato de `wazuh-core`:

```ts
// wazuh-dashboard-plugins/plugins/wazuh-core/server/types.ts
export interface WazuhCorePluginSetup {
  serverAPIClient: ServerAPIClient;
  api: { client: {
    asInternalUser: ServerAPIInternalUserClient;
    asScoped: (context, request) => ServerAPIScopedUserClient;
  }};
  manageHosts: ManageHosts;
  configuration: IConfigurationEnhanced;
  dashboardSecurity: ISecurityFactory;
  ctiFeedsClient: CTIFeedsClient;
}
```

> **`wazuh-core` NO es una vía de acceso al indexer.** Todo lo que expone esa
> interfaz es superficie del **Wazuh Server API**: `serverAPIClient`,
> `manageHosts` (hosts del Server API), `api.client`. No hay ningún cliente de
> OpenSearch ahí. Un plugin nativo que además consulte índices lo hace por otro
> camino — el plugin `data` de OSD, o `core.opensearch.client` — y ese camino es
> independiente de `wazuhCore`. Server API e indexer son dos backends distintos
> y se modelan como dos campos distintos (ver 1.5).

> **Trampa de nomenclatura:** el par `asScoped` / `asInternalUser` existe en
> **dos** APIs sin relación entre sí: `core.opensearch.client` de OSD (RBAC del
> indexer) y `api.client` de `wazuh-core` (RBAC del Server API). Mismos nombres
> de método, backends distintos, modelos de permisos distintos. Cualquier
> afirmación sobre `asScoped` que no diga de cuál de los dos habla es ambigua y
> no debe emitirse.

**Mundo B — forks upstream de OpenSearch.** No conocen Wazuh. Ejemplo real:

```json
// wazuh-dashboard-security-analytics/opensearch_dashboards.json
"requiredPlugins": ["data","navigation","opensearchDashboardsUtils",
                    "contentManagement","opensearchDashboardsReact"],
"optionalPlugins": ["dataSource","dataSourceManagement"],
"configPath": ["opensearch_security_analytics"],
"opensearchDashboardsVersion": "3.6.0",
"requiredOSDataSourcePlugins": ["opensearch-security-analytics"]
```

Llegan al indexer por el plugin `data` y su propio modelo de `dataSource`, con su
propio `configPath`, y versionan siguiendo a OSD (`3.6.0.0`), no a Wazuh.

**El error que esto previene:** hoy un agente trabajando en `security-analytics`
no tiene forma de saber que `context.wazuh_core` no existe en ese mundo. Lo va a
buscar, no lo va a encontrar, y en el peor caso lo va a agregar al manifiesto
porque lo vio en los otros repos. Las 6 skills idénticas sugieren que los tres
repos funcionan igual. No funcionan igual.

---

## 5. Modelo de despliegue

Sección fundacional. Define qué es este proyecto antes de definir qué hace.

### 5.1 Build-time y consume-time son dos lugares distintos

La herramienta es un **pipeline de build**. El producto es un **dataset versionado**.

```
BUILD-TIME — una vez, en Ripdiegozz/wazuh-context-kit
  wazuh-ctx matrix --ref 5.0.0
    → clona (blobless + sparse), parsea, clasifica
    → out/5.0.0/matrix.json  COMMITEADO al repo
    → PR, review, merge

CONSUME-TIME — en cada máquina que necesita contexto
  instala el paquete
  wazuh-ctx mcp
    → lee el dataset publicado
    → sin red, sin git, sin clonar, sin generar
```

El generador **no corre en el consumidor**. Tres razones, y las tres son
consecuencias de decisiones que ya están en esta spec:

1. **`decisions.yml` (5.2) no funcionaría.** Una decisión humana resuelta en una
   laptop no llega a nadie más. Las decisiones tienen que ser compartidas o no
   son decisiones, son notas personales.
2. **`payloadHash` (1.6.1) no significaría nada.** `ref: "5.0.0"` es una **rama**,
   no un tag — 1.4 hace `--branch <ref>`. Las ramas se mueven. Dos personas
   corriendo el mismo comando con una semana de diferencia obtienen hashes
   distintos, correctamente. El hash solo identifica algo compartido si el
   dataset se genera una vez y se distribuye.
3. **El costo de generación se pagaría N veces.** El proyecto existe para
   abaratar contexto. Hacer que cada persona clone ocho repos es lo contrario.

Consecuencia directa: **`out/` deja de estar en `.gitignore`.** El dataset se
commitea. Eso además regala un beneficio que la versión anterior no tenía: el
diff entre refs es historia auditable — *"entre 5.0.0 y 5.0.1 este plugin sumó
una dependencia a `dataSource`"*.

### 5.2 Las tres capas

No todo el dataset tiene el mismo estatuto epistémico, y el consumidor necesita
saber cuál es cuál. Cada celda declara su capa en `evidence.kind`.

| Capa | `evidence.kind` | Origen | Mutable | Fricción |
|---|---|---|---|---|
| **Derivada** | `derived` | Archivo versionado + commit | **No** | — |
| **Decisión** | `human-assertion` | `decisions.yml` | Sí, con review | PR al kit |
| **Anotación** | `annotation` | `annotations.yml` | Sí | Baja, aditiva |

**Capa 1 — derivada.** Sale de parsear un artefacto versionado. Verificable
contra un SHA. Se regenera y se sobrescribe en cada corrida.

**Capa 2 — decisión.** Resuelve un campo que no es derivable. Tiene autor, fecha,
motivo y evidencia. Cambia lo que es *correcto* para todos, así que pasa por
review.

**Capa 3 — anotación.** Conocimiento humano aditivo: advertencias, dueños,
contexto que ningún generador puede producir. Fricción deliberadamente baja.

**Regla dura de la capa 3: puede agregar, nunca reemplazar.** Una nota que dice
*"este plugin usa `asInternalUser` y saltea RBAC del usuario"* es aditiva y va sin
trámite. Una nota que dice *"en realidad `indexerAccess` es X"* no es una nota: es
una decisión de capa 2 y va por el camino pesado.

> **Por qué la capa 3 existe con fricción baja:** la sección 8.4 describe la
> página de mayor retorno de todo el proyecto, y no está escrita. No porque nadie
> sepa el contenido — porque escribirla es un trámite. La fricción ahí no protege
> nada, solo hace que el conocimiento no se registre.

### 5.3 Inmutabilidad y verificación

> **`out/<ref>/matrix.json` tiene un solo escritor: el generador, en build-time.**
> Nada del runtime lo toca.

- `wazuh-ctx mcp` → solo lee, y verifica antes de leer.
- `wazuh-ctx serve` → escribe `decisions.yml` y `annotations.yml`. Jamás la matriz.

Editar el dataset en una máquina desplegada no es "posible pero desaconsejado":
es **detectado y rechazado**.

```
wazuh-ctx mcp (arranque):
  1. lee out/<ref>/matrix.json
  2. recalcula el hash del payload (excluyendo "meta")
  3. compara contra payloadHash
  4. no coincide → NO ARRANCA. Mensaje nombrando el archivo y los dos hashes.
```

Mismo mecanismo que el `check` de la Fase 2. Una primitiva, dos usos.

**Por qué el overlay vive en archivos separados:** no es solo para compartirlo. Si
una decisión humana se registrara editando `matrix.json`, se rompería el hash y
con él toda capacidad de verificar el artefacto. Manteniendo las capas 2 y 3
afuera, el dataset base sigue siendo verificable indefinidamente y las decisiones
siguen siendo auditables por separado. La restricción y la funcionalidad salen de
la misma decisión de diseño.

**Válvula de escape.** Casos legítimos existen: una rama con un plugin que todavía
no está upstream, o probar una clasificación alternativa. Se permite
`decisions.local.yml`, con dos condiciones no negociables:

- está en `.gitignore`;
- **toda** respuesta del MCP que toque una celda pisada localmente viene marcada
  con `overlay: "local"`. Nunca silenciosa. El agente tiene que saber que ese
  valor no viene del dataset publicado.

`wazuh-ctx check` avisa cuando hay overrides locales de más de 30 días, empujando
a subirlos. Válvula de presión, nunca flujo de trabajo.

### 5.4 Ciclo de regeneración

La Fase 2 dice que no se puede instalar CI en `wazuh/*`. Es cierto y es
irrelevante: **la regeneración corre en `Ripdiegozz/wazuh-context-kit`**, leyendo
repos públicos. Cero permisos sobre la organización.

```
cron diario
  ↓
git ls-remote --heads https://github.com/wazuh/<repo>.git <ref>
  ↓ (8 llamadas, sin clonar nada)
¿algún SHA se movió respecto de resolvedRefs?
  NO  → termina. Sin PR, sin ruido, costo casi cero.
  SÍ  → clona solo los movidos, regenera, reconcilia, abre PR
```

`ls-remote` devuelve el SHA de una rama sin clonar. Por eso el cron puede ser
diario: la mayoría de los días no hace nada. Diario y no semanal porque durante
un ciclo de release una rama se mueve seguido, y seis días de atraso silencioso
es demasiado.

**Abre PR. Nunca auto-commit.** El PR de regeneración **es** el sistema de
detección de cambios: si aparece un PR, algo se movió upstream, y el diff dice
qué. Auto-commitear haría entrar los cambios en silencio, que es exactamente el
agujero de la sección 1 reconstruido dentro de esta herramienta.

**Regenerar es parsear y reconciliar.** Las capas 2 y 3 sobreviven a la
regeneración, pero pueden quedar desalineadas. El PR reporta:

```
activa      → el campo sigue sin ser derivable. Nada que hacer.
superada    → el campo ahora SÍ es derivable.
                Si el valor derivado coincide con el decidido → retirar la decisión.
                Si DIFIERE → hallazgo fuerte: o la regla está mal, o la decisión
                lo estaba. Requiere revisión humana explícita.
huérfana    → el plugin ya no existe. Se marca, no se borra.
```

Ese cruce es probablemente la señal más valiosa que emite el sistema.

**Dueño — ENMENDADO 2026-09-15.** La versión original de este párrafo decía que
una persona tiene que mirar el diff y mergear, y que esa persona es Diego: bus
factor de uno, escrito acá en vez de fingir que no.

Se resolvió así, y la resolución es un reparto, no una excepción:

- **Sin conflictos de reconciliación → merge automático** cuando pasan tests,
  typecheck, build y el guard de frescura. Mecánicamente el workflow espera los
  checks requeridos y mergea él mismo, en vez de usar el auto-merge de GitHub:
  un PAT fine-grained no puede invocar `enablePullRequestAutoMerge`. La política
  es idéntica; cambia quién aprieta el botón. Ese diff es generado y determinista;
  nadie lo lee línea por línea y nadie debería tener que hacerlo. Poner a una
  sola persona como único camino de publicación era el riesgo mayor.
- **Con al menos un conflicto → el PR espera a un humano**, etiquetado
  `needs-human-review`, con auto-merge deliberadamente NO habilitado.

La distinción no es cosmética. "Abre PR, nunca auto-commit" existe para que los
cambios no entren en silencio, y un PR que se mergea solo entra en silencio **si
nadie garantiza que no traiga la señal que requiere ojos**. Un conflicto de
reconciliación es exactamente esa señal, y ningún test falla ante uno. Por eso el
gate es el conflicto y no el CI a secas.

El resto de esta sección sigue vigente: el PR sigue siendo el sistema de
detección de cambios, y sigue reportando activa / superada / huérfana.

**El dataset avisa cuando envejece.** `matrix.json` lleva `resolvedAt`, y
`wazuh-ctx mcp` emite una advertencia cuando supera 30 días. No depende de que
alguien se acuerde de chequear: el dato declara su propia edad.

### 5.5 Qué sí aprende del uso

**Telemetría de huecos.** El MCP registra qué se consultó y qué devolvió
`unknown`. No cambia ningún dato: cambia la prioridad del trabajo humano.

```
indexerAccess de securityAnalyticsDashboards: 40 consultas, 40 unknown
```

`unknowns[]` deja de ser una lista alfabética y pasa a estar ordenada por dolor
real. Riesgo cero: no afirma nada, no se propaga, no muta el dataset.

Local por defecto, agregable, y sin contenido de consultas — solo qué campo de
qué plugin y si se resolvió.

**Adaptación de la vista, nunca de los hechos.** El MCP mira el `cwd` y detecta el
mundo. Estás en `wazuh-dashboard-security-analytics` → Mundo B, y antes de que
preguntes nada:

> Fork upstream. `context.wazuh_core` no existe acá.
> El acceso al indexer va por `dataSource`.

Eso previene exactamente el error descrito al final de la sección 4, y cuesta una
comparación de path. Adapta **qué se muestra y en qué orden**, nunca **qué es
verdad**.

**La AI como proponente, nunca como committer.** Un agente trabajando en el repo
puede leer el código y resolver un `unknown`. Dos caminos, y la distinción es
nítida:

- **Si se puede derivar de forma confiable, pertenece al generador.** Si grepear
  `src/server/**` por `core.opensearch.client` resuelve el campo, entonces el
  campo *es derivable* y `parse/` tiene que hacerlo en build-time,
  determinísticamente, para todos. Que un agente lo descubra en runtime no es
  aprendizaje: es un parser que falta, corriendo en el peor momento y para una
  sola persona.
- **Si requiere juicio, la AI propone** una entrada de `decisions.yml` con
  `author: claude-agent` y su evidencia, y pasa por el mismo PR que la de un
  humano. Baja la fricción de escribir; no baja la barra de revisar.

### 5.6 Qué no aprende, y por qué

Si el dataset se actualizara solo con el uso:

- **Se rompe la reproducibilidad.** Dos datasets difieren porque se usaron
  distinto. `payloadHash` deja de significar nada y dos agentes contestan distinto
  sin que ninguno mienta.
- **Se cierra un loop sobre salida de modelo.** La AI afirma algo, queda guardado,
  y más tarde otra AI lo lee como evidencia. La confianza sube sin que entre un
  solo dato nuevo.
- **Las afirmaciones pierden autor.** *"Lo aprendió el sistema"* no es una fuente.

Y el remate: dejaría de poder distinguirse una decisión de un olvido de un
artefacto estadístico. Es la sección 1, empeorada.

**El valor de este dataset es exactamente su verificabilidad.** Un hecho con SHA
adjunto vale más que diez plausibles. Un contexto inconfiable es peor que ninguno:
el agente no puede saber a qué parte creerle, así que o le cree a todo y propaga
errores con autoridad, o no le cree a nada.

---

# FASE 1 — Generador de matriz

El entregable con resultado visible más rápido y sin prosa que escribir.

## 1.1 Stack

**Bun 1.4.0** como runtime de desarrollo, build y test. **TypeScript 7.0.2**
(port nativo en Go).

Versiones fijadas contra el registry, no estimadas:

| Paquete | Versión | Rol |
|---|---|---|
| `zod` | `4.6.5` | Validación de **entrada** (ver nota) |
| `yaml` | `2.9.1` | `sources.yml`, `decisions.yml`, WCS `.yml` |
| `@modelcontextprotocol/sdk` | `1.30.0` | Fase 3 |
| `typescript` | `7.0.2` | devDep |
| `@types/bun` | `1.4.2` | devDep |

**Dependencias de producción en Fase 1: dos.** `yaml` y `zod`.

- **Test runner:** `bun test`. Sin Vitest ni Jest — el núcleo son funciones puras.
- **Parsing de argumentos:** `util.parseArgs` (compat Node en Bun). Sin commander
  ni yargs; seis subcomandos no lo justifican.
- **git:** por subprocess. Ningún binding nativo para correr tres comandos.
- **Bundler:** ninguno para el CLI.

> **`zod` va en la entrada, no en la salida.** La salida la escribe este proyecto
> y su forma es conocida. Donde zod gana es parseando manifiestos de repos que no
> se controlan: un manifiesto sin `id`, o con `requiredPlugins` como string en vez
> de array, tiene que producir un `unknown` limpio, no un crash. El criterio
> *"`wazuh-dashboard-ml-commons` aparece en `skipped`, no crashea"* es exactamente
> un criterio de robustez de entrada.

### 1.1.1 Bun en dev, Node en distribución

Bun es la decisión de **desarrollo**. La **distribución** no puede requerirlo: los
repos de la organización están parados en Node 22 (`.nvmrc` 22.22.0) y Yarn v1, y
la Fase 2 distribuye por npm. Exigir Bun a cada consumidor agrega una toolchain
donde el proyecto busca reducir fricción.

```
bun test / bun run           desarrollo, rápido
bun build --target node      salida que corre en Node 22+ Y en Bun
```

`engines.node: ">=22"` en `package.json`. La velocidad donde se siente (tests,
iteración), cero costo de adopción donde importa (consumo).

## 1.2 Fuentes — rutas verificadas

Todas confirmadas en rama `5.0.0`.

**Manifiestos del dashboard** — `**/opensearch_dashboards.json`:

```
wazuh-dashboard-plugins/plugins/main/opensearch_dashboards.json
wazuh-dashboard-plugins/plugins/wazuh-core/opensearch_dashboards.json
wazuh-dashboard-plugins/plugins/wazuh-check-updates/opensearch_dashboards.json
wazuh-dashboard-plugins/plugins/wazuh-ai-assistant/opensearch_dashboards.json
wazuh-dashboard-security-analytics/opensearch_dashboards.json
```

**`package.json` hermano de cada manifiesto** — obligatorio, no opcional. De ahí
sale `versionScheme` (ver 1.5.1), que a su vez discrimina `upstream-fork`. Sin
este archivo en el sparse-checkout, dos campos derivados colapsan a `unknown`:

```
<dir-del-plugin>/package.json      junto a cada opensearch_dashboards.json
```

**Índices y esquema** — en `wazuh-indexer-plugins`:

```
plugins/setup/src/main/resources/templates/states/*.json
    agent-config, agent-stats, fim-files, fim-registry-keys, fim-registry-values,
    inventory-{browser-extensions,groups,hardware,hotfixes,interfaces,networks,
    packages,ports,processes,protocols,services,system,users}
plugins/setup/src/main/resources/templates/{cve,ism-config,settings,setup-status}.json
plugins/setup/src/main/resources/templates/content/*.json
plugins/content-manager/src/main/resources/mappings/*.json
wcs/<módulo>/fields/custom/*.yml      ← definición WCS
wcs/<módulo>/fields/subset.yml
wcs/<módulo>/docs/fields.csv          ← generado, plano, fácil de parsear
wcs/<módulo>/docs/wcs_flat.yml
```

> **Corrección respecto de un supuesto inicial:** los mappings NO requieren
> introspección de un cluster vivo. Están declarados en JSON/YAML versionado, en
> el mismo esquema de ramas (`5.0.0`, `5.0.1`). Son **derivables**. Solo el
> configuration service del dashboard y los roles efectivos necesitan runtime
> (ver Fase 3).

## 1.3 Lista de repos: explícita, nunca derivada

`sources.yml` en la raíz del proyecto. **No inferir nombres por convención.** El
naming de la organización es inconsistente y hay colisiones reales:

- Existen `wazuh/wazuh-dashboard-reporting` **y** `wazuh/wazuh-dashboards-reporting`,
  ambos con rama `5.0.0`. Cuál es el vigente es una decisión humana, no derivable.
- El plugin de seguridad es `wazuh/wazuh-security-dashboards-plugin`, no
  `wazuh-dashboard-security`.
- `wazuh/wazuh-dashboard-ml-commons` existe pero **no tiene rama `5.0.0`**.

Formato:

```yaml
refs: ["5.0.0"]              # multi-ref; sobreescribible con --ref
repos:
  - { name: wazuh-dashboard,                    kind: platform }
  - { name: wazuh-dashboard-plugins,            kind: dashboard }
  - { name: wazuh-dashboard-alerting,           kind: dashboard }
  - { name: wazuh-dashboard-notifications,      kind: dashboard }
  - { name: wazuh-dashboard-reporting,          kind: dashboard }
  - { name: wazuh-dashboard-security-analytics, kind: dashboard }
  - { name: wazuh-security-dashboards-plugin,   kind: dashboard }
  - { name: wazuh-indexer-plugins,              kind: indexer }
  - { name: wazuh-dashboard-ml-commons,         kind: dashboard }
```

**Un repo sin rama vigente se lista igual.** `wazuh-dashboard-ml-commons` no tiene
rama `5.0.0`, y por eso mismo tiene que estar en `sources.yml`: `fetch/` solo
puede sondear repos que este archivo nombre. Si se omite, el criterio de 1.9
—"aparece en `skipped` con motivo, no crashea"— es **imposible de probar**,
porque no hay nada sobre lo cual `git ls-remote` pueda volver vacío.

La lista enumera lo que se **consulta**, no lo que se espera encontrar. Un repo
ausente del listado no produce un `skipped`: produce un silencio, que es
precisamente lo que esta spec no admite en ningún lado.

## 1.4 Estrategia de fetch — obligatoria

Clone blobless + sparse. No negociable: el repo de documentación tiene 1506 PNG
contra 771 RST, y `wazuh/wazuh` es el engine completo.

```bash
git clone --depth 1 --branch <ref> --filter=blob:none --no-checkout \
          https://github.com/wazuh/<repo>.git .cache/<repo>@<ref>
git -C <dir> sparse-checkout init --cone
git -C <dir> sparse-checkout set <solo las rutas de 1.2>
git -C <dir> checkout
```

Cache por `<repo>@<ref>` en `.cache/`, en `.gitignore`. Segunda corrida debe ser
offline. Registrar el SHA resuelto para usarlo como evidencia.

**Chequeo previo sin clonar** (usado por el ciclo de 5.4):

```bash
git ls-remote --heads https://github.com/wazuh/<repo>.git <ref>
```

Devuelve el SHA sin transferir objetos. Si ningún SHA difiere de `resolvedRefs`,
no hay nada que regenerar.

## 1.5 Clasificación — determinista, con origen declarado por campo

Cada campo derivado declara de qué artefacto sale. Un campo que no salga de un
artefacto versionado se marca como aserción humana y no lleva commit.

### 1.5.1 Identidad

```
pluginId = manifest.id        campo del manifiesto OSD, única fuente admitida
         | "unknown"          si el manifiesto no lo declara

  PROHIBIDO derivar pluginId del nombre del directorio o de package.json.
  El directorio es una convención, no un contrato.

versionScheme = "osd"      si package.json.version tiene 4 componentes ("3.6.0.0")
              | "wazuh"    si package.json.version tiene 3 componentes y su
                              línea coincide con el ref de sources.yml
              | "unknown"   en cualquier otro caso
```

### 1.5.2 Mundo

```
world = "platform"       si repo.kind == platform en sources.yml
      | "wazuh-native"   si requiredPlugins incluye "wazuhCore"
      | "upstream-fork"  si NO incluye "wazuhCore" Y versionScheme == "osd"
      | "unknown"        en cualquier otro caso
```

`platform` es una **aserción humana**, no una derivación: su evidencia es
`sources.yml` y la línea correspondiente, no un commit de repo. Se emite con
`evidence.kind: "human-assertion"`.

Se descarta el test anterior sobre `opensearchDashboardsVersion` como literal
semver: ese campo vale con frecuencia la cadena `"opensearchDashboards"` y no
discrimina de forma confiable. `versionScheme` derivado de `package.json` es la
señal fuerte, y es la que la sección 4 ya usaba en prosa.

### 1.5.3 Acceso a backends — dos campos, no uno

Server API e indexer son backends distintos. Se modelan por separado.

```
serverApiAccess = "wazuh-core"  si requiredPlugins incluye "wazuhCore"
                | "none"        si el manifiesto no declara wazuhCore
```

```
indexerAccess : conjunto (no enum). Se emiten TODOS los que apliquen:

  "osd-data"         si "data" está en requiredPlugins u optionalPlugins
  "osd-data-source"  si "dataSource" está en requiredPlugins u optionalPlugins
  "os-plugin-bound"  si el manifiesto declara requiredOSDataSourcePlugins
                        (se emite además la lista, como evidencia de qué plugin
                         del lado del indexer espera encontrar)
```

Un plugin puede tener varios a la vez y eso es información, no un empate a
resolver. `wazuh-dashboard-security-analytics` declara `data` en
`requiredPlugins`, `dataSource` en `optionalPlugins` y
`requiredOSDataSourcePlugins: ["opensearch-security-analytics"]`: los tres
valores son ciertos simultáneamente y los tres se emiten.

**Conjunto vacío no significa "no accede al indexer".** Significa que el
manifiesto no declara ninguna vía. El acceso por `core.opensearch.client` es un
hecho de **código**, no de manifiesto, y por lo tanto no es derivable en esta
fase. Todo plugin con `indexerAccess: []` se emite además en `unknowns[]` con
`reason: "acceso a indexer no derivable desde el manifiesto"`.

### 1.5.4 Lo desconocido se declara

`"unknown"` y el conjunto vacío son resultados válidos y esperados.
**Prohibido adivinar.** Todo campo no derivable queda listado en `unknowns[]`
como pendiente de decisión humana, y `wazuh-ctx matrix --strict` sale con código
distinto de cero cuando ese arreglo no está vacío, para poder usarse como gate.

Esa es la propiedad que evita que la matriz se convierta en otra fuente de deriva.

## 1.6 Salida

Dos artefactos por ref: `out/<ref>/matrix.json` (fuente) y `out/<ref>/MATRIX.md`
(renderizado desde el JSON, nunca editado a mano). **Ambos commiteados** (5.1).

```jsonc
{
  // meta NO entra en payloadHash y NO se renderiza en MATRIX.md.
  // Es el único bloque no determinista del archivo.
  "meta": { "generatedAt": "...", "tool": "wazuh-ctx@0.1.0" },

  // sha256 de todo el documento excepto "meta" y "payloadHash",
  // con claves ordenadas y serialización canónica.
  "payloadHash": "sha256:...",

  "ref": "5.0.0",
  "resolvedAt": "2026-09-14T00:00:00Z",   // para la advertencia de obsolescencia
  "resolvedRefs": {                        // el dataset se identifica por SHAs,
    "wazuh-dashboard-plugins": "5157de35...",  // no por nombre de rama
    "wazuh-indexer-plugins": "a91c02f1..."
  },

  "plugins": [{
    "repo": "wazuh-dashboard-plugins",
    "pluginId": "wazuh",
    "pluginDir": "plugins/main",
    "world": "wazuh-native",
    "versionScheme": "wazuh",
    "configPath": ["wazuh"],
    "serverApiAccess": "wazuh-core",
    "indexerAccess": [],              // conjunto; vacío ⇒ entra en unknowns[]
    "requiredOSDataSourcePlugins": [],
    "requiredPlugins": ["...", "wazuhCore"],
    "optionalPlugins": ["..."],
    "evidence": {                     // procedencia del REGISTRO del plugin
      "kind": "derived",              // "derived" | "human-assertion"
      "manifestPath": "plugins/main/opensearch_dashboards.json",
      "packageJsonPath": "plugins/main/package.json",
      "commit": "5157de35..."
    },
    // Procedencia POR CELDA. Presente ⇒ decidida por una persona;
    // ausente ⇒ derivada. Esto es lo que hace que "toda celda lleva
    // evidencia" sea literal y no verdadero-a-nivel-plugin.
    "assertions": {
      "world": {
        "kind": "human-assertion",
        "source": "decisions.yml",
        "author": "diego.garcia",
        "date": "2026-09-14",
        "reason": "..."
      }
    },
    "annotations": [{ "kind": "warning", "text": "...", "author": "...", "date": "..." }]
  }],
  "indexer": {
    "templates": [{ "name": "inventory-packages", "path": "...", "indexPatterns": ["..."] }],
    "wcsModules": [{ "name": "content/decoders", "fieldsCsv": "...", "fieldCount": 0 }]
  },
  "skipped": [{ "repo": "wazuh-dashboard-ml-commons", "reason": "no existe rama 5.0.0" }],
  "unknowns": [{
    "plugin": "securityAnalyticsDashboards",
    "field": "indexerAccess",
    "reason": "acceso a indexer no derivable desde el manifiesto"
  }],
  // Ciclo de vida de decisions.yml, recalculado en cada corrida (5.4).
  "reconciliation": [{
    "plugin": "wazuhCore",
    "field": "world",
    "status": "active",             // active | superseded | orphaned
    "note": "field is not derivable; decision applied",
    "decidedValue": "wazuh-native",
    "derivedValue": null,
    "conflict": false
  }]
}
```

**Toda celda lleva evidencia.** Las derivadas llevan ruta de archivo + commit;
las aserciones humanas llevan `kind: "human-assertion"` y su origen en
`decisions.yml`. Ninguna afirmación sin origen verificable, y ninguna aserción
humana disfrazada de derivación.

### 1.6.1 Determinismo

`meta.generatedAt` es el único valor que cambia entre corridas sobre las mismas
entradas. Queda fuera de `payloadHash` y fuera de `MATRIX.md` justamente para que
dos corridas consecutivas sean diffeables: si el mismo cache produce dos
`payloadHash` distintos, el generador no es determinista y eso es un bug.
`--frozen-time <iso>` fija `generatedAt` para reproducir una corrida exacta.

El pie de `MATRIX.md` renderiza `ref`, `payloadHash` y `resolvedRefs`. Nunca
`generatedAt`.

## 1.7 Capas humanas — `decisions.yml` y `annotations.yml`

### 1.7.1 `decisions.yml` (capa 2)

Versionado, commiteado, revisado. Resuelve campos no derivables.

```yaml
- plugin: securityAnalyticsDashboards
  field: indexerAccess
  value: ["osd-data", "osd-data-source"]
  author: diego.garcia
  date: 2026-09-14
  reason: "verificado en server/clusters/*.ts — usa el cliente de dataSource"
  evidence: "src/server/clusters/security_analytics_cluster.ts:42"
  status: active          # active | superseded | orphaned
```

Ciclo de vida reconciliado en cada regeneración, según 5.4.

**Regla de precedencia: lo derivado le gana a lo aseverado.** Una decisión humana
solo llena un hueco. En el momento en que un campo pasa a ser derivable, el valor
derivado gana, la decisión **no se aplica**, y se reporta como `superseded`. Una
decisión vieja tapando en silencio un hecho verificable es exactamente el fallo
que este proyecto existe para evitar.

El dominio de valores de cada campo se valida en la carga. Un valor fuera de
dominio es un error fatal, no un warning — en particular, `"wazuh-core"` en
`indexerAccess` se rechaza, para que la capa de decisiones no pueda reintroducir
la confusión que la sección 4 desarma.

**Campos decidibles:** `pluginId`, `world`, `versionScheme`, `serverApiAccess`,
`indexerAccess`. El conjunto es cerrado: una decisión que nombre otro campo se
rechaza en vez de ignorarse, porque una decisión que no hace nada es peor que
ninguna — alguien cree que está vigente.

### 1.7.1.1 Caso conocido: `wazuhCore` no puede clasificarse a sí mismo

La regla de 1.5.2 detecta un plugin nativo por su dependencia de `wazuhCore`.
Pero `wazuh-core` es el plugin que **provee** ese contrato: no se declara a sí
mismo como dependencia, y la regla devuelve `unknown`.

**El plugin que provee el contrato no puede clasificarse por la regla que depende
de consumirlo.**

Se resuelve con una entrada en `decisions.yml`, no con una cuarta regla en el
clasificador. Un caso especial con nombre propio adentro de `classifyWorld` haría
que la regla describa una instancia en lugar de una propiedad, y cada futuro
plugin proveedor necesitaría su propia rama. Como aserción humana queda con
autor, motivo y fecha, y aparece marcada en `MATRIX.md`.

### 1.7.2 `annotations.yml` (capa 3)

Aditivo. Nunca reemplaza un valor derivado. Fricción baja a propósito.

```yaml
- plugin: wazuh
  kind: warning
  text: "El cliente del Server API usa asInternalUser por defecto en varios
         handlers; eso saltea el RBAC del usuario. Ver decisión pendiente 8.4."
  author: diego.garcia
  date: 2026-09-14
```

### 1.7.3 `decisions.local.yml`

Gitignored. Toda celda pisada se sirve marcada con `overlay: "local"` (5.3).

## 1.8 Cruce — la pregunta que hoy se contesta abriendo tres repos

Comando `wazuh-ctx crosscheck`: qué índices declara `wazuh-indexer-plugins` vs
cuáles referencian realmente los plugins del dashboard. Reporta:

- índices declarados que ningún plugin consume,
- referencias a índices del dashboard que no existen del lado del indexer,
- módulos WCS sin consumidor conocido.

Ningún repo puede responder esto por sí solo. Es el valor diferencial de la fase.

**Consecuencia del modelo de 1.5.3:** "qué índices referencia un plugin" es un
hecho de código, no de manifiesto. El crosscheck necesita escanear fuentes, no
solo `opensearch_dashboards.json`, y por lo tanto el sparse-checkout de 1.4 debe
incluir los directorios de código de los plugins del dashboard además de las
rutas de 1.2. Si se decide no pagar ese costo, el crosscheck reporta solo la
dirección indexer → dashboard y **declara explícitamente** que la dirección
inversa quedó sin cubrir. Lo que no se hace, se dice.

## 1.9 Criterios de aceptación — Fase 1

- [ ] `wazuh-ctx matrix --ref 5.0.0` genera `out/5.0.0/matrix.json` y `MATRIX.md`.
- [ ] Se detectan los 4 plugins de `wazuh-dashboard-plugins` con sus ids reales:
      `wazuh`, `wazuhCore`, `wazuhCheckUpdates`, `wazuhAiAssistant`.
- [ ] `wazuh` clasifica `wazuh-native`; `securityAnalyticsDashboards` clasifica
      `upstream-fork` con `configPath: ["opensearch_security_analytics"]`.
- [ ] Ningún plugin emite `serverApiAccess` e `indexerAccess` con el mismo valor.
      Test explícito: **ningún** `indexerAccess` contiene `"wazuh-core"`, en
      ningún repo. Ese valor no existe en el dominio del campo.
- [ ] `securityAnalyticsDashboards` emite `indexerAccess` con los tres valores
      simultáneos: `osd-data`, `osd-data-source`, `os-plugin-bound`.
- [ ] Todo plugin con `indexerAccess: []` aparece en `unknowns[]`.
- [ ] `pluginId` sale siempre de `manifest.id`. Test que falla si el generador
      cae al nombre del directorio cuando el manifiesto no declara `id`.
- [ ] `wazuh-dashboard-ml-commons` aparece en `skipped` con motivo. No crashea.
- [ ] Se listan ≥ 18 templates bajo `templates/states/`.
- [ ] Segunda corrida consecutiva funciona **sin red** (cache).
- [ ] Dos corridas consecutivas sobre el mismo cache producen **idéntico**
      `payloadHash`. Si difieren, falla.
- [ ] Toda entrada de `plugins[]` declara `evidence.kind`. Las `derived` tienen
      `commit` no vacío; las `human-assertion` apuntan a `decisions.yml` y **no**
      llevan commit.
- [ ] `MATRIX.md` se regenera byte-idéntico desde el mismo `matrix.json`, y
      también entre dos corridas distintas sobre el mismo cache.
- [ ] `resolvedRefs` tiene un SHA por cada repo no salteado.
- [ ] Test que falla si algún campo derivado se emite sin evidencia.
- [ ] `--strict` sale con código ≠ 0 cuando `unknowns[]` no está vacío.
- [ ] Una decisión de `decisions.yml` cuyo campo pasó a ser derivable se reporta
      como `superseded`, y si el valor difiere, el reporte lo marca como hallazgo.
- [ ] Una decisión `superseded` **no se aplica**: el valor derivado gana.
- [ ] Una decisión para un plugin ausente se reporta `orphaned`, no se descarta.
- [ ] Un campo resuelto por decisión desaparece de `unknowns[]` y aparece en
      `assertions` con autor, fecha y motivo.
- [ ] Un plugin con una celda aseverada conserva su `evidence.kind: "derived"`
      a nivel registro: la aserción no borra de dónde salió el plugin.
- [ ] `indexerAccess: ["wazuh-core"]` en `decisions.yml` es error fatal.
- [ ] Un valor fuera del dominio de su campo es error fatal.
- [ ] Una anotación no cambia ningún valor derivado. Test comparando el plugin
      con y sin anotaciones.
- [ ] `wazuhCore.world` se resuelve por `decisions.yml` y `MATRIX.md` lo marca
      con `†` junto a su motivo.

---

# FASE 1.5 — Inspector (`wazuh-ctx serve`)

`matrix.json` tiene ~20 plugins × 12 campos con cadena de evidencia, más 19+
templates, más módulos WCS, más el crosscheck. Leerlo como JSON crudo es
impracticable. Y el crosscheck (1.8) **no es una tabla: es un grafo bipartito**
—índices declarados ↔ plugins que los consumen, con huérfanos de los dos lados—
donde markdown es genuinamente débil.

## 1.5.1 Alcance

```
wazuh-ctx serve --ref 5.0.0
  → HTTP local
  → GET  /api/matrix       lee out/<ref>/matrix.json
  → GET  /api/unknowns     cola de trabajo, ordenada por telemetría (5.5)
  → POST /api/decisions    escribe decisions.yml
  → POST /api/annotations  escribe annotations.yml
```

**El botón de guardar no muta estado: produce un diff para commitear.** La UI es
una herramienta de autoría de PRs, no un panel de administración.

No es app de escritorio. No hay Electron. El consumidor primario del dataset es
un agente vía MCP; el inspector es para las personas que mantienen el dataset.

## 1.5.2 Stack de UI

Vite `8.3.0` + React `19.3.0`. No es la decisión interesante del proyecto y no se
la trata como tal.

## 1.5.3 Criterios de aceptación — Fase 1.5

- [ ] La UI no escribe fuera de `decisions.yml`, `annotations.yml` y
      `decisions.local.yml`. Test que falla si toca `matrix.json`.
- [ ] Vista de crosscheck como grafo, con huérfanos de ambos lados visibles.
- [ ] Toda celda muestra su `evidence.kind` y su origen. Derivadas enlazan al
      archivo + commit.
- [ ] Guardar produce un diff YAML mostrado al usuario antes de escribir.
- [ ] Corre contra fixtures, sin haber clonado ningún repo.

---

# FASE 2 — Paquete de estándares

## 2.1 Extracción, no reescritura

Tomar las 6 skills de los 3 repos del dashboard y hacer diff a 3 bandas por
archivo. Clasificar cada bloque divergente en:

- **común** → va a `core/skills/<skill>/SKILL.md`,
- **override intencional** → `overrides/<repo>/<skill>.yml`,
- **CONFLICTO** → se reporta, **no se resuelve automáticamente**.

El patrón de override ya existe en sus archivos y hay que formalizarlo tal cual:

```markdown
> **repo-specific (wazuh-dashboard):** live version bases include `main`, the
> `4.14.x` line, `5.0.0`, `5.0.1`, and `6.0.0`.
```

Hoy vive incrustado dentro de archivos duplicados. Pasa a ser una capa real.

### 2.1.1 Formato de override — parche anclado, no blob

Un `.md` plano no puede expresar *dónde* va un bloque, y el ejemplo de arriba
vive incrustado a mitad de documento. Sin modelo posicional la reconstrucción es
imposible por construcción. El override es una lista ordenada de operaciones con
anclas:

```yaml
# overrides/wazuh-dashboard/create-pr.yml
skill: create-pr
repo: wazuh-dashboard
ops:
  - op: insert-after
    anchor: "## Version bases"      # debe resolver a EXACTAMENTE una posición
    content: |
      > **repo-specific (wazuh-dashboard):** live version bases include `main`,
      > the `4.14.x` line, `5.0.0`, `5.0.1`, and `6.0.0`.
  - op: replace-block
    anchor: "### Checks"
    match: "yarn lint\n"
    content: "yarn lint\nyarn typecheck\n"
```

Operaciones admitidas: `insert-after`, `insert-before`, `replace-block`,
`delete-block`. Regla dura: **un ancla que resuelve a cero o a más de una
posición es un error fatal del `sync`, no un warning.** Un ancla ambigua que
aplica "en algún lado" es exactamente la clase de silencio que produjo la tabla
de la sección 1.

`wazuh-ctx skills-diff` debe emitir un reporte legible con cada conflicto y su
contexto, para que una persona decida. **No hay auto-merge.** Diferencias como
"typecheck sí / typecheck no" pueden ser decisión o descuido, y el generador no
puede saberlo.

## 2.2 Las skills del indexer quedan aparte

`wazuh-indexer-plugins` tiene `docs-review`, `perf-tuning`, `wcs-management` —
otra familia. Fase 2 **reporta** el solape de proceso (flujos de PR e issues son
presumiblemente los mismos y están escritos dos veces desde cero) pero **no
fusiona nada**. Es input para una conversación entre equipos, no una refactorización.

## 2.3 Distribución y anti-deriva

Paquete npm (ya usan Yarn v1 en todos los repos, no agrega herramienta nueva).
`wazuh-ctx sync` lo materializa en `.claude/standards/` versionado.

`wazuh-ctx check` compara hashes de `.claude/standards/**` contra la versión del
paquete y falla si hubo edición local. Ese es el mecanismo que evita volver a la
tabla de la sección 1.

**Restricción de esta fase dado que el repo es personal:** no se puede instalar
CI en los repos de `wazuh/*`. Entonces:

- `wazuh-ctx check` corre en **dry-run** contra los clones del cache.
- El workflow de GitHub Actions se entrega como archivo **propuesto** en
  `proposals/`, no instalado.
- Nada en esta fase requiere permisos sobre la organización.

**Y hay que decirlo sin adorno:** ningún repo de `wazuh/*` contiene hoy
`.claude/standards/`, y ponerlo ahí requiere un PR que este proyecto no abre. Es
decir que `check` **no tiene blanco real** dentro del alcance de la Fase 2: sobre
los clones del cache el directorio no existe y el comando no puede detectar nada.

La Fase 2 entrega el **mecanismo y su demostración**, no el mecanismo operando.
Queda inerte hasta que la organización lo adopte. Para que "demostración" sea una
palabra con contenido, el mecanismo se ejerce contra un repo de fixture dentro de
este proyecto, con `.claude/standards/` poblado de verdad: ahí `sync` materializa,
`check` pasa, se introduce una edición local y `check` falla. Eso es lo que se
puede probar hoy, y es lo único que se afirma.

> Nota de coherencia: la regeneración de la matriz (5.4) **sí** corre en CI, pero
> en el repo propio. Esa restricción y esta no son la misma.

## 2.4 Criterios de aceptación — Fase 2

- [ ] `wazuh-ctx skills-diff` clasifica los 6 archivos × 3 repos sin excepción.
- [ ] Todo bloque divergente cae en común / override / CONFLICTO. Ninguno sin clasificar.
- [ ] Los conflictos conocidos aparecen listados: typecheck en `check-standards`,
      label `no-changelog`, `changelogs/fragments` de OSD, divergencia de `settings.json`.
- [ ] `core/` + `overrides/<repo>/` reconstruyen **byte-idénticos ≥ 15 de los 18**
      SKILL.md originales (6 skills × 3 repos).
- [ ] Los ≤ 3 restantes están listados en `lossy[]` con el diff exacto de lo que
      no se pudo reconstruir. `reconstruidos + lossy == 18` siempre.
- [ ] Un ancla de override que resuelve a cero o a más de una posición hace
      fallar el `sync`. Test con un ancla ambigua a propósito.
- [ ] Sobre el repo de fixture: `sync` materializa `.claude/standards/`, `check`
      pasa, se introduce una edición local y `check` falla. Los tres pasos en el
      mismo test.
- [ ] `wazuh-ctx check` contra un repo **sin** `.claude/standards/` reporta
      "no aplicable", no "todo en orden". Un blanco ausente no es un éxito.

---

# FASE 3 — MCP server

Tres recursos, un solo servidor. Mismo binario: `wazuh-ctx mcp`.

## 3.1 `docs` — documentación bajo demanda

**No hay crawler.** Wazuh ya publica contrato de ingesta en
`wazuh-documentation:5.0.0/source/llms.txt`:

> **Path transformation** For any HTML page, obtain the Markdown version by
> replacing `.html` with `.md`.
> **Availability guarantee** Every public HTML documentation page has a 1-to-1
> Markdown equivalent at the same path.
> **Canonical citation** Always cite the canonical HTML URL (`.html`).

Verificado contra `/5.0-beta/getting-started/components/index.md` → devuelve
markdown limpio.

Implementación: fetch de `<path>.md`, devolver la sección, citar el `.html`.

**Cuidado con el mapeo de versiones.** `/5.0-beta/llms.txt` devuelve 404, y
`llms.txt` lista como soportados `/current/`, `/5.0/`, `/4.14/`, `/3.13/` —
`5.0-beta` no aparece, aunque los `.md` responden igual. El mapeo rama de código
→ path de docs va **explícito en configuración**, nunca derivado.

Ese mapeo es prosa mantenida a mano —chica, pero prosa— así que cae bajo la misma
regla que el resto: **tiene dueño humano y fecha de última revisión en el propio
archivo de configuración.** Sin dueño es deriva en miniatura.

**`llms.txt` es una promesa, no una API.** La transformación de path es un
contrato publicado que nadie versiona y que puede romperse sin aviso. Un test
canario pega contra una página conocida y falla ruidosamente si la garantía
1-a-1 deja de cumplirse. Si el canario falla, `docs` se reporta no disponible en
lugar de devolver silencio o HTML crudo.

## 3.2 `schema` — offline, desde el dataset publicado

Sirve `matrix.json`, campos WCS e index templates desde `out/<ref>/`.
Sin red, sin cluster.

**Verificación de integridad al arrancar** (5.3): recalcula `payloadHash` y
rechaza arrancar si no coincide.

**Señal de obsolescencia — obligatoria.** Un dataset pinneado a `5.0.0` le
responde con total confianza a alguien parado en otra rama, y no hay nada en la
respuesta que lo delate. Eso es peor que no responder. Entonces:

- toda respuesta de `schema` incluye el `ref`, el `payloadHash` y `resolvedAt`;
- al arrancar, el servidor compara su `ref` contra la rama del working tree del
  consumidor. Si difieren, **rechaza** por defecto con un mensaje que nombra las
  dos refs, y solo responde si se pasa `--allow-ref-mismatch` de forma explícita;
- si `resolvedAt` supera 30 días, emite advertencia en cada respuesta;
- toda celda pisada por `decisions.local.yml` se marca con `overlay: "local"`.

## 3.3 `runtime` — opcional, degrada

Lo único que sí necesita una instancia viva:

- superficie del configuration service del dashboard: es un registry en runtime
  (`wazuh-core/common/services/configuration/configuration-provider.ts` y
  `configuration-store.ts`); cada plugin registra lo suyo al arrancar, no existe
  archivo estático con las claves. No se puede grepear;
- roles efectivos y permisos de cluster, que dependen del despliegue.

Si no hay instancia configurada, el recurso se reporta no disponible. **No
bloquea** `docs` ni `schema`.

## 3.4 Detección de mundo por `cwd`

Al arrancar, el servidor resuelve el repo del working tree y determina su mundo
desde el dataset. Antes de cualquier consulta, emite el contexto correspondiente:

```
cwd → wazuh-dashboard-security-analytics → world: upstream-fork
  "Fork upstream. context.wazuh_core no existe acá.
   Acceso al indexer vía dataSource. configPath: opensearch_security_analytics."
```

Previene exactamente el error del final de la sección 4, y cuesta una comparación
de path. Adapta qué se muestra, nunca qué es verdad.

## 3.5 Telemetría de huecos

Registro local de `(plugin, field, resolved: bool)` por consulta. Sin contenido
de las consultas. Alimenta el orden de `GET /api/unknowns` del inspector (5.5).

Opt-out con `--no-telemetry`. Nunca sale de la máquina sin acción explícita.

## 3.6 Criterios de aceptación — Fase 3

- [ ] `docs` recupera una página y la cita como `.html`.
- [ ] `docs` falla con mensaje claro ante un path de versión no mapeado.
- [ ] Test canario de `llms.txt`: si la garantía 1-a-1 se rompe, falla ruidoso.
- [ ] `schema` responde sin red con el dataset publicado.
- [ ] `schema` **no arranca** si `payloadHash` no valida. Test con un byte
      modificado a propósito.
- [ ] Toda respuesta de `schema` incluye `ref`, `payloadHash` y `resolvedAt`.
- [ ] `schema` rechaza cuando el `ref` del dataset ≠ rama del working tree, y
      responde con `--allow-ref-mismatch`. Ambos caminos testeados.
- [ ] Una celda pisada por `decisions.local.yml` llega marcada `overlay: "local"`.
- [ ] Un dataset con `resolvedAt` de hace 40 días emite advertencia.
- [ ] Estando en un fork upstream, el servidor anuncia el mundo antes de la
      primera consulta.
- [ ] `runtime` ausente no rompe los otros dos.

---

## 6. Estructura del repo

```
wazuh-context-kit/
  SPEC.md                  ← este archivo
  sources.yml
  decisions.yml            capa 2 — versionada, con review
  annotations.yml          capa 3 — aditiva, fricción baja
  decisions.local.yml      válvula de escape (gitignored)
  src/
    fetch/                 clone blobless + sparse + cache + ls-remote
    parse/                 manifiestos, package.json, templates, WCS
    matrix/                clasificación + crosscheck + render  ← PURO, sin I/O
    decisions/             carga, merge y reconciliación de capas 2 y 3
    skills/                diff a 3 bandas
    mcp/                   docs | schema | runtime
    cli.ts
  ui/                      inspector (Vite + React), Fase 1.5
  core/skills/<skill>/     SKILL.md común, extraído (Fase 2)
  overrides/<repo>/        <skill>.yml, parches anclados (Fase 2)
  fixtures/                manifiestos de prueba + repo fixture de standards
  proposals/               workflows de CI propuestos para wazuh/*, NO instalados
  .github/workflows/       regeneración diaria (5.4) — este SÍ se instala, acá
  out/<ref>/               matrix.json, MATRIX.md — COMMITEADOS
  .cache/                  clones (gitignored)
```

### 6.1 La costura: qué toca el mundo y qué no

Regla única — **hacia adentro nadie hace I/O**:

```
fetch/    → único que toca red y git. Salida: { dir, commit } por repo.
parse/    → único que toca el filesystem. Lee bytes, emite hechos crudos.
            CERO interpretación: no clasifica, no decide, no adivina.
matrix/   → función PURA. RawFacts[] → MatrixJson.
            Sin fs, sin red, sin Date.now(). El tiempo entra inyectado.
render/   → función PURA. MatrixJson → string.
```

`matrix/` es el dominio; `fetch/` y `parse/` son adaptadores de entrada,
`render/` de salida. Lo que esto compra, contra los criterios de 1.9:

- *"Segunda corrida sin red"* no es una feature que se implementa: es **imposible
  de romper** si `parse` no puede llamar a `fetch`.
- *"Dos corridas, idéntico payloadHash"* no necesita cache, ni git, ni red. Se le
  pasan los mismos `RawFacts` y se comparan bytes.
- *"Test que falla si un campo derivado se emite sin evidencia"* es un property
  test sobre una función pura, no un test de integración.

Si `matrix/` importa el reloj, la propiedad se pierde.

## 7. Orden de ejecución

```
1. src/matrix/ puro + fixtures     ← todo el pensamiento difícil (1.5) vive acá
2. wazuh-ctx serve (Fase 1.5)      ← inspector sobre los fixtures
3. src/parse/ + src/fetch/         ← lo aburrido, ya sabiendo la forma de los datos
4. Fase 2                          ← independiente de Fase 3
5. Fase 3                          ← depende del dataset de Fase 1
```

Se empieza por `matrix/` y no por `fetch/` aunque `fetch` sea el paso 1
cronológico. Toda la lógica de 1.5 se testea con fixtures de veinte líneas, sin
clonar nada. Arrancar por el fetch significa pelear con git y sparse-checkout
antes de escribir una línea de la lógica que importa.

## 8. Decisiones abiertas para Diego

1. ~~**`wazuh-dashboard-reporting` vs `wazuh-dashboards-reporting`**~~ —
   **RESUELTA (2026-09-15).** La pregunta estaba mal planteada: no son dos
   repositorios en disputa. `git ls-remote --heads` contra ambos devuelve el
   SHA idéntico `71b4b9e2d6252bec29468ca8ac4c4dd185f6c06a` en `5.0.0`, o sea
   que son espejos y la elección es cosmética. `sources.yml` mantiene la forma
   singular, que es la que usa el checkout de trabajo del mantenedor.
2. ~~**`wazuh/wazuh` en Fase 1**~~ — **RESUELTA (2026-09-15) por evidencia.**
   La recomendación era correcta y ahora está verificada contra el repositorio
   en lugar de asumida.

   En `origin/5.0.0`: **cero** rutas con forma `templates/states`, **cero**
   `fields.csv`, **cero** directorio `wcs/`. Los únicos JSON con
   `index_patterns` son 12 fixtures de test de QA bajo
   `src/shared_modules/indexer_connector/qa/test_data`. El único con contenido
   real duplica `wazuh-states-vulnerabilities`, que `wazuh-indexer-plugins` ya
   provee vía `plugins/setup/src/main/resources/templates/states/vulnerabilities.json`,
   y con mayor fidelidad. `wazuh-indexer-plugins` tiene además 17 templates de
   estado más y 28 módulos WCS que `wazuh/wazuh` no tiene en ninguna forma.

   Costo si se incorporara: **6.804 archivos / ~160 MB** contra **1.078 / ~13 MB**
   de `wazuh-indexer-plugins`. Seis veces más archivos por cero información nueva.

   **Queda fuera de Fase 1.** Pero hay un matiz que conviene no perder: el repo
   sí contiene superficie declarativa que no está en ningún otro lado y que
   ninguna versión previa de este ítem mencionaba —
   `api/api/spec/spec.yaml` (OpenAPI del Server API, ~9.700 líneas) y los YAML
   de RBAC por defecto en `framework/wazuh/rbac/default/` (`policies.yaml`,
   `roles.yaml`, `relationships.yaml`, `rules.yaml`, `users.yaml`). Nada de eso
   es índice ni WCS, así que no cambia esta decisión, pero es material directo
   para la página de `asCurrentUser` y para cualquier trabajo futuro sobre el
   RBAC del Mundo A. Si `wazuh/wazuh` entra alguna vez, entra por ahí, no por
   los templates.
3. ~~**`wazuh-indexer`**~~ — **RESUELTA (2026-09-15) por evidencia.** La premisa
   era incorrecta: el repositorio **no tiene rama `5.0.0`**, solo `main`
   (verificado contra el checkout local). Incluirlo hoy produciría únicamente
   una entrada en `skipped[]`. Queda fuera hasta que publique la rama.

   Nota relacionada: `wazuh-indexer-security-analytics` **sí** tiene rama
   `5.0.0` y fue incorporado a `sources.yml` el 2026-09-15 por decisión
   explícita del mantenedor, aun sabiendo que no contiene ninguno de los tres
   paths declarados para `kind: indexer` y que por lo tanto resuelve un SHA sin
   aportar hechos. Está documentado en `sources.yml` para que no se lea como
   defecto más adelante.
4. **`asScoped` vs `asInternalUser`** — no es derivable, es la decisión de RBAC más
   importante del contrato y hoy no está documentada en ningún lado. `asInternalUser`
   funciona en dev sin fallar y saltea el RBAC del usuario: compila, los tests pasan,
   y es un bug de seguridad. Es la única página de prosa que este proyecto no puede
   generar, y probablemente la de mayor retorno de todo lo anterior. Necesita autor
   humano y dueño.

   **Antes de escribirla hay que desambiguarla.** El par existe en dos APIs sin
   relación entre sí (ver la advertencia en la sección 4):

   - `core.opensearch.client.asScoped / asInternalUser` de OSD → RBAC del
     **indexer**. Aplica a los dos mundos, incluidos los forks upstream.
   - `wazuh-core` `api.client.asScoped / asInternalUser` → RBAC del
     **Wazuh Server API**. Aplica solo al Mundo A.

   Son dos decisiones distintas con dos modelos de permisos distintos y dos
   superficies de impacto distintas, y hoy comparten nombre. Una página que diga
   "usá `asScoped`" sin decir de cuál habla no arregla el problema: lo vuelve más
   difícil de ver.

   **ALCANCE DEFINIDO (2026-09-15).** La desambiguación pedida arriba se
   resolvió, y el resultado corrige la premisa: el peligro no está en `asScoped`
   contra `asInternalUser`, sino en que **ambos pares exponen el mismo nombre
   río abajo, `asCurrentUser`**.

   ```
   context.core.opensearch.client.asCurrentUser     → RBAC del indexer
   context.wazuh_core.api.client.asCurrentUser      → RBAC del Server API
   ```

   Evidencia recogida sobre los checkouts reales:

   - El `asScoped` de `wazuh-core` se invoca **una sola vez** en todo
     `wazuh-dashboard-plugins`, en `wazuh-core/server/plugin.ts:100`, y es
     cableado interno. Ningún consumidor lo llama; todos usan `asCurrentUser`.
     Una página sobre `asScoped` documentaría un método que casi nadie invoca.
   - Los dos pares conviven en el mismo archivo:
     `wazuh-ai-assistant/server/tools/executor.ts` usa el cliente del indexer en
     las líneas 231, 424 y 661, y el del Manager en la 850.
   - No hay ningún `TODO` ni `FIXME` cerca de ninguno de los dos pares. En
     cambio, `wazuh-ai-assistant/server/wazuh-core.d.ts:59-70` define tipos
     locales más angostos a mano en lugar de importar los reales, para poder
     explicar por qué `executor.ts` omite `token`. La confusión ya obligó a un
     rodeo silencioso, que es peor que una duda declarada.

   **La página cubre los dos pares**, organizada alrededor de la colisión de
   `asCurrentUser`, con `executor.ts` como caso testigo. Elegir uno solo
   documentaría media trampa.

   **BORRADOR ESCRITO (2026-09-15):** [`docs/as-current-user.md`](docs/as-current-user.md),
   redactado contra el código tal como estaba ese día. Vive en `docs/` por ahora;
   cuando Fase 2 exista, `.claude/standards/` es su lugar natural y a partir de
   ahí `wazuh-ctx sync` lo distribuye y `wazuh-ctx check` evita que derive.

   **Sigue sin dueño, y eso importa.** Lo que falta de una persona: (a) un dueño
   nombrado que la relea cuando cambie cualquiera de los dos clientes; (b) una
   revisión de la lista de usos legítimos de `asInternalUser`, que salió de leer
   call sites y no de una política que alguien haya acordado — algunos usos
   actuales podrían estar mal y la página hoy los trata como precedente. Una
   página exacta y sin dueño tiene vida corta.
5. ~~**Cadencia de regeneración**~~ — **RESUELTA (2026-09-15).**

   **Cadencia: cron diario con precheck por `ls-remote`**, como proponía 5.4. El
   workflow resuelve los 10 repos declarados y compara contra los
   `resolvedRefs` ya registrados en `out/5.0.0/matrix.json`. Si ningún SHA se
   movió, termina sin clonar nada — que es el punto del precheck, porque la
   mayoría de los días no se mueve nada. Un repo sin rama `5.0.0`
   (`wazuh-dashboard-ml-commons`) no cuenta como movimiento y no rompe el job.

   **Bus factor: auto-merge cuando CI queda verde.** El PR de regeneración se
   mergea solo si pasan tests, typecheck, build y el guard de frescura. El
   razonamiento: ese diff es generado y determinista, nadie lo revisa línea por
   línea, y tener a una sola persona como único camino de publicación es un
   riesgo mayor que el de un merge automático sobre contenido verificado.

   **Quedan dependencias humanas que ningún archivo puede resolver.**
   "Auto-merge si CI queda verde" exige: habilitar *Allow auto-merge*;
   protección de rama que **exija** el check de CI (sin eso, auto-merge mergea
   de inmediato y el gate no existe); permitir que Actions cree PRs; y un PAT
   fine-grained en el secreto `REGEN_PAT`.

   Ese último no es opcional ni cosmético, y se descubrió corriéndolo: **un PR
   abierto con `GITHUB_TOKEN` no dispara workflows.** El run se crea y queda
   retenido en `action_required`, así que el check requerido nunca reporta y el
   auto-merge espera para siempre algo que no puede llegar. El bypass de la app
   en la ruleset sería la otra salida, pero GitHub lo rechaza en repos de
   usuario: requiere una organización, y acá no hay. Todo documentado en
   `.github/workflows/README.md`.
