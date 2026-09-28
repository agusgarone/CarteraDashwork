/**
 * Montos, precios, cantidades, comisiones, impuestos, tipos de cambio
 * y valores de mercado persistidos.
 *
 * SQLite los guarda como TEXT para evitar errores de punto flotante.
 * El motor financiero los convertirá después con Decimal.js o equivalente.
 * No usar `number` para dinero persistido.
 */
export type DecimalString = string

/**
 * Identidad de dominio. La persistencia puede usar UUID o mapear
 * internamente los INTEGER AUTOINCREMENT de SQLite.
 * Los modelos de dominio no usan `number` como id.
 */
export type EntityId = string

/**
 * Las fechas persistidas son strings ISO, nunca objetos Date.
 * Día calendario: 2026-08-31. Timestamp: 2026-08-31T20:31:00Z.
 * Así se serializan igual entre SQLite, Rust/Tauri y TypeScript.
 */
