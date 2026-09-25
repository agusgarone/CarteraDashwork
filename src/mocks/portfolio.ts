import type {
  CashBalance,
  Instrument,
  MonthSnapshot,
  PerformanceBreakdown,
} from '@/types/portfolio'

interface MonthInput {
  id: string
  label: string
  shortLabel: string
  status?: 'missing'
  startValue?: number
  contributions?: number
  withdrawals?: number
  investmentResult?: number
}

const monthInputs: MonthInput[] = [
  {
    id: '2025-09',
    label: 'Septiembre 2025',
    shortLabel: 'Sep 2025',
    startValue: 19_420_000,
    contributions: 180_000,
    withdrawals: 0,
    investmentResult: 250_000,
  },
  {
    id: '2025-10',
    label: 'Octubre 2025',
    shortLabel: 'Oct 2025',
    startValue: 19_850_000,
    contributions: 250_000,
    withdrawals: 50_000,
    investmentResult: 280_000,
  },
  {
    id: '2025-11',
    label: 'Noviembre 2025',
    shortLabel: 'Nov 2025',
    startValue: 20_330_000,
    contributions: 300_000,
    withdrawals: 50_000,
    investmentResult: 410_000,
  },
  {
    id: '2025-12',
    label: 'Diciembre 2025',
    shortLabel: 'Dic 2025',
    startValue: 20_990_000,
    contributions: 450_000,
    withdrawals: 50_000,
    investmentResult: 520_000,
  },
  {
    id: '2026-01',
    label: 'Enero 2026',
    shortLabel: 'Ene 2026',
    startValue: 21_910_000,
    contributions: 300_000,
    withdrawals: 50_000,
    investmentResult: 190_000,
  },
  {
    id: '2026-02',
    label: 'Febrero 2026',
    shortLabel: 'Feb 2026',
    startValue: 22_350_000,
    contributions: 250_000,
    withdrawals: 150_000,
    investmentResult: 240_000,
  },
  {
    id: '2026-03',
    label: 'Marzo 2026',
    shortLabel: 'Mar 2026',
    startValue: 22_690_000,
    contributions: 400_000,
    withdrawals: 50_000,
    investmentResult: 480_000,
  },
  {
    id: '2026-04',
    label: 'Abril 2026',
    shortLabel: 'Abr 2026',
    startValue: 23_520_000,
    contributions: 220_000,
    withdrawals: 170_000,
    investmentResult: 310_000,
  },
  {
    id: '2026-05',
    label: 'Mayo 2026',
    shortLabel: 'May 2026',
    startValue: 23_880_000,
    contributions: 500_000,
    withdrawals: 100_000,
    investmentResult: 610_000,
  },
  {
    id: '2026-06',
    label: 'Junio 2026',
    shortLabel: 'Jun 2026',
    status: 'missing',
  },
  {
    id: '2026-07',
    label: 'Julio 2026',
    shortLabel: 'Jul 2026',
    startValue: 24_890_000,
    contributions: 180_000,
    withdrawals: 180_000,
    investmentResult: 1_064_029,
  },
  {
    id: '2026-08',
    label: 'Agosto 2026',
    shortLabel: 'Ago 2026',
    startValue: 25_954_029,
    contributions: 1_250_000,
    withdrawals: 1_000_000,
    investmentResult: 179_959,
  },
]

function monthBounds(id: string) {
  const [yearText, monthText] = id.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const lastDay = new Date(year, month, 0).getDate()
  const mm = monthText.padStart(2, '0')
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  }
}

function buildMonths(inputs: MonthInput[]): MonthSnapshot[] {
  let investedCapital = 16_020_000
  let previousEnd: number | null = null

  return inputs.map((input) => {
    const bounds = monthBounds(input.id)
    if (input.status === 'missing') {
      return {
        id: input.id,
        label: input.label,
        shortLabel: input.shortLabel,
        ...bounds,
        status: 'missing',
        startValue: null,
        endValue: null,
        contributions: null,
        withdrawals: null,
        netContributions: null,
        investmentResult: null,
        investedCapitalEnd: null,
        returnPercentage: null,
      }
    }

    const startValue = input.startValue ?? 0
    const contributions = input.contributions ?? 0
    const withdrawals = input.withdrawals ?? 0
    const investmentResult = input.investmentResult ?? 0
    const netContributions = contributions - withdrawals
    const endValue = startValue + netContributions + investmentResult

    if (previousEnd !== null && startValue !== previousEnd) {
      throw new Error(`El mes ${input.id} no continúa el cierre anterior.`)
    }

    investedCapital += netContributions
    previousEnd = endValue

    return {
      id: input.id,
      label: input.label,
      shortLabel: input.shortLabel,
      ...bounds,
      status: 'complete',
      startValue,
      endValue,
      contributions,
      withdrawals,
      netContributions,
      investmentResult,
      investedCapitalEnd: investedCapital,
      returnPercentage: startValue === 0 ? 0 : investmentResult / startValue,
    }
  })
}

