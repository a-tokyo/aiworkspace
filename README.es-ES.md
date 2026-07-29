# AI Workspace

Gestiona habilidades de agentes de IA, configuraciones y automatizaciones compartidas en espacios de trabajo multi-repo. Funciona con Cursor, Claude Code, Codex, Amp y más de 40 herramientas de codificación con IA.

<a href="https://npmjs.com/package/aiworkspace">
  <img src="https://img.shields.io/npm/v/aiworkspace.svg" alt="npm version" />
  <img src="https://img.shields.io/npm/dt/aiworkspace.svg" alt="npm downloads" />
</a>
<a href="https://twitter.com/intent/follow?screen_name=ahmedtokyo"><img src="https://img.shields.io/twitter/follow/ahmedtokyo.svg?label=Follow%20@ahmedtokyo" alt="Follow @ahmedtokyo" /></a>

<br />

**El problema**: Los agentes de IA solo ven el repositorio en el que se ejecutan. Un agente que trabaja en un repo de frontend no tiene visibilidad del backend, los contratos de la API o las convenciones compartidas, por lo que asume y alucina. Además, cada desarrollador configura las herramientas de IA de manera diferente, por lo que las habilidades, instrucciones, reglas y servidores MCP difieren entre proyectos y miembros del equipo.

**La solución**: Un único repositorio `workspace/` que actúa como la fuente canónica. Ejecutar `npm install` replica las configuraciones en la raíz del padre, crea enlaces simbólicos (symlinks) para las habilidades y servidores MCP para cada herramienta de IA, e instala hooks de git para mantener todo sincronizado.

## Inicio Rápido

**Crear un nuevo workspace** (una sola vez, por quien lo configure):

```bash
mkdir ~/dev/<your-org> && cd ~/dev/<your-org>
npx aiworkspace init
cd workspace
git remote add origin <your-repo-url>
git push -u origin main
```

**Unirse a un workspace existente** (todos los demás miembros del equipo):

```bash
cd ~/dev/<your-org>
git clone <your-teams-workspace-repo> workspace
cd workspace && npm install
```

