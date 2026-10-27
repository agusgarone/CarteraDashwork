export interface InstrumentIdentityTransition {
  kind: 'KNOWN_INSTRUMENT_IDENTITY_TRANSITION'
  fromTicker: string
  toTicker: string
  effectiveDate: string
  /** Units of the successor security per unit of the predecessor. */
  ratio: string
  source: string
  comment: string
}

/** Reviewed security-master metadata. Imports never fetch this information online. */
export const instrumentIdentityTransitions: readonly InstrumentIdentityTransition[] = [{
  kind: 'KNOWN_INSTRUMENT_IDENTITY_TRANSITION',
  fromTicker: 'BITF', toTicker: 'KEEL', effectiveDate: '2026-04-06', ratio: '1',
  source: 'https://investor.bitfarms.com/news-releases/news-release-details/bitfarms-officially-rebrands-keel-infrastructure-completes-us',
  comment: 'Issuer release dated 2026-04-01: one Keel share for each Bitfarms share; replacement trading symbol from 2026-04-06. Broker snapshots may already display the successor symbol retrospectively.',
}]