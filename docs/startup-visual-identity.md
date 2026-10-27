# Identidad visual y splash nativa

Estado: GREEN LIGHT PARA PRUEBA MANUAL DE SPLASH.

## 1. Arranque anterior

`tauri.conf.json` definía una ventana principal visible de 800×600. El `setup` Rust ejecutaba sincrónicamente `bootstrap`: resolución de rutas, apertura SQLite, migraciones existentes y health check. React importaba `App` directamente; `PortfolioOverviewProvider` cargaba el primer estado de Home después del montaje.

`getDatabase` en TypeScript es un cliente IPC perezoso; la apertura real de SQLite y las migraciones pertenecen al backend Rust. No se encontró otra configuración crítica que deba cargarse antes de Home. El encabezado usaba una letra P y el nombre Portfolio; el favicon y los iconos nativos eran los anteriores.

## 2. Estrategia elegida

Dos ventanas Tauri: `splash` visible y `main` oculta. La splash es un documento HTML independiente de React, con fondo oscuro y un solo asset compartido. Se usa el patrón de ventanas separadas de la [documentación oficial de Tauri](https://v2.tauri.app/learn/splashscreen/).

El mismo bootstrap existente corre en una tarea de bloqueo separada, liberando el event loop para que la splash pueda mostrarse. Su cuerpo, consultas, schema, migraciones y manejo de la base no cambiaron. La aplicación React se importa y monta solamente después de recibir la finalización de ese bootstrap.

La splash usa la API global oficial de Tauri para recibir READY y solicitar la presentación de main. Tiene una capability propia limitada a escuchar/desuscribirse de eventos; no recibe permisos de archivos o DB. Los comandos de startup validan la etiqueta de ventana llamante.

## 3. Punto exacto READY

Se solicita la presentación después de:

1. Inicialización de Tauri y creación de ambas ventanas.
2. Finalización del bootstrap nativo existente: rutas, apertura SQLite, migraciones y verificación inicial de la base.
3. Carga del módulo principal React.
4. Commit de React del primer estado estable de `PortfolioOverviewProvider`: `ready`, `empty` o `error`.

`StartupReadySignal` detecta ese estado mediante un efecto posterior al commit. Se permite READY con error para mostrar el problema actual en main. Una excepción de carga/render tiene su propio fallback visible y también libera la splash.

No se espera la consulta USD MEP ni tareas secundarias posteriores al primer estado de Home. No se modificaron los criterios ni cálculos financieros de Home.

## 4. Diseño y transiciones

Fondo `#101216`, isotipo central, texto ANALISIS CARTERA y Preparando tu cartera... No hay barras ni porcentajes ficticios.

El logo entra en 400 ms con opacity 0→1 y scale 0.96→1. Al recibir READY se hace un fade de salida de 120 ms. No se espera a que termine la entrada ni se impone un tiempo mínimo de splash. `prefers-reduced-motion` elimina ambas animaciones.

Hay un cierre nativo de respaldo a los 180 ms de READY, por si el listener o la animación de la splash falla. La ventana principal permanece oculta hasta la transición. Fondos nativos y HTML inicial oscuro evitan que un WebView vacío pinte blanco; el tema existente de la aplicación no se cambia.

El backend conserva una fase de presentación y no repite `show`, foco ni cierre ante avisos duplicados. Si falla el cierre de la splash, el reintento no vuelve a mostrar main. El cierre del proceso se coordina también si se cierra main o se abandona la splash antes de que main sea visible, evitando una ventana oculta residual.

## 5. Assets e iconos

Fuente visual única: `src/assets/isotipo-MAG.png`, aportado por el usuario. El archivo original no se redibujó, recortó, recoloreó ni sobrescribió. Es PNG RGBA de 1254×1254; alpha de esquina 0.

SHA256 original y después de generar iconos:

```text
46393583EA69124734C4EE13C9B723A700CBF1C093E048E77ADAB4C7AF670C55
```

El encabezado, favicon, splash y fallback de startup referencian el mismo PNG fuente. El build Vite genera una sola copia con hash en `dist/assets`, reutilizada por ambas páginas.

Se utilizó la CLI oficial ya instalada:

```text
node node_modules/@tauri-apps/cli/tauri.js icon src/assets/isotipo-MAG.png --output <directorio-temporal>
```

Se copiaron únicamente los archivos de escritorio generados a `src-tauri/icons`; no se agregaron los conjuntos móviles innecesarios.

Variantes de escritorio: PNG 32, 64, 128 y 256 (`128x128@2x`), `icon.png`, `icon.ico` con seis tamaños internos, `icon.icns`, `StoreLogo.png` y las nueve variantes `Square*Logo.png` de Windows. Son 17 archivos de iconos de escritorio.

El bundle conserva sus rutas oficiales a PNG/ICO/ICNS. El ICO actualiza el recurso de ejecutable de Windows y el icono nativo por defecto. También se configuraron explícitamente `bundle.windows.nsis.installerIcon` y `uninstallerIcon`. MSI sigue usando el icono de aplicación del bundle. No cambió el identifier `com.analisiscartera.app` ni las rutas de datos de la app.

## 6. Desarrollo

`npm run tauri dev` crea las dos ventanas. La splash se carga desde `splash.html` servido por Vite; no necesita montar React ni importar sus módulos. El handshake no depende de sleeps para adivinar cuándo Vite o Home terminaron.

El dev server se prepara mediante el mecanismo existente de Tauri `beforeDevCommand`/`devUrl`. Tras un reload/HMR de main, el estado nativo sigue disponible y no se recrea la splash ni se repite la presentación de main. Home vuelve a cargar de la forma habitual.

Los cambios Rust y de configuración requieren reiniciar el proceso Tauri para probarlos; recargar únicamente Vite no reemplaza el binario nativo.

## 7. Producción

Vite tiene dos entradas: `index.html` y `splash.html`. El build comprobado incluye ambas páginas y el asset de marca compartido; no depende de URLs de Vite dentro del paquete. Los mismos comandos y estados nativos coordinan la presentación en producción.

Se verificaron el build frontend de producción y la compilación/pruebas del backend. No se generó ni instaló un MSI/NSIS de distribución ni se ejecutó una inspección visual interactiva de las ventanas desde esta sesión. Esa observación se realiza en la prueba manual siguiente.

## 8. Errores

- Si SQLite o el health check fallan, se conserva `AppState::failed`; React puede mostrar el error existente de Home y el health banner en main. No se reemplaza una base dañada.
- Si falla la resolución de rutas o la tarea de bootstrap entra en pánico, se resuelve el handshake como error y se muestra el fallback de startup.
- Si falla la importación del módulo principal o el render React, se muestra una pantalla entendible con Reintentar.
- Si falla la presentación de main desde la splash, se cancela el fade para que el error y el botón de recuperación sigan visibles.
- Si no llega READY durante 45 segundos, aparece un aviso de inicio demorado y Abrir aplicación. Este aviso no declara READY, no cancela SQLite ni oculta un error: permite revisar el estado de main. No se utiliza ese temporizador como requisito para un arranque normal.

## 9. Validación y límites

Pruebas automatizadas:

- Cinco tests del puente TypeScript: espera del backend, propagación de error, coalescencia de StrictMode, reintento ante fallo IPC y modo navegador sin llamadas nativas.
- Dos tests del script real de splash en un DOM simulado: orden READY→fade→main y recuperación visible ante error.
- Cinco tests Rust de coordinación: backend pendiente/error, estado retenido para reload, presentación/cierre únicos y reintentos de show/close.
- Dos tests Rust del bootstrap real en directorios temporales: apertura SQLite con las cinco migraciones existentes y archivo corrupto preservado con error explícito.
- Ocho tests existentes de pantallas ARS/USD como regresión del montaje de UI.

Total: 22 tests aprobados. Las pruebas Rust se ejecutaron con un solo hilo; Vitest con `--maxWorkers=1 --no-file-parallelism`.

También: `npm.cmd run build` (TypeScript y Vite), revisión estática de los archivos de startup, integridad del PNG original, estructura del ICO, una sola copia de marca en dist y `git diff --check`.

Las pruebas de coordinación simulan las operaciones show/close; no son una captura de la GUI real. El parpadeo, el foco, la taskbar y los iconos de instalador requieren observación manual en Windows. Los warnings de tamaño de chunks del build no bloquean la compilación y no se modificó el empaquetado de librerías financieras para resolverlos.

## 10. Archivos modificados

- `src/assets/isotipo-MAG.png` (asset del usuario incorporado al proyecto).
- `src-tauri/icons/*` (variantes oficiales regeneradas, incluido nuevo 64×64).
- `src-tauri/tauri.conf.json` (ventanas, fondos, API global, iconos NSIS).
- `src-tauri/capabilities/splash.json` (permisos mínimos de eventos).
- `src-tauri/src/startup.rs` (coordinación nativa, recuperación y tests).
- `src-tauri/src/lib.rs` (registro de startup, bootstrap en tarea, ciclo de vida y tests aislados).
- `src/startup/startupBridge.ts` y su test.
- `src/startup/StartupReadySignal.tsx`.
- `src/startup/StartupErrorBoundary.tsx`.
- `src/startup/splash.test.ts`.
- `src/main.tsx` y `src/App.tsx` (espera inicial y señal READY).
- `src/components/layout/AppShell.tsx` (isotipo y nombre).
- `index.html`, `splash.html` y `vite.config.ts` (favicon, fondo inicial y dos entradas).
- `docs/startup-visual-identity.md` (este informe).

Sin modificaciones de implementación en parsers, schema, migraciones, motor financiero, performance, rangos, ARS/USD, importaciones o backups. Tampoco se cambiaron dependencias ni identifier.

## Prueba manual

1. Cerrar y volver a ejecutar `npm run tauri dev`.
2. Comprobar splash oscura, isotipo y transición a Home completo o error explícito; main no debe verse detrás durante la carga.
3. Recargar main en desarrollo: no debe abrirse otra splash ni otra ventana principal.
4. Cerrar main: no debe quedar un proceso con ventana oculta; si se abandona la splash antes de READY, tampoco.
5. Verificar logo del encabezado, icono de ventana y taskbar.
6. Probar el paquete generado con `npm run tauri build` para revisar también ejecutable e instalador. No alterar la base real para simular corrupción; ese caso ya se comprobó en archivos temporales aislados.

GREEN LIGHT PARA PRUEBA MANUAL DE SPLASH.
