import type { CurrencyCode } from '../domain/currency'

export interface FundDenominationAlias {
  registryIdentity: string
  canonicalName: string
  denominations: readonly string[]
  currency: CurrencyCode
  brokerCodes: Readonly<Record<string, readonly string[]>>
  provenance: {
    registryUrl: string
    registryRecord: string
    documentIds: readonly string[]
    issuerUrl: string
  }
}

/** Audited denomination metadata. Publication dates do not establish effective dates. */
export const FUND_DENOMINATION_ALIASES: readonly FundDenominationAlias[] = [
  {
    registryIdentity: 'CNV:81959',
    canonicalName: 'BALANZ LECAPS',
    denominations: ['BALANZ PERFORMANCE II', 'BALANZ LECAPS'],
    currency: 'ARS',
    brokerCodes: { A: ['PER2 A', 'LECAPSA'] },
    provenance: {
      registryUrl:
        'https://www.cnv.gov.ar/SitioWeb/FondosComunesInversion/DetallesFCI/81959?denominacion=Balanz+Performance+Ii&estado=Aprobado+Lanzado',
      registryRecord: '81959',
      documentIds: ['3491629', '3249577'],
      issuerUrl: 'https://balanz.com/inversiones/fondos/lecaps/',
    },
  },
]

export interface FundDenominationResolution {
  canonicalIdentity: string
  canonicalName: string
  rawName: string
  shareClass: string
  currency: CurrencyCode
  reason: 'KNOWN_FUND_DENOMINATION_ALIAS'
  brokerCodes: readonly string[]
  provenance: FundDenominationAlias['provenance']
}

function denominationName(name: string, shareClass: string): string {
  const suffix = name.trim().match(/^(.*?)\s+(?:clase\s+)?([A-Za-z0-9]+)$/i)
  const unqualified =
    suffix?.[2]?.toUpperCase() === shareClass.toUpperCase() ? suffix[1]! : name
  return unqualified
    .replace(/\s+-\s*$/, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function resolveFundDenomination(
  name: string,
  shareClass: string | null,
  currency: CurrencyCode,
): FundDenominationResolution | null {
  if (!shareClass || !/^[A-Za-z0-9]+$/.test(shareClass)) return null
  const normalizedClass = shareClass.toUpperCase()
  const normalizedName = denominationName(name, normalizedClass)
  const alias = FUND_DENOMINATION_ALIASES.find(
    (row) =>
      row.currency === currency &&
      row.denominations.some(
        (denomination) =>
          denominationName(denomination, normalizedClass) === normalizedName,
      ),
  )
  if (!alias) return null
  return {
    canonicalIdentity: `${alias.registryIdentity}|${normalizedClass}|${currency}`,
    canonicalName: alias.canonicalName,
    rawName: name,
    shareClass: normalizedClass,
    currency,
    reason: 'KNOWN_FUND_DENOMINATION_ALIAS',
    brokerCodes: alias.brokerCodes[normalizedClass] ?? [],
    provenance: alias.provenance,
  }
}

export function hasKnownFundDenomination(
  name: string,
  shareClass: string | null,
): boolean {
  return FUND_DENOMINATION_ALIASES.some(
    (alias) =>
      resolveFundDenomination(name, shareClass, alias.currency) !== null,
  )
}

/** Normalize only explicit, audited fund codes. The raw document retains its code. */
export function canonicalFundBrokerCode(code: string): string {
  for (const alias of FUND_DENOMINATION_ALIASES) {
    const codes = Object.values(alias.brokerCodes).find((values) =>
      values.includes(code),
    )
    if (codes?.[0]) return codes[0]
  }
  return code
}
