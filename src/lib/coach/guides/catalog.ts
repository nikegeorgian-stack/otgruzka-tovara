import type { ViewId } from '@/lib/types'
import type { CoachGuide, CoachGuideStep } from './types'
import { EXTRA_COACH_GUIDES } from './extraGuides'

/** Первый шаг почти каждой инструкции — пункт меню слева. */
function navStep(view: ViewId): CoachGuideStep {
  return {
    target: `nav:${view}`,
    titleKey: `coach.guide.nav.${view}.title`,
    bodyKey: `coach.guide.nav.${view}.body`,
  }
}

function guide(
  partial: Omit<CoachGuide, 'steps'> & { steps: CoachGuideStep[]; skipNav?: boolean },
): CoachGuide {
  const { skipNav, steps, ...rest } = partial
  return {
    ...rest,
    steps: skipNav ? steps : [navStep(rest.view), ...steps],
  }
}

/**
 * Каталог пошаговых инструкций «для новичка».
 * Каждый шаг — клик по элементу с data-coach="<target>".
 * Дальше только после клика по красной рамке (без кнопки «Далее»).
 */
export const COACH_GUIDES: CoachGuide[] = [
  // ─── Табель ─────────────────────────────────────────────
  guide({
    id: 'month.editCell',
    view: 'month',
    titleKey: 'coach.guide.month.editCell.title',
    blurbKey: 'coach.guide.month.editCell.blurb',
    steps: [
      {
        target: 'month:edit',
        titleKey: 'coach.guide.month.editCell.s1.title',
        bodyKey: 'coach.guide.month.editCell.s1.body',
      },
      {
        target: 'month:tabFact',
        titleKey: 'coach.guide.month.editCell.s2.title',
        bodyKey: 'coach.guide.month.editCell.s2.body',
      },
      {
        target: 'month:cell',
        titleKey: 'coach.guide.month.editCell.s3.title',
        bodyKey: 'coach.guide.month.editCell.s3.body',
      },
    ],
  }),
  guide({
    id: 'month.planFact',
    view: 'month',
    titleKey: 'coach.guide.month.planFact.title',
    blurbKey: 'coach.guide.month.planFact.blurb',
    steps: [
      {
        target: 'month:tabPlan',
        titleKey: 'coach.guide.month.planFact.s1.title',
        bodyKey: 'coach.guide.month.planFact.s1.body',
      },
      {
        target: 'month:tabFact',
        titleKey: 'coach.guide.month.planFact.s2.title',
        bodyKey: 'coach.guide.month.planFact.s2.body',
      },
    ],
  }),
  guide({
    id: 'month.rollcall',
    view: 'month',
    titleKey: 'coach.guide.month.rollcall.title',
    blurbKey: 'coach.guide.month.rollcall.blurb',
    steps: [
      {
        target: 'month:tabFact',
        titleKey: 'coach.guide.month.rollcall.s0.title',
        bodyKey: 'coach.guide.month.rollcall.s0.body',
      },
      {
        target: 'month:tools',
        titleKey: 'coach.guide.month.openTools.title',
        bodyKey: 'coach.guide.month.openTools.body',
      },
      {
        target: 'month:fillDay',
        titleKey: 'coach.guide.month.rollcall.s1.title',
        bodyKey: 'coach.guide.month.rollcall.s1.body',
      },
    ],
  }),
  guide({
    id: 'month.brigadeBoard',
    view: 'month',
    titleKey: 'coach.guide.month.brigadeBoard.title',
    blurbKey: 'coach.guide.month.brigadeBoard.blurb',
    steps: [
      {
        target: 'month:viewBrigades',
        titleKey: 'coach.guide.month.brigadeBoard.s1.title',
        bodyKey: 'coach.guide.month.brigadeBoard.s1.body',
      },
      {
        target: 'month:brigadeBoardTile',
        titleKey: 'coach.guide.month.brigadeBoard.s2.title',
        bodyKey: 'coach.guide.month.brigadeBoard.s2.body',
      },
      {
        target: 'month:reorderRow',
        titleKey: 'coach.guide.month.brigadeBoard.s3.title',
        bodyKey: 'coach.guide.month.brigadeBoard.s3.body',
      },
    ],
  }),
  guide({
    id: 'month.tools',
    view: 'month',
    titleKey: 'coach.guide.month.tools.title',
    blurbKey: 'coach.guide.month.tools.blurb',
    steps: [
      {
        target: 'month:tools',
        titleKey: 'coach.guide.month.openTools.title',
        bodyKey: 'coach.guide.month.openTools.body',
      },
    ],
  }),
  guide({
    id: 'month.transfer',
    view: 'month',
    titleKey: 'coach.guide.month.transfer.title',
    blurbKey: 'coach.guide.month.transfer.blurb',
    steps: [
      {
        target: 'month:more',
        titleKey: 'coach.guide.month.transfer.s1.title',
        bodyKey: 'coach.guide.month.transfer.s1.body',
      },
      {
        target: 'month:transfer',
        titleKey: 'coach.guide.month.transfer.s2.title',
        bodyKey: 'coach.guide.month.transfer.s2.body',
      },
    ],
  }),
  guide({
    id: 'month.nightShift',
    view: 'month',
    titleKey: 'coach.guide.month.nightShift.title',
    blurbKey: 'coach.guide.month.nightShift.blurb',
    steps: [
      {
        target: 'month:more',
        titleKey: 'coach.guide.month.nightShift.s1.title',
        bodyKey: 'coach.guide.month.nightShift.s1.body',
      },
      {
        target: 'month:nightShift',
        titleKey: 'coach.guide.month.nightShift.s2.title',
        bodyKey: 'coach.guide.month.nightShift.s2.body',
      },
      {
        target: 'nightShift:compose',
        titleKey: 'coach.guide.month.nightShift.s3.title',
        bodyKey: 'coach.guide.month.nightShift.s3.body',
      },
      {
        target: 'nightShift:applyFill',
        titleKey: 'coach.guide.month.nightShift.s4.title',
        bodyKey: 'coach.guide.month.nightShift.s4.body',
      },
      {
        target: 'nightShift:reason',
        titleKey: 'coach.guide.month.nightShift.s5.title',
        bodyKey: 'coach.guide.month.nightShift.s5.body',
        minDepth: 'guided',
      },
      {
        target: 'nightShift:post',
        titleKey: 'coach.guide.month.nightShift.s6.title',
        bodyKey: 'coach.guide.month.nightShift.s6.body',
      },
    ],
  }),
  guide({
    id: 'month.print',
    view: 'month',
    titleKey: 'coach.guide.month.print.title',
    blurbKey: 'coach.guide.month.print.blurb',
    steps: [
      {
        target: 'month:more',
        titleKey: 'coach.guide.month.print.s1.title',
        bodyKey: 'coach.guide.month.print.s1.body',
      },
      {
        target: 'month:print',
        titleKey: 'coach.guide.month.print.s2.title',
        bodyKey: 'coach.guide.month.print.s2.body',
      },
      {
        target: 'print:oneBrigadePerPage',
        titleKey: 'coach.guide.month.print.s3.title',
        bodyKey: 'coach.guide.month.print.s3.body',
      },
      {
        target: 'print:showHours',
        titleKey: 'coach.guide.month.print.s4.title',
        bodyKey: 'coach.guide.month.print.s4.body',
      },
    ],
  }),
  guide({
    id: 'month.planEditor',
    view: 'month',
    titleKey: 'coach.guide.month.planEditor.title',
    blurbKey: 'coach.guide.month.planEditor.blurb',
    steps: [
      {
        target: 'month:tools',
        titleKey: 'coach.guide.month.openTools.title',
        bodyKey: 'coach.guide.month.openTools.body',
      },
      {
        target: 'month:planEditor',
        titleKey: 'coach.guide.month.planEditor.s1.title',
        bodyKey: 'coach.guide.month.planEditor.s1.body',
      },
    ],
  }),
  guide({
    id: 'month.coverage',
    view: 'month',
    titleKey: 'coach.guide.month.coverage.title',
    blurbKey: 'coach.guide.month.coverage.blurb',
    steps: [
      {
        target: 'month:coverage',
        titleKey: 'coach.guide.month.coverage.s1.title',
        bodyKey: 'coach.guide.month.coverage.s1.body',
      },
    ],
  }),

  guide({
    id: 'month.fillSelection',
    view: 'month',
    titleKey: 'coach.guide.month.fillSelection.title',
    blurbKey: 'coach.guide.month.fillSelection.blurb',
    steps: [
      {
        target: 'month:edit',
        titleKey: 'coach.guide.month.fillSelection.s1.title',
        bodyKey: 'coach.guide.month.fillSelection.s1.body',
      },
      {
        target: 'month:cell',
        titleKey: 'coach.guide.month.fillSelection.s2.title',
        bodyKey: 'coach.guide.month.fillSelection.s2.body',
      },
    ],
  }),
  guide({
    id: 'month.mismatchFilter',
    view: 'month',
    titleKey: 'coach.guide.month.mismatchFilter.title',
    blurbKey: 'coach.guide.month.mismatchFilter.blurb',
    steps: [
      {
        target: 'month:tools',
        titleKey: 'coach.guide.month.openTools.title',
        bodyKey: 'coach.guide.month.openTools.body',
      },
      {
        target: 'month:mismatchOnly',
        titleKey: 'coach.guide.month.mismatchFilter.s1.title',
        bodyKey: 'coach.guide.month.mismatchFilter.s1.body',
      },
    ],
  }),
  guide({
    id: 'month.history',
    view: 'month',
    titleKey: 'coach.guide.month.history.title',
    blurbKey: 'coach.guide.month.history.blurb',
    steps: [
      {
        target: 'month:tools',
        titleKey: 'coach.guide.month.openTools.title',
        bodyKey: 'coach.guide.month.openTools.body',
      },
      {
        target: 'month:history',
        titleKey: 'coach.guide.month.history.s1.title',
        bodyKey: 'coach.guide.month.history.s1.body',
      },
    ],
  }),
  guide({
    id: 'month.softCopy',
    view: 'month',
    titleKey: 'coach.guide.month.softCopy.title',
    blurbKey: 'coach.guide.month.softCopy.blurb',
    steps: [
      {
        target: 'month:tools',
        titleKey: 'coach.guide.month.openTools.title',
        bodyKey: 'coach.guide.month.openTools.body',
      },
      {
        target: 'month:copyPlanEmpty',
        titleKey: 'coach.guide.month.softCopy.s2.title',
        bodyKey: 'coach.guide.month.softCopy.s2.body',
      },
    ],
  }),
  guide({
    id: 'month.dangerCopy',
    view: 'month',
    titleKey: 'coach.guide.month.dangerCopy.title',
    blurbKey: 'coach.guide.month.dangerCopy.blurb',
    steps: [
      {
        target: 'month:tools',
        titleKey: 'coach.guide.month.openTools.title',
        bodyKey: 'coach.guide.month.openTools.body',
      },
      {
        target: 'month:copyPlanDanger',
        titleKey: 'coach.guide.month.dangerCopy.s2.title',
        bodyKey: 'coach.guide.month.dangerCopy.s2.body',
        minDepth: 'guided',
      },
    ],
  }),
  guide({
    id: 'month.audit',
    view: 'month',
    titleKey: 'coach.guide.month.audit.title',
    blurbKey: 'coach.guide.month.audit.blurb',
    steps: [
      {
        target: 'month:more',
        titleKey: 'coach.guide.month.audit.s1.title',
        bodyKey: 'coach.guide.month.audit.s1.body',
      },
      {
        target: 'month:audit',
        titleKey: 'coach.guide.month.audit.s2.title',
        bodyKey: 'coach.guide.month.audit.s2.body',
      },
    ],
  }),

  // ─── Кадры ──────────────────────────────────────────────
  guide({
    id: 'hr.addEmployee',
    view: 'hr',
    titleKey: 'coach.guide.hr.addEmployee.title',
    blurbKey: 'coach.guide.hr.addEmployee.blurb',
    steps: [
      {
        target: 'hr:tabEmployees',
        titleKey: 'coach.guide.hr.addEmployee.s1.title',
        bodyKey: 'coach.guide.hr.addEmployee.s1.body',
      },
      {
        target: 'hr:addEmployee',
        titleKey: 'coach.guide.hr.addEmployee.s2.title',
        bodyKey: 'coach.guide.hr.addEmployee.s2.body',
      },
      {
        target: 'hr:cardSalary',
        titleKey: 'coach.guide.hr.addEmployee.sSalary.title',
        bodyKey: 'coach.guide.hr.addEmployee.sSalary.body',
        minDepth: 'guided',
      },
      {
        target: 'hr:employeeSave',
        titleKey: 'coach.guide.hr.addEmployee.s3.title',
        bodyKey: 'coach.guide.hr.addEmployee.s3.body',
        minDepth: 'full',
      },
    ],
  }),
  guide({
    id: 'hr.candidates',
    view: 'hr',
    titleKey: 'coach.guide.hr.candidates.title',
    blurbKey: 'coach.guide.hr.candidates.blurb',
    steps: [
      {
        target: 'hr:tabCandidates',
        titleKey: 'coach.guide.hr.candidates.s1.title',
        bodyKey: 'coach.guide.hr.candidates.s1.body',
      },
      {
        target: 'hr:addCandidate',
        titleKey: 'coach.guide.hr.candidates.s2.title',
        bodyKey: 'coach.guide.hr.candidates.s2.body',
        minDepth: 'guided',
      },
    ],
  }),
  guide({
    id: 'hr.contracts',
    view: 'hr',
    titleKey: 'coach.guide.hr.contracts.title',
    blurbKey: 'coach.guide.hr.contracts.blurb',
    steps: [
      {
        target: 'hr:tabContracts',
        titleKey: 'coach.guide.hr.contracts.s1.title',
        bodyKey: 'coach.guide.hr.contracts.s1.body',
      },
    ],
  }),
  guide({
    id: 'hr.absences',
    view: 'hr',
    titleKey: 'coach.guide.hr.absences.title',
    blurbKey: 'coach.guide.hr.absences.blurb',
    steps: [
      {
        target: 'hr:tabAbsences',
        titleKey: 'coach.guide.hr.absences.s1.title',
        bodyKey: 'coach.guide.hr.absences.s1.body',
      },
    ],
  }),

  // ─── Финансы ────────────────────────────────────────────
  guide({
    id: 'finance.documents',
    view: 'finance',
    titleKey: 'coach.guide.finance.documents.title',
    blurbKey: 'coach.guide.finance.documents.blurb',
    steps: [
      {
        target: 'finance:tabDocuments',
        titleKey: 'coach.guide.finance.documents.s1.title',
        bodyKey: 'coach.guide.finance.documents.s1.body',
      },
    ],
  }),
  guide({
    id: 'finance.statement',
    view: 'finance',
    titleKey: 'coach.guide.finance.statement.title',
    blurbKey: 'coach.guide.finance.statement.blurb',
    steps: [
      {
        target: 'finance:tabStatement',
        titleKey: 'coach.guide.finance.statement.s1.title',
        bodyKey: 'coach.guide.finance.statement.s1.body',
      },
      {
        target: 'finance:export1c',
        titleKey: 'coach.guide.finance.statement.s2.title',
        bodyKey: 'coach.guide.finance.statement.s2.body',
      },
    ],
  }),
  guide({
    id: 'finance.rates',
    view: 'finance',
    titleKey: 'coach.guide.finance.rates.title',
    blurbKey: 'coach.guide.finance.rates.blurb',
    steps: [
      {
        target: 'finance:tabRates',
        titleKey: 'coach.guide.finance.rates.s1.title',
        bodyKey: 'coach.guide.finance.rates.s1.body',
      },
    ],
  }),
  guide({
    id: 'finance.sick',
    view: 'finance',
    titleKey: 'coach.guide.finance.sick.title',
    blurbKey: 'coach.guide.finance.sick.blurb',
    steps: [
      {
        target: 'finance:tabSick',
        titleKey: 'coach.guide.finance.sick.s1.title',
        bodyKey: 'coach.guide.finance.sick.s1.body',
      },
    ],
  }),

  // ─── Склад ──────────────────────────────────────────────
  guide({
    id: 'warehouse.balances',
    view: 'warehouse',
    titleKey: 'coach.guide.warehouse.balances.title',
    blurbKey: 'coach.guide.warehouse.balances.blurb',
    steps: [
      {
        target: 'warehouse:tabBalances',
        titleKey: 'coach.guide.warehouse.balances.s1.title',
        bodyKey: 'coach.guide.warehouse.balances.s1.body',
      },
    ],
  }),
  guide({
    id: 'warehouse.movements',
    view: 'warehouse',
    titleKey: 'coach.guide.warehouse.movements.title',
    blurbKey: 'coach.guide.warehouse.movements.blurb',
    steps: [
      {
        target: 'warehouse:tabMovements',
        titleKey: 'coach.guide.warehouse.movements.s1.title',
        bodyKey: 'coach.guide.warehouse.movements.s1.body',
      },
      {
        target: 'warehouse:movementLedger',
        titleKey: 'coach.guide.warehouse.movements.s2.title',
        bodyKey: 'coach.guide.warehouse.movements.s2.body',
      },
    ],
  }),
  guide({
    id: 'warehouse.documents',
    view: 'warehouse',
    titleKey: 'coach.guide.warehouse.documents.title',
    blurbKey: 'coach.guide.warehouse.documents.blurb',
    steps: [
      {
        target: 'warehouse:tabDocuments',
        titleKey: 'coach.guide.warehouse.documents.s1.title',
        bodyKey: 'coach.guide.warehouse.documents.s1.body',
      },
    ],
  }),
  guide({
    id: 'warehouse.inventory',
    view: 'warehouse',
    titleKey: 'coach.guide.warehouse.inventory.title',
    blurbKey: 'coach.guide.warehouse.inventory.blurb',
    steps: [
      {
        target: 'warehouse:tabInventory',
        titleKey: 'coach.guide.warehouse.inventory.s1.title',
        bodyKey: 'coach.guide.warehouse.inventory.s1.body',
      },
    ],
  }),
  guide({
    id: 'warehouse.loading',
    view: 'warehouse',
    titleKey: 'coach.guide.warehouse.loading.title',
    blurbKey: 'coach.guide.warehouse.loading.blurb',
    steps: [
      {
        target: 'warehouse:tabLoading',
        titleKey: 'coach.guide.warehouse.loading.s1.title',
        bodyKey: 'coach.guide.warehouse.loading.s1.body',
      },
    ],
  }),

  // ─── Производство / план / дирекция / закупки ───────────
  guide({
    id: 'production.request',
    view: 'production',
    titleKey: 'coach.guide.production.request.title',
    blurbKey: 'coach.guide.production.request.blurb',
    steps: [
      {
        target: 'production:tabRequest',
        titleKey: 'coach.guide.production.request.s1.title',
        bodyKey: 'coach.guide.production.request.s1.body',
      },
    ],
  }),
  guide({
    id: 'planner.orders',
    view: 'planner',
    titleKey: 'coach.guide.planner.orders.title',
    blurbKey: 'coach.guide.planner.orders.blurb',
    steps: [
      {
        target: 'planner:tabOrders',
        titleKey: 'coach.guide.planner.orders.s1.title',
        bodyKey: 'coach.guide.planner.orders.s1.body',
      },
      {
        target: 'planner:newOrder',
        titleKey: 'coach.guide.planner.orders.s2.title',
        bodyKey: 'coach.guide.planner.orders.s2.body',
      },
      {
        target: 'planner:cardProduct',
        titleKey: 'coach.guide.planner.orders.sProduct.title',
        bodyKey: 'coach.guide.planner.orders.sProduct.body',
        minDepth: 'guided',
      },
      {
        target: 'planner:cardQty',
        titleKey: 'coach.guide.planner.orders.sQty.title',
        bodyKey: 'coach.guide.planner.orders.sQty.body',
        minDepth: 'guided',
      },
      {
        target: 'planner:cardMesh',
        titleKey: 'coach.guide.planner.orders.sMesh.title',
        bodyKey: 'coach.guide.planner.orders.sMesh.body',
        minDepth: 'full',
      },
    ],
  }),
  guide({
    id: 'director.newOrder',
    view: 'director',
    titleKey: 'coach.guide.director.newOrder.title',
    blurbKey: 'coach.guide.director.newOrder.blurb',
    steps: [
      {
        target: 'nav:director',
        titleKey: 'coach.guide.nav.director.title',
        bodyKey: 'coach.guide.nav.director.body',
        minDepth: 'guided',
      },
      {
        target: 'director:tabOrders',
        titleKey: 'coach.guide.director.newOrder.s1.title',
        bodyKey: 'coach.guide.director.newOrder.s1.body',
      },
      {
        target: 'director:newOrder',
        titleKey: 'coach.guide.director.newOrder.s2.title',
        bodyKey: 'coach.guide.director.newOrder.s2.body',
      },
      {
        target: 'director:orderCustomer',
        titleKey: 'coach.guide.director.newOrder.s3.title',
        bodyKey: 'coach.guide.director.newOrder.s3.body',
        minDepth: 'guided',
      },
      {
        target: 'director:orderAddCustomer',
        titleKey: 'coach.guide.director.newOrder.s4.title',
        bodyKey: 'coach.guide.director.newOrder.s4.body',
        minDepth: 'full',
      },
      {
        target: 'director:orderSave',
        titleKey: 'coach.guide.director.newOrder.s5.title',
        bodyKey: 'coach.guide.director.newOrder.s5.body',
        minDepth: 'full',
      },
    ],
  }),
  guide({
    id: 'procurement.orders',
    view: 'procurement',
    titleKey: 'coach.guide.procurement.orders.title',
    blurbKey: 'coach.guide.procurement.orders.blurb',
    steps: [
      {
        target: 'procurement:tabOrders',
        titleKey: 'coach.guide.procurement.orders.s1.title',
        bodyKey: 'coach.guide.procurement.orders.s1.body',
      },
      {
        target: 'procurement:newOrder',
        titleKey: 'coach.guide.procurement.orders.s2.title',
        bodyKey: 'coach.guide.procurement.orders.s2.body',
        minDepth: 'guided',
      },
      {
        target: 'procurement:orderSupplier',
        titleKey: 'coach.guide.procurement.orders.s3.title',
        bodyKey: 'coach.guide.procurement.orders.s3.body',
        minDepth: 'guided',
      },
      {
        target: 'procurement:orderAddSupplier',
        titleKey: 'coach.guide.procurement.orders.s4.title',
        bodyKey: 'coach.guide.procurement.orders.s4.body',
        minDepth: 'full',
      },
      {
        target: 'procurement:orderSave',
        titleKey: 'coach.guide.procurement.orders.s5.title',
        bodyKey: 'coach.guide.procurement.orders.s5.body',
        minDepth: 'full',
      },
      {
        target: 'procurement:receive',
        titleKey: 'coach.guide.procurement.orders.s6.title',
        bodyKey: 'coach.guide.procurement.orders.s6.body',
        minDepth: 'guided',
      },
    ],
  }),

  guide({
    id: 'feedback.report',
    view: 'settings',
    global: true,
    skipNav: true,
    titleKey: 'coach.guide.feedback.report.title',
    blurbKey: 'coach.guide.feedback.report.blurb',
    steps: [
      {
        target: 'feedback:open',
        titleKey: 'coach.guide.feedback.report.s1.title',
        bodyKey: 'coach.guide.feedback.report.s1.body',
      },
      {
        target: 'feedback:kinds',
        titleKey: 'coach.guide.feedback.report.s2.title',
        bodyKey: 'coach.guide.feedback.report.s2.body',
        minDepth: 'guided',
      },
      {
        target: 'feedback:text',
        titleKey: 'coach.guide.feedback.report.s3.title',
        bodyKey: 'coach.guide.feedback.report.s3.body',
        minDepth: 'guided',
      },
      {
        target: 'feedback:send',
        titleKey: 'coach.guide.feedback.report.s4.title',
        bodyKey: 'coach.guide.feedback.report.s4.body',
        minDepth: 'full',
      },
    ],
  }),

  // ─── Технолог / миксер ──────────────────────────────────
  guide({
    id: 'technologist.recipes',
    view: 'technologist',
    titleKey: 'coach.guide.technologist.recipes.title',
    blurbKey: 'coach.guide.technologist.recipes.blurb',
    steps: [
      {
        target: 'technologist:tabRecipes',
        titleKey: 'coach.guide.technologist.recipes.s1.title',
        bodyKey: 'coach.guide.technologist.recipes.s1.body',
      },
    ],
  }),
  guide({
    id: 'mixer.tasks',
    view: 'mixer',
    titleKey: 'coach.guide.mixer.tasks.title',
    blurbKey: 'coach.guide.mixer.tasks.blurb',
    steps: [
      {
        target: 'mixer:inbox',
        titleKey: 'coach.guide.mixer.tasks.s1.title',
        bodyKey: 'coach.guide.mixer.tasks.s1.body',
      },
      {
        target: 'mixer:workPanel',
        titleKey: 'coach.guide.mixer.tasks.s2.title',
        bodyKey: 'coach.guide.mixer.tasks.s2.body',
        minDepth: 'guided',
      },
      {
        target: 'mixer:postMix',
        titleKey: 'coach.guide.mixer.tasks.s3.title',
        bodyKey: 'coach.guide.mixer.tasks.s3.body',
        minDepth: 'full',
      },
    ],
  }),

  // ─── Справочники / журналы / настройки / прочее ─────────
  guide({
    id: 'directories.open',
    view: 'directories',
    titleKey: 'coach.guide.directories.open.title',
    blurbKey: 'coach.guide.directories.open.blurb',
    steps: [
      {
        target: 'directories:tabs',
        titleKey: 'coach.guide.directories.open.s1.title',
        bodyKey: 'coach.guide.directories.open.s1.body',
      },
      {
        target: 'directories:tabCounterparties',
        titleKey: 'coach.guide.directories.open.s2.title',
        bodyKey: 'coach.guide.directories.open.s2.body',
        minDepth: 'guided',
      },
    ],
  }),
  guide({
    id: 'journals.open',
    view: 'journals',
    titleKey: 'coach.guide.journals.open.title',
    blurbKey: 'coach.guide.journals.open.blurb',
    steps: [
      {
        target: 'journals:categories',
        titleKey: 'coach.guide.journals.open.s1.title',
        bodyKey: 'coach.guide.journals.open.s1.body',
      },
      {
        target: 'journals:filters',
        titleKey: 'coach.guide.journals.open.s2.title',
        bodyKey: 'coach.guide.journals.open.s2.body',
        minDepth: 'guided',
      },
      {
        target: 'journals:commands',
        titleKey: 'coach.guide.journals.open.s3.title',
        bodyKey: 'coach.guide.journals.open.s3.body',
        minDepth: 'full',
      },
    ],
  }),
  guide({
    id: 'settings.access',
    view: 'settings',
    titleKey: 'coach.guide.settings.access.title',
    blurbKey: 'coach.guide.settings.access.blurb',
    steps: [
      {
        target: 'settings:access',
        titleKey: 'coach.guide.settings.access.s1.title',
        bodyKey: 'coach.guide.settings.access.s1.body',
      },
    ],
  }),
  guide({
    id: 'summary.open',
    view: 'summary',
    titleKey: 'coach.guide.summary.open.title',
    blurbKey: 'coach.guide.summary.open.blurb',
    steps: [
      {
        target: 'summary:table',
        titleKey: 'coach.guide.summary.open.s1.title',
        bodyKey: 'coach.guide.summary.open.s1.body',
      },
    ],
  }),
  guide({
    id: 'my.cabinet',
    view: 'my',
    titleKey: 'coach.guide.my.cabinet.title',
    blurbKey: 'coach.guide.my.cabinet.blurb',
    steps: [
      {
        target: 'my:panel',
        titleKey: 'coach.guide.my.cabinet.s1.title',
        bodyKey: 'coach.guide.my.cabinet.s1.body',
      },
    ],
  }),

  ...EXTRA_COACH_GUIDES,
]

/** Разделы, у которых обязан быть хотя бы один гид (не deprecated). */
export const COACH_REQUIRED_VIEWS: ViewId[] = [
  'month',
  'hr',
  'hr_inspector',
  'finance',
  'warehouse',
  'production',
  'planner',
  'director',
  'procurement',
  'technologist',
  'mixer',
  'directories',
  'journals',
  'settings',
  'summary',
  'my',
  'meals',
  'it',
  'engineer_log',
  'tasks',
]

export function guidesForView(view: string, allowedViews?: string[]): CoachGuide[] {
  const allowed = allowedViews?.length ? new Set(allowedViews) : null
  return COACH_GUIDES.filter((g) => {
    if (g.global) return true
    if (allowed && !allowed.has(g.view)) return false
    return g.view === view
  })
}

export function findGuide(id: string): CoachGuide | undefined {
  return COACH_GUIDES.find((g) => g.id === id)
}

export function guideViews(): ViewId[] {
  return [...new Set(COACH_GUIDES.map((g) => g.view))]
}
