# Análisis por rangos: implementación y validación

Estado: GREEN LIGHT PARA PRUEBA MANUAL DE RANGOS.

## Arquitectura y selección

`RangeAnalysisService` compone las primitivas existentes de flujos externos, resultado residual y Modified Dietz. No lee ni suma los resultados mensuales almacenados. `AnalysisRange` contiene `startPeriodId` y `endPeriodId`; `resolveAnalysisRange` resuelve los meses incluidos por calendario.

`AnalysisRangeProvider` conserva únicamente el modo y el inicio personalizado. El final proviene de `ImportedPeriodProvider`, el mismo período seleccionado que ya utilizan Home, Detail y la moneda de presentación. Los rangos y sus extremos se derivan, sin otro estado de final independiente. Las consultas tienen cancelación lógica y una clave por extremos/revisión para evitar publicar respuestas anteriores.

| Modo | Inicio, respecto al mes final |
| --- | --- |
| 1M | El mismo mes |
| 3M | Dos meses antes |
| 6M | Cinco meses antes |
| 12M | Once meses antes |
| YTD | Enero del año del mes final |
| Personalizado | Mes importado elegido por el usuario |

Solo participan períodos COMPLETE. El resolver recorre cada mes calendario y devuelve `INCOMPLETE_RANGE`, con la lista YYYY-MM de meses faltantes. No trunca rangos ni estima períodos. Con agosto de 2026 y enero–agosto importados, 12M queda deshabilitado; faltan septiembre–diciembre de 2025. YTD sí está disponible con sus ocho meses.

Al cambiar el final, los presets se recalculan. Personalizado conserva el inicio; si el nuevo final lo deja después del cierre, se muestra un rango inválido y no sus KPIs. Los selectores personalizados impiden elegir inicio posterior al final. Un personalizado de un solo mes conserva la presentación mensual y fue contrastado contra el motor mensual.

## Snapshots, flujos y fórmulas

`resolvePeriodSnapshots` comparte la resolución canónica de fronteras con el servicio mensual. El esquema actual no tiene un `opening_snapshot_id`: la relación mensual existente resuelve la apertura mediante `getLatestBefore(portfolioId, periodStartDate)` y el cierre mediante `getLatestByPeriod`. Se extrajo esa misma lógica sin modificar su comportamiento ni agregar schema. El servicio de rango toma la apertura del primer período resuelto, nunca consulta independientemente el cierre de un período anterior.

Se valida la continuidad por identidad de snapshots: el cierre anterior debe ser la apertura siguiente. El rango usa solamente sus dos extremos para calcular el resultado. Los snapshots intermedios sirven como puntos del gráfico; no se duplican ni entran como sumandos en el cálculo financiero.

Las transacciones se consultan por los períodos incluidos y se deduplican por ID persistido. Se validan pertenencia, fechas reales y moneda de flujos externos. `aggregateExternalFlows` conserva aportes, retiros y flujo neto. Compras y ventas no son flujos externos.

```text
investmentResult = closingValue - openingValue - contributions + withdrawals
```

Todos los importes permanecen como strings Decimal. Se reutilizan `aggregateExternalFlows`, `calculateExpectedInvestmentResult` y `calculateModifiedDietz`; no se implementó otra fórmula.

Modified Dietz se recalcula para toda la ventana con todos los flujos fechados. Usa la convención mensual existente: fechas reales de snapshots, días civiles calculados en UTC y peso `(cierre - fecha del flujo) / (cierre - apertura)`. Un flujo en la apertura pesa 1 y uno en el cierre pesa 0. El rendimiento no está anualizado. No se suman, promedian ni encadenan rendimientos mensuales.

## Resultados con los documentos reales

Base temporal en memoria, importación cronológica enero–agosto con XLSX y reimportación idempotente. Los siguientes resultados se calcularon desde los snapshots y las transacciones de esa base.

| Rango | Apertura ARS | Cierre ARS | Aportes ARS | Retiros ARS | Resultado ARS | Dietz |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Julio–Agosto | 23.007.361,00 | 26.383.988,00 | 3.050.000,00 | 1.000.000,00 | 1.326.627,00 | 5,28% |
| 3M: Junio–Agosto | 19.944.282,00 | 26.383.988,00 | 4.350.000,00 | 1.000.000,00 | 3.089.706,00 | 13,70% |
| 6M: Marzo–Agosto | 15.906.241,00 | 26.383.988,00 | 7.900.000,00 | 1.000.000,00 | 3.577.747,00 | 18,04% |
| YTD: Enero–Agosto | 16.217.347,00 | 26.383.988,00 | 8.550.000,00 | 1.000.000,00 | 2.616.641,00 | 13,25% |
| Personalizado: Julio–Julio | 23.007.361,00 | 25.954.029,00 | 1.800.000,00 | 0,00 | 1.146.668,00 | 4,64% |

| Rango | Apertura real | Cierre real | Días |
| --- | --- | --- | ---: |
| Julio–Agosto | 2026-06-30 | 2026-08-31 | 62 |
| 3M | 2026-05-29 | 2026-08-31 | 94 |
| 6M | 2026-02-27 | 2026-08-31 | 185 |
| YTD | 2025-12-30 | 2026-08-31 | 244 |
| Julio–Julio | 2026-06-30 | 2026-07-31 | 31 |

Julio–agosto usa los flujos reales del 02/07 (+1.800.000), 03/08 (+1.250.000) y 18/08 (-1.000.000). Su retorno decimal es `0.0528449591978350730293706361`, recalculado con esas fechas y comprobado distinto de la suma de los retornos mensuales.