`npm install` restaura las habilidades desde el lockfile, replica las configuraciones en la raíz del padre, crea los symlinks de las habilidades e instala los hooks de git. Consulta [setup.md](setup.md) para la guía completa, incluyendo los [secretos de MCP](setup.md#41-mcp-secrets) (`cp .env.example .env.local`, reiniciar editor).

## Cómo Funciona

```
~/dev/<your-org>/                       <- abre esto en Cursor / tu editor
├── workspace/                          <- este repo
│   ├── root-config/                    <- fuente canónica para configs de IA a nivel de raíz
│   │   ├── AGENTS.md                   <- instrucciones permanentes para todas las herramientas de IA
│   │   ├── .agents/mcp.json            <- servidores MCP canónicos (fuente única de verdad)
│   │   ├── .agents/skills/             <- habilidades globales del workspace
│   │   ├── .mcp.json, .cursor/, .codex/, .vscode/   <- configs por editor (symlinked o generadas)
│   │   ├── .env.example                <- plantilla para secretos de MCP (-> .env.local en la raíz)
│   │   └── skills-lock.json            <- lockfile para habilidades globales del workspace
│   ├── .agents/skills/                 <- habilidades específicas del proyecto workspace
│   ├── scripts/                        <- automatización (setup, hooks, wrappers de habilidades)
│   └── package.json
├── <project-a>/                        <- tu app / servicio / librería
├── <project-b>/
└── ...
```

El script de configuración recorre `root-config/` de forma genérica. Añade nuevos tipos de configuración (reglas de Cursor, ajustes de Claude, config de Codex) y se sincronizarán automáticamente sin cambios en el script.

## Jerarquía de Conocimiento

Todo sigue la regla de **gana el más cercano**: cuanto más cerca esté un archivo del código que se está modificando, mayor será su prioridad.

| Elemento | Global del Workspace | Por proyecto |
|------|---------------|-------------|
| Instrucciones | `root-config/AGENTS.md` sincronizado a la raíz | `<project>/AGENTS.md` |
| Habilidades | `root-config/.agents/skills/` symlinked en todas partes | `<project>/.agents/skills/` |
| Reglas de Cursor | `root-config/.cursor/rules/` symlinked | `<project>/.cursor/rules/` |
| Ajustes de Cursor | `root-config/.cursor/settings.json` symlinked | — |
| Servidores MCP | `root-config/.agents/mcp.json` sincronizado a la raíz | `<project>/.cursor/mcp.json` |
| Documentación | repo `docs/` (hermano) | `<project>/docs/` |

## Habilidades (Skills)

```bash
npm run skills:add -- <source> [--project <repo>]      # añadir desde el registro
npm run skills:add -- owner/repo --skill <name>         # elegir de un repo multi-skill
npm run skills:remove -- [<skill>] [--project <repo>]   # eliminar
npm run skills:create -- --name my-skill                # crear manualmente
npm run skills:list                                      # listar instaladas
npm run skills:find                                      # buscar en el registro de habilidades
npm run skills:update                                    # actualizar todas
npm run skills:check                                     # verificar actualizaciones disponibles
npm run skills:setup                                     # re-sincronizar configs y symlinks
```

Sin `--project`, las habilidades se instalan en `root-config/.agents/skills/` (global del workspace). Con `--project <repo>`, van a `<repo>/.agents/skills/` (solo proyecto).

Las habilidades se rastrean en `skills-lock.json` (fuente + hash). Al ejecutar `npm install`, se restauran automáticamente desde el lockfile.

## MCP

Los servidores MCP otorgan herramientas compartidas a los agentes. Defínelos una vez en `root-config/.agents/mcp.json` y cada editor los reconocerá, sin necesidad de configuración individual por desarrollador. [context7](https://github.com/upstash/context7) (documentación actualizada de librerías) viene incluido.

| Archivo | Editor | Método |
|------|--------|-----|
| `.agents/mcp.json` | — | canónico, edita este |
| `.mcp.json` | Claude Code | symlink |
| `.cursor/mcp.json` | Cursor | generado en la sincronización |
| `.vscode/mcp.json` | VS Code / Copilot | generado en la sincronización |
| `.codex/config.toml` | Codex | generado en la sincronización |

Para añadir o cambiar un servidor, edita `.agents/mcp.json` y luego regenera los archivos espejo y symlinks:

```bash
npm run sync
```

La sincronización actualiza los servidores incluidos desde la plantilla de aiworkspace y preserva cualquier servidor que hayas añadido. Las ediciones locales en un servidor *incluido* serán sobrescritas en la siguiente sincronización; para anular uno en un solo repo, usa `<project>/.cursor/mcp.json` (gana el más cercano).

Para eliminar completamente un servidor incluido, lístalo en `root-config/.agents/mcp-disabled.json` (`{ "disabled": ["context7"] }`); borrarlo solo de `.agents/mcp.json` no funcionará, ya que la sincronización restaura los servidores incluidos desde la plantilla.

**Secretos.** Los servidores que necesiten tokens los leen de `.env.local` en la raíz del workspace padre:

```bash
cp .env.example .env.local     # luego rellena los tokens y reinicia tu editor
npm run mcp:check-secrets      # verifica que los tokens estén presentes
```

Los servidores Stdio que utilizan `${VAR}` se envuelven automáticamente para cargar `.env.local`. Consulta [setup.md §4.1](setup.md#41-mcp-secrets) para servidores HTTP Bearer en Cursor y OAuth sign-in para Codex.

**Nomenclatura de variables de entorno.** Si cargas `.env.local` en tu shell (vía `npm run mcp:install-shell` o un `source` manual en `~/.zshrc`), esas claves pasan a formar parte de tu entorno de inicio de sesión. Se recomienda usar un prefijo específico del workspace en los nombres de los secretos en `.env.example` y `mcp.json` (ej. `ACME_SONAR_TOKEN` en lugar de `SONAR_TOKEN`) para evitar colisiones con otras herramientas o proyectos. Los secretos exclusivos de Stdio que permanecen dentro del cargador de entorno de MCP están menos expuestos, pero un prefijo consistente mantiene alineadas las configuraciones Bearer y stdio. Para evitar por completo el perfil de inicio de sesión, consulta [setup.md §4.1](setup.md#41-mcp-secrets) (lanzamiento desde terminal).

## Actualización

**Actualización de plantilla** — descarga los `scripts/` gestionados más recientes cuando se publique una nueva versión de aiworkspace:

```bash
npm run upgrade
```

**Sincronización de config** — después de editar `root-config/` (especialmente `.agents/mcp.json`), regenera los espejos de MCP y los symlinks de la raíz padre sin actualizar la plantilla:

```bash
npm run sync
```

Si `aiworkspace` está en `devDependencies`, `upgrade` actualiza ese paquete desde npm y copia sus `scripts/` en los tuyos (el campo `version` de tu equipo permanece independiente). De lo contrario, el workspace recurre a git: remoto `upstream` + `upstream/main` para los `scripts/`. `upgrade` ejecuta `sync` automáticamente. `npx aiworkspace init` configura `upstream` automáticamente. Consulta [setup.md](setup.md) para más detalles.

## Requisitos

- Node.js >= 18
- Git

## Recursos Relacionados

[agent-skills](https://github.com/a-tokyo/agent-skills) es una colección complementaria de habilidades reutilizables para agentes; explóralas en [skills.sh](https://www.skills.sh/a-tokyo/agent-skills). Instala cualquiera de ellas con el flujo de trabajo `skills:add` documentado arriba.

| Habilidad | Qué hace |
|-------|-------------|
| [production-grade](https://skills.sh/a-tokyo/agent-skills/production-grade) | Postura de ingeniería para trabajo no trivial: planificar antes de codificar, la solución correcta más simple primero, patrones de endurecimiento para producción. |
| [tribunal](https://skills.sh/a-tokyo/agent-skills/tribunal) | Flujo de Ejecutor → panel de verificador → bucle de consenso para validar entregables antes del envío. |

Más habilidades en la colección; consulta el [catálogo completo](https://github.com/a-tokyo/agent-skills#skills).

```bash
npm run skills:add -- a-tokyo/agent-skills --skill production-grade
```

## Licencia

Apache-2.0
