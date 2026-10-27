import Decimal from 'decimal.js'
import { expect } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseClient } from '../database/client'
import { createRangeAnalysisService } from '../analysis/rangeAnalysisService'
import { resolveAnalysisRange } from '../analysis/analysisRange'
import { calculateModifiedDietz } from '../engine/calculations/modifiedDietz'
import { resolvePeriodSnapshots } from '../engine/services/periodSnapshots'
import { createPeriodAnalysisService } from '../engine/services/periodAnalysisService'
import { projectChartValues } from '../presentation/displayMoney'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createPeriodFxReferenceService } from '../services/periodFxReferenceService'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createDocumentRepository } from '../repositories/documentRepository'

/** Runs against the same isolated imported DB as the chronological regression. */
export async function validateRealRanges(db: DatabaseClient, periodIds: Map<number,string>, root: string) {
  const fx = createPeriodFxReferenceService({ periods:createPeriodRepository(db),snapshots:createSnapshotRepository(db),portfolios:createPortfolioRepository(db),documents:createDocumentRepository(db) })
  const dependencies = { periods:createPeriodRepository(db),snapshots:createSnapshotRepository(db),transactions:createTransactionRepository(db),corporateActions:createCorporateActionRepository(db),getUsdReference:fx.getPeriodUsdMepReference }
  const service = createRangeAnalysisService(dependencies)
  const monthlyService = createPeriodAnalysisService(dependencies)
  const before = await db.select('SELECT total_changes() AS count')
  const report: Record<string,unknown> = {}
  const Money = Decimal.clone({ precision:40 })
  const monthlyReturns: string[] = []
  for (const month of [7,8]) {
    const id=periodIds.get(month)!
    const {opening,closing}=await resolvePeriodSnapshots(id,dependencies)
    const monthly=await monthlyService.analyzePeriod(id)
    const calculated=calculateModifiedDietz({ investmentResult:monthly.investmentResult, openingValue:monthly.openingValue,openingDate:opening.date,closingDate:closing.date,transactions:await dependencies.transactions.getByPeriod(id) })
    expect(calculated.status).toBe('CALCULATED')
    monthlyReturns.push(calculated.returnDecimal!)
  }
  const windows = [['Julio-Agosto',7,8],['3M',6,8],['6M',3,8],['YTD',1,8],['Julio personalizado',7,7]] as const
  for (const [label,start,end] of windows) {
    const analysis=await service.analyzeRange({startPeriodId:periodIds.get(start)!,endPeriodId:periodIds.get(end)!})
    expect(analysis.status, label + ': ' + JSON.stringify(analysis)).toBe('AVAILABLE')
    if (analysis.status!=='AVAILABLE') throw Error('Rango no disponible: '+label)
    expect(analysis.periods.map(row=>row.month)).toEqual(Array.from({length:end-start+1},(_,i)=>start+i))
    const first=await resolvePeriodSnapshots(periodIds.get(start)!,dependencies)
    const last=await resolvePeriodSnapshots(periodIds.get(end)!,dependencies)
    expect(analysis.openingSnapshot.id).toBe(first.opening.id)
    expect(analysis.closingSnapshot.id).toBe(last.closing.id)
    const transactions=[]
    for(let month=start;month<=end;month++) transactions.push(...await dependencies.transactions.getByPeriod(periodIds.get(month)!))
    const external=transactions.filter(row=>row.type==='CONTRIBUTION'||row.type==='WITHDRAWAL')
    expect(analysis.periodReturn.externalFlows.map(row=>row.transactionId).sort()).toEqual(external.map(row=>row.id).sort())
    const contributions=external.filter(row=>row.type==='CONTRIBUTION').reduce((sum,row)=>sum.plus(row.netAmount ?? row.grossAmount ?? '0'),new Money(0))
    const withdrawals=external.filter(row=>row.type==='WITHDRAWAL').reduce((sum,row)=>sum.plus(row.netAmount ?? row.grossAmount ?? '0'),new Money(0))
    expect(analysis.base.contributions).toBe(contributions.toFixed(2))
    expect(analysis.base.withdrawals).toBe(withdrawals.toFixed(2))
    expect(analysis.base.investmentResult).toBe(new Money(last.closing.totalValue).minus(first.opening.totalValue).minus(contributions).plus(withdrawals).toFixed(2))
    expect(analysis.periodReturn).toEqual(calculateModifiedDietz({investmentResult:analysis.base.investmentResult,openingValue:analysis.base.openingValue,openingDate:first.opening.date,closingDate:last.closing.date,transactions}))
    expect(analysis.usdReference).toMatchObject({status:'AVAILABLE',rate:end===8?'1534.51':'1518.19',periodId:periodIds.get(end)!})
    if(analysis.usdReference.status==='AVAILABLE') {
      const projected=projectChartValues(analysis.evolution,row=>row.portfolioValue,{currency:'USD',referenceFx:analysis.usdReference})
      for(const point of projected) expect(point.displayValue).toBe(new Money(point.portfolioValue).div(analysis.usdReference.rate).toFixed())
    }
    if(label==='Julio-Agosto') {
      expect(analysis.base).toMatchObject({openingValue:'23007361.00',closingValue:'26383988.00',contributions:'3050000.00',withdrawals:'1000000.00',investmentResult:'1326627.00'})
      expect(analysis.periodReturn.returnDecimal).not.toBe(new Money(monthlyReturns[0]!).plus(monthlyReturns[1]!).toFixed(28))
    }
    if(start===end) {
      expect(analysis.base).toEqual(await monthlyService.analyzePeriod(periodIds.get(start)!))
      expect(analysis.periodReturn.returnDecimal).toBe(monthlyReturns[0])
    }
    if(label==='YTD') {
      const al30=(await createInstrumentRepository(db).getAll()).find(row=>row.ticker==='AL30')
      expect(al30).toBeDefined()
      expect(analysis.instrumentUniverse.find(row=>row.instrumentId===al30!.id)).toMatchObject({presentAtOpening:false,presentAtClosing:false,completeTradeCycle:true})
    }
    report[label]={...analysis.base,openingDate:first.opening.date,closingDate:last.closing.date,days:analysis.durationDays,periods:analysis.periods.map(row=>row.month),periodReturn:analysis.periodReturn,usdReference:analysis.usdReference,instrumentUniverse:analysis.instrumentUniverse}
  }
  const last=(await dependencies.periods.getById(periodIds.get(8)!))!
  const catalog=(await dependencies.periods.getByPortfolio(last.portfolioId)).filter(row=>row.status==='COMPLETE')
  expect(resolveAnalysisRange(catalog,{mode:'LAST_12',endPeriodId:last.id})).toMatchObject({status:'INCOMPLETE_RANGE',missingPeriods:['2025-09','2025-10','2025-11','2025-12']})
  expect(await db.select('SELECT total_changes() AS count')).toEqual(before)
  await writeFile(path.join(root,'validation-ranges-report.json'),JSON.stringify(report,null,2))
}
