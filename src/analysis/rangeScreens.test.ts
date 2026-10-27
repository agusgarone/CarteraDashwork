import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AnalysisRangeSelector } from '../components/period/AnalysisRangeSelector'
import { RangeDashboard } from '../components/dashboard/RangeDashboard'
import { DisplayCurrencyScope } from '../presentation/DisplayCurrencyProvider'
import { createDisplayPresenter, type AvailableFxReference, type DisplaySettings } from '../presentation/displayMoney'
import { calculateModifiedDietz } from '../engine/calculations/modifiedDietz'
import { resolveAnalysisRange, type AnalysisRangeMode } from './analysisRange'
import type { RangeAnalysisAvailable } from './rangeAnalysisService'
const catalog = Array.from({length:8},(_,index)=>({id:String(index+1),year:2026,month:index+1}))
let mode: AnalysisRangeMode = 'SINGLE'
vi.mock('./AnalysisRangeProvider',()=>({useAnalysisRange:()=>({mode,catalog,endPeriodId:'8',customStartPeriodId:'3',setMode:()=>{},setCustomStart:()=>{},chooseEnd:()=>{}})}))
const reference: AvailableFxReference = {status:'AVAILABLE',periodId:'8',currency:'USD_MEP',rate:'1534.51',date:'2026-08-31',snapshotId:'august',source:{kind:'EXPLICIT_SNAPSHOT_RATE',broker:'BALANZ',documentId:'pdf',documentType:'CONSOLIDATED_POSITION',originalFilename:'close.pdf',localPath:'documents/close.pdf',sha256:'hash',parserVersion:'1',cashBalanceId:'cash',field:'cash_balances.fx_rate',documentField:'Tipo de cambio: MEP'}}
const result: RangeAnalysisAvailable = {
  status:'AVAILABLE',range:{startPeriodId:'7',endPeriodId:'8'},periods:catalog.slice(6).map(row=>({...row,portfolioId:'p',status:'COMPLETE',createdAt:'',completedAt:''})),
  openingSnapshot:{id:'june',portfolioId:'p',periodId:'6',date:'2026-06-30',totalValue:'23007361',currency:'ARS',sourceDocumentId:null,createdAt:''},
  closingSnapshot:{id:'august',portfolioId:'p',periodId:'8',date:'2026-08-31',totalValue:'26383988',currency:'ARS',sourceDocumentId:null,createdAt:''},
  durationDays:62,base:{openingValue:'23007361',closingValue:'26383988',contributions:'3050000',withdrawals:'1000000',netContributions:'2050000',investmentResult:'1326627'},
  periodReturn:calculateModifiedDietz({openingValue:'23007361',investmentResult:'1326627',openingDate:'2026-06-30',closingDate:'2026-08-31',transactions:[]}),
  attribution:{status:'PENDING',reason:'MULTI_PERIOD_ATTRIBUTION_NOT_IMPLEMENTED'},transactionIds:[],instrumentUniverse:[],
  evolution:[{id:'7',label:'Julio',date:'2026-07-31',portfolioValue:'25954029'},{id:'8',label:'Agosto',date:'2026-08-31',portfolioValue:'26383988'}],usdReference:reference,
}
function render(settings: DisplaySettings, value = result) {
  return renderToStaticMarkup(createElement(DisplayCurrencyScope,{settings,children:createElement(RangeDashboard,{result:value,loading:false,error:null,controls:createElement('button',null,'Cambiar rango')})}))
}
describe('Home de rangos',()=>{
  it.each(['ARS','USD'] as const)('presenta todos los montos en %s y mantiene atribución pendiente',currency=>{
    const settings={currency,referenceFx:reference}
    const presenter=createDisplayPresenter(settings)
    const before=structuredClone(result)
    const html=render(settings)
    for(const amount of ['23007361','26383988','3050000','1000000']) expect(html).toContain(presenter.format(amount))
    expect(html).toContain(presenter.signed('1326627'))
    expect(html).toContain('62 días')
    expect(html).toContain('Julio 2026')
    expect(html).toContain('Agosto 2026')
    expect(html).toContain('Atribución del rango pendiente')
    expect(html).not.toContain('Resultado del mes')
    if(currency==='USD') expect(html).not.toMatch(/\$[\d]/)
    expect(result).toEqual(before)
  })
  it('no presenta valores de un rango anterior mientras cambia la referencia final',()=>{
    const html=render({currency:'USD',referenceFx:{...reference,periodId:'7',rate:'1518.19'}})
    expect(html).toContain('Consultando referencia USD')
    expect(html).not.toContain('Patrimonio inicial')
  })
  it('un rango incompleto lista el hueco y conserva los controles sin KPIs',()=>{
    const missing=resolveAnalysisRange(catalog.filter(row=>row.month!==3),{mode:'YTD',endPeriodId:'8'})
    const html=renderToStaticMarkup(createElement(RangeDashboard,{result:missing.status==='AVAILABLE'?null:missing,loading:false,error:null,controls:createElement('button',null,'Cambiar rango')}))
    expect(html).toContain('2026-03')
    expect(html).toContain('Cambiar rango')
    expect(html).not.toContain('Patrimonio final')
  })
  it('12M se deshabilita con meses faltantes explícitos y YTD está disponible',()=>{
    mode='SINGLE'
    const html=renderToStaticMarkup(createElement(AnalysisRangeSelector))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Faltan períodos: 2025-09, 2025-10, 2025-11, 2025-12"[^>]*>12M<\/button>/)
    expect(html).toMatch(/<button(?![^>]*disabled=)[^>]*>YTD<\/button>/)
  })
  it('personalizado ofrece ambos extremos sobre períodos existentes',()=>{
    mode='CUSTOM'
    const html=renderToStaticMarkup(createElement(AnalysisRangeSelector))
    expect(html).toContain('Desde')
    expect(html).toContain('Hasta')
    expect(html).toContain('Marzo 2026')
    expect(html).not.toContain('Septiembre 2026')
  })
})