export const months: MonthSnapshot[] = buildMonths(monthInputs)

const august = months.find((month) => month.id === '2026-08')
if (
  !august ||
  august.endValue !== 26_383_988 ||
  august.investedCapitalEnd !== 18_450_000 ||
  august.investmentResult !== 179_959 ||
  august.startValue !== 25_954_029
) {
  throw new Error('El cierre de agosto no coincide con el escenario de referencia.')
}

/** Visible breakdown for August. fees + taxes = 20.000 so the four cards sum to the period result. */
export const augustBreakdown: PerformanceBreakdown = {
  marketChange: 138_412,
  dividends: 32_706,
  interest: 28_841,
  fees: 8_000,
  taxes: 12_000,
  other: 0,
}

/**
 * Period attribution shown for the latest loaded month.
 * These figures are illustrative mocks, not the output of a pricing engine.
 * FCI is the example from the product spec and is not forced to reconcile yet.
 */
export const latestCategoryPeriodResults: Record<string, number> = {
  cedears: 138_200,
  on: 42_500,
  fci: -221_443,
  acciones: 20_702,
  liquidez: 0,
}

export const categoryColors: Record<string, string> = {
  cedears: '#7C93B0',
  on: '#C4A574',
  fci: '#6E9E93',
  acciones: '#A98BB8',
  liquidez: '#C5C8CE',
}

interface CategorySeed {
  id: string
  name: string
  currentValue: number
  investedCapital: number
}

export const categorySeeds: CategorySeed[] = [
  { id: 'cedears', name: 'CEDEARs', currentValue: 11_767_245, investedCapital: 10_985_000 },
  { id: 'on', name: 'ON / Bonos', currentValue: 6_847_066, investedCapital: 6_520_000 },
  { id: 'fci', name: 'FCI', currentValue: 4_674_434, investedCapital: 4_890_000 },
  { id: 'acciones', name: 'Acciones', currentValue: 2_532_860, investedCapital: 2_410_000 },
  { id: 'liquidez', name: 'Liquidez', currentValue: 562_383, investedCapital: 562_383 },
]

export const cashBalances: CashBalance[] = [
  {
    id: 'cash-ars',
    label: 'Cuenta comitente ARS',
    amount: 562_383,
    currency: 'ARS',
    fxRate: null,
  },
]

interface InstrumentSeed {
  id: string
  ticker: string
  name: string
  categoryId: string
  quantity: number
  quantityUnit: string
  currentValue: number
  investedCapital: number
  income: number | null
}