El reporte completo reproducible se genera en `src/parsers/balanz/fixtures/private/validation-ranges-report.json`, ignorado por Git. Incluye fechas, flujos, pesos, capital ponderado, universo de instrumentos y referencia USD. No se modificó la base real de la aplicación; se verificó que analizar rangos no produce escrituras en la base temporal.

## Home, USD y gráfico

Home presenta los seis controles de rango, extremos reales y duración, patrimonio inicial/final, aportes, retiros, flujo neto, resultado de inversiones y Modified Dietz. Un rango incompleto muestra los meses faltantes sin valores financieros. La vista mensual conserva sus cálculos y componentes.

Se reutiliza el proveedor ARS/USD existente: su período seleccionado es el final del rango. Para todos los rangos terminados en agosto, todos los montos y puntos del gráfico usan `amountARS / 1534.51`. El personalizado Julio–Julio usa `1518.19`. La API `getPeriodUsdMepReference` y las reglas de conversión no se modificaron. Si falta la referencia final, se conserva el fallback a ARS, USD deshabilitado y la explicación global; no se busca el rate de un mes anterior.

El gráfico reutiliza `PortfolioEvolutionChart`: un cierre real por período incluido. Ejes y tooltip respetan la moneda global; el tooltip muestra mes y patrimonio. Los puntos son únicamente visualización. Solo las coordenadas que exige Recharts se convierten a Number, después de convertir el importe con Decimal.

## Atribución y Detail: fase C pendiente

La atribución de rangos se marca explícitamente `PENDING`. El resultado global no depende de ella. El universo incluye posiciones iniciales/finales, todas las transacciones y corporate actions, conservando IDs originales y sin crear posiciones. Incluye indicadores de presencia en extremos, operaciones, acciones corporativas y ciclo completo de compra/venta. AL30 real está incluido como ciclo completo sin posición en ninguno de los extremos.

Se inspeccionó `performanceAnalysisService`: hoy su entrada es un único período y reúne por ese período transacciones, cash legs, enriquecimiento FX e identidad económica antes de reconciliar posiciones/caja. Extenderlo requiere reunir y validar esas fuentes para toda la ventana, especialmente cambios de ticker, corporate actions y FX transaccional. No quedó demostrada la aditividad general de sus componentes mensuales bajo esas condiciones, por lo que no se suman resultados explicados ni se propone aún una suma como atribución válida.

Detail continúa siendo mensual del período final y muestra un aviso cuando hay un rango de varios meses activo. El resultado detallado por instrumento del rango queda para la fase C, con adaptación y pruebas propias del motor.

## Verificación

146 tests distintos aprobados en 18 archivos, ejecutados secuencialmente con `--maxWorkers=1 --no-file-parallelism`:

- 17 tests nuevos del resolver/servicio: presets, huecos, personalizado, cambio de final, resultado global, flujos fechados, no sumar porcentajes, equivalencia mensual, precisión Decimal, deduplicación, universo sin posiciones, cadena de snapshots y operaciones fuera de ventana.
- 6 tests nuevos de pantalla: ARS/USD, referencia final pendiente, rango incompleto con controles, 12M deshabilitado/YTD disponible y selectores personalizados.
- 23 tests reales enero–agosto existentes, extendiendo el recorrido cronológico con los cinco rangos reales, sus flujos, referencias, AL30 y comprobación de solo lectura.
- 44 tests de presentación ARS/USD, Home/Detail, selección mensual y formateo.
- 56 regresiones de referencia MEP, identidad, resolución de instrumentos, parsers, enriquecimiento XLSX, fechas de snapshots y motor julio/agosto.

También pasaron TypeScript de `tsconfig.app.json` y `tsconfig.node.json`, y `git diff --check`. No se ejecutaron builds pesados ni watchers. La prueba visual interactiva en Tauri queda a cargo de la siguiente prueba manual; los tests de pantalla usan renderizado estático.

Los resultados mensuales enero–agosto no cambiaron: 164.993; -1.126.099; 163.716; 1.128.257; -803.932; 1.763.079; 1.146.668; 179.959 ARS, respectivamente. Parsers, PERIOD_RESULTS, identidad BITF/KEEL, FX transaccional, importación, schema/migrations y backup/restore permanecen sin cambios de implementación.

## Archivos

Nuevos:

- `src/analysis/analysisRange.ts`
- `src/analysis/rangeAnalysisService.ts`
- `src/analysis/AnalysisRangeProvider.tsx`
- `src/analysis/rangeAnalysisService.test.ts`
- `src/analysis/rangeScreens.test.ts`
- `src/engine/services/periodSnapshots.ts`
- `src/components/period/AnalysisRangeSelector.tsx`
- `src/components/dashboard/RangeDashboard.tsx`
- `src/import/validateRealRanges.ts` (helper exclusivo del test real)
- `docs/analysis-ranges.md`

Modificados:

- `src/App.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/DetailPage.tsx`
- `src/components/period/HomePeriodSelector.tsx`
- `src/engine/services/periodAnalysisService.ts` (extracción de resolución de snapshots, mismas fórmulas)
- `src/import/monthlyPeriodResults.real.integration.test.ts` (invoca la validación de rangos)

## Prueba manual sugerida

1. Abrir la app existente y seleccionar agosto de 2026.
2. Comparar 3M, 6M y YTD con la tabla; comprobar 12M deshabilitado.
3. Elegir personalizado Julio–Agosto y luego Julio–Julio; comparar con 1M de julio.
4. Cambiar ARS/USD y comprobar la referencia del cierre final, incluidos tooltip y ejes.
5. Con 3M activo, cambiar agosto por julio: debe pasar de Junio–Agosto a Mayo–Julio.
6. Entrar en Detail con un rango activo: debe indicar que muestra solamente el mes final.

GREEN LIGHT PARA PRUEBA MANUAL DE RANGOS.
