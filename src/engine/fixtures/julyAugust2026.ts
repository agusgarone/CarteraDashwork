import type { InstrumentCategory } from '../../domain/instrument'

/**
 * Posiciones reales de julio y agosto 2026.
 * El engine las une por instrumentId; el ticker solo identifica el fixture.
 *
 * BCACCA y BRTA usan los centavos del estado de cuenta.
 * Los importes redondeados al peso (2495625.00, 2287732.00, 2400253.00 y
 * 2386702.00) no se cargan: cambiarían el resultado para acercarlo a 176434.00.
 */
export interface JulyAugustHolding {
  ticker: string
  category: InstrumentCategory
  openingQuantity: string
  closingQuantity: string
  openingValue: string
  closingValue: string
}

export const julyAugust2026 = {
  openingValue: '25954029.00',
  closingValue: '26383988.00',
  contribution: '1250000.00',
  withdrawal: '1000000.00',
} as const

export const ypfStockDividend = {
  ticker: 'YPFD',
  type: 'STOCK_DIVIDEND',
  quantityBefore: '14',
  quantityChange: '126',
  quantityAfter: '140',
} as const

export const julyAugustHoldings: readonly JulyAugustHolding[] = [
  holding('GGAL', 'STOCK', '20', '157800.00', '140300.00'),
  holding('PAMP', 'STOCK', '179', '994345.00', '937960.00'),
  holding('TECO2', 'STOCK', '70', '308525.00', '298900.00'),
  holding('YPFD', 'STOCK', '14', '1160600.00', '1155700.00', '140'),

  holding('AAPL', 'CEDEAR', '28', '680680.00', '708960.00'),
  holding('AMZN', 'CEDEAR', '353', '1051058.00', '1021935.00'),
  holding('GLD', 'CEDEAR', '15', '175950.00', '195750.00'),
  holding('GOOGL', 'CEDEAR', '38', '368980.00', '356630.00'),
  holding('JPM', 'CEDEAR', '18', '667440.00', '683640.00'),
  holding('KO', 'CEDEAR', '15', '414000.00', '425400.00'),
  holding('MELI', 'CEDEAR', '10', '246100.00', '257600.00'),
  holding('META', 'CEDEAR', '13', '475020.00', '496340.00'),
  holding('MSFT', 'CEDEAR', '23', '559820.00', '622840.00'),
  holding('NVDA', 'CEDEAR', '50', '663000.00', '734000.00'),
  holding('SHEL', 'CEDEAR', '6', '434550.00', '438000.00'),
  holding('SLV', 'CEDEAR', '6', '82500.00', '96120.00'),
  holding('SMH', 'CEDEAR', '41', '703560.00', '731030.00'),
  holding('SPY', 'CEDEAR', '216', '4250880.00', '4419360.00'),
  holding('XLE', 'CEDEAR', '4', '187840.00', '204500.00'),
  holding('XLF', 'CEDEAR', '5', '224700.00', '230900.00'),
  holding('XLU', 'CEDEAR', '32', '150240.00', '144240.00'),

  holding('PLC4O', 'CORPORATE_BOND', '4000', '6790400.00', '6840800.00'),
  holding('TTCEO', 'CORPORATE_BOND', '4', '6206.00', '6266.00'),

  holding('BCACCA', 'FUND', '14860.792493', '2495624.61', '2287732.22'),
  holding('BRTA', 'FUND', '3214.592773', '2400252.55', '2386701.86'),
]

function holding(
  ticker: string,
  category: InstrumentCategory,
  quantity: string,
  openingValue: string,
  closingValue: string,
  closingQuantity = quantity,
): JulyAugustHolding {
  return {
    ticker,
    category,
    openingQuantity: quantity,
    closingQuantity,
    openingValue,
    closingValue,
  }
}