const instrumentSeeds: InstrumentSeed[] = [
  { id: 'spy', ticker: 'SPY', name: 'SPDR S&P 500', categoryId: 'cedears', quantity: 216, quantityUnit: 'CEDEARs', currentValue: 4_419_360, investedCapital: 3_980_000, income: 17_514 },
  { id: 'amzn', ticker: 'AMZN', name: 'Amazon.com', categoryId: 'cedears', quantity: 353, quantityUnit: 'CEDEARs', currentValue: 1_021_935, investedCapital: 1_080_000, income: null },
  { id: 'aapl', ticker: 'AAPL', name: 'Apple', categoryId: 'cedears', quantity: 28, quantityUnit: 'CEDEARs', currentValue: 708_960, investedCapital: 650_000, income: 0.25 },
  { id: 'jpm', ticker: 'JPM', name: 'JPMorgan Chase', categoryId: 'cedears', quantity: 18, quantityUnit: 'CEDEARs', currentValue: 683_640, investedCapital: 620_000, income: 1.17 },
  { id: 'meta', ticker: 'META', name: 'Meta Platforms', categoryId: 'cedears', quantity: 13, quantityUnit: 'CEDEARs', currentValue: 496_340, investedCapital: 430_000, income: null },
  { id: 'msft', ticker: 'MSFT', name: 'Microsoft', categoryId: 'cedears', quantity: 23, quantityUnit: 'CEDEARs', currentValue: 622_840, investedCapital: 590_000, income: 4_500 },
  { id: 'nvda', ticker: 'NVDA', name: 'NVIDIA', categoryId: 'cedears', quantity: 42, quantityUnit: 'CEDEARs', currentValue: 1_210_000, investedCapital: 1_070_000, income: 4_500 },
  { id: 'googl', ticker: 'GOOGL', name: 'Alphabet', categoryId: 'cedears', quantity: 22, quantityUnit: 'CEDEARs', currentValue: 890_000, investedCapital: 910_000, income: null },
  { id: 'meli', ticker: 'MELI', name: 'Mercado Libre', categoryId: 'cedears', quantity: 6, quantityUnit: 'CEDEARs', currentValue: 780_000, investedCapital: 750_000, income: null },
  { id: 'ko', ticker: 'KO', name: 'Coca-Cola', categoryId: 'cedears', quantity: 55, quantityUnit: 'CEDEARs', currentValue: 420_170, investedCapital: 400_000, income: 6_190.58 },
  { id: 'dis', ticker: 'DIS', name: 'Walt Disney', categoryId: 'cedears', quantity: 12, quantityUnit: 'CEDEARs', currentValue: 204_000, investedCapital: 225_000, income: null },
  { id: 'tsla', ticker: 'TSLA', name: 'Tesla', categoryId: 'cedears', quantity: 9, quantityUnit: 'CEDEARs', currentValue: 310_000, investedCapital: 280_000, income: null },
  { id: 'al30', ticker: 'AL30', name: 'Bono USD 2030', categoryId: 'on', quantity: 4_500, quantityUnit: 'nominales', currentValue: 2_450_000, investedCapital: 2_300_000, income: 12_400 },
  { id: 'gd35', ticker: 'GD35', name: 'Bono USD 2035', categoryId: 'on', quantity: 3_200, quantityUnit: 'nominales', currentValue: 1_820_000, investedCapital: 1_750_000, income: 8_200 },
  { id: 'ypf27', ticker: 'YPF27', name: 'ON YPF 2027', categoryId: 'on', quantity: 2_000, quantityUnit: 'nominales', currentValue: 1_540_000, investedCapital: 1_480_000, income: 5_100 },
  { id: 'tx28', ticker: 'TX28', name: 'Bono del Tesoro 2028', categoryId: 'on', quantity: 1_800, quantityUnit: 'nominales', currentValue: 1_037_066, investedCapital: 990_000, income: 3_141 },
  { id: 'fima', ticker: 'FIMA', name: 'FIMA Premium', categoryId: 'fci', quantity: 1_250_000, quantityUnit: 'cuotapartes', currentValue: 2_104_000, investedCapital: 2_200_000, income: null },
  { id: 'balanz-rf', ticker: 'BRF', name: 'Balanz Renta Fija', categoryId: 'fci', quantity: 980_000, quantityUnit: 'cuotapartes', currentValue: 1_560_434, investedCapital: 1_640_000, income: null },
  { id: 'galileo', ticker: 'GAL', name: 'Galileo Renta', categoryId: 'fci', quantity: 640_000, quantityUnit: 'cuotapartes', currentValue: 1_010_000, investedCapital: 1_050_000, income: null },
  { id: 'ggal', ticker: 'GGAL', name: 'Grupo Financiero Galicia', categoryId: 'acciones', quantity: 800, quantityUnit: 'acciones', currentValue: 980_000, investedCapital: 910_000, income: null },
  { id: 'ypfd', ticker: 'YPFD', name: 'YPF', categoryId: 'acciones', quantity: 420, quantityUnit: 'acciones', currentValue: 720_000, investedCapital: 690_000, income: null },
  { id: 'pamp', ticker: 'PAMP', name: 'Pampa Energía', categoryId: 'acciones', quantity: 610, quantityUnit: 'acciones', currentValue: 512_860, investedCapital: 490_000, income: null },
  { id: 'bma', ticker: 'BMA', name: 'Banco Macro', categoryId: 'acciones', quantity: 250, quantityUnit: 'acciones', currentValue: 320_000, investedCapital: 320_000, income: null },
  { id: 'cash-ars', ticker: 'ARS', name: 'Liquidez en pesos', categoryId: 'liquidez', quantity: 562_383, quantityUnit: 'pesos', currentValue: 562_383, investedCapital: 562_383, income: null },
]

export const instruments: Instrument[] = instrumentSeeds.map((seed) => {
  const result = seed.currentValue - seed.investedCapital
  return {
    ...seed,
    result,
    returnPercentage: seed.investedCapital === 0 ? 0 : result / seed.investedCapital,
  }
})

const categoryTotals = categorySeeds.reduce(
  (sum, category) => sum + category.currentValue,
  0,
)
if (categoryTotals !== 26_383_988) {
  throw new Error('Las categorías no suman el patrimonio de agosto.')
}

for (const category of categorySeeds) {
  const rows = instruments.filter((instrument) => instrument.categoryId === category.id)
  const current = rows.reduce((sum, instrument) => sum + instrument.currentValue, 0)
  const invested = rows.reduce((sum, instrument) => sum + instrument.investedCapital, 0)
  if (current !== category.currentValue || invested !== category.investedCapital) {
    throw new Error(`Los instrumentos de ${category.name} no cierran con la categoría.`)
  }
}

export const LAST_LOADED_MONTH_ID = '2026-08'
export const LAST_LOADED_LABEL = 'Agosto 2026'
export const NEXT_IMPORT_MONTH_ID = '2026-09'
export const NEXT_IMPORT_LABEL = 'Septiembre 2026'
