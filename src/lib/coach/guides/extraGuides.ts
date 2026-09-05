import type { CoachGuide } from './types'
import { makeActionGuide, makeTabGuide } from './makeTabGuide'

/**
 * Дополнительные гиды по всем крупным вкладкам / CTA,
 * которых нет в «ядерном» catalog (месяц, ключевые сценарии).
 * Новая вкладка раздела → сюда + i18n coach.guide.*
 */
export const EXTRA_COACH_GUIDES: CoachGuide[] = [
  // ─── HR остальные вкладки ─────────────────────────────
  makeTabGuide({ view: 'hr', slug: 'documents', tabId: 'documents' }),
  makeTabGuide({ view: 'hr', slug: 'trainings', tabId: 'trainings' }),
  makeTabGuide({ view: 'hr', slug: 'pay', tabId: 'pay' }),
  makeTabGuide({ view: 'hr', slug: 'reports', tabId: 'reports' }),
  makeTabGuide({ view: 'hr', slug: 'settingsTab', tabId: 'settings' }),
  makeTabGuide({ view: 'hr', slug: 'fired', tabId: 'fired' }),
  makeTabGuide({ view: 'hr', slug: 'trash', tabId: 'trash' }),
  makeActionGuide({ view: 'hr', slug: 'openTrash', target: 'hr:openTrash' }),
  {
    id: 'hr.anketa',
    view: 'hr',
    titleKey: 'coach.guide.hr.anketa.title',
    blurbKey: 'coach.guide.hr.anketa.blurb',
    steps: [
      {
        target: 'nav:hr',
        titleKey: 'coach.guide.nav.hr.title',
        bodyKey: 'coach.guide.nav.hr.body',
      },
      {
        target: 'hr:tabCandidates',
        titleKey: 'coach.guide.hr.anketa.s1.title',
        bodyKey: 'coach.guide.hr.anketa.s1.body',
      },
      {
        target: 'hr:anketaOpen',
        titleKey: 'coach.guide.hr.anketa.s2.title',
        bodyKey: 'coach.guide.hr.anketa.s2.body',
      },
      {
        target: 'hr:anketaForm',
        titleKey: 'coach.guide.hr.anketa.s3.title',
        bodyKey: 'coach.guide.hr.anketa.s3.body',
        minDepth: 'guided',
      },
      {
        target: 'hr:anketaAddQuestion',
        titleKey: 'coach.guide.hr.anketa.s4.title',
        bodyKey: 'coach.guide.hr.anketa.s4.body',
        minDepth: 'full',
      },
      {
        target: 'hr:anketaSave',
        titleKey: 'coach.guide.hr.anketa.s5.title',
        bodyKey: 'coach.guide.hr.anketa.s5.body',
        minDepth: 'full',
      },
      {
        target: 'hr:anketaPrint',
        titleKey: 'coach.guide.hr.anketa.s6.title',
        bodyKey: 'coach.guide.hr.anketa.s6.body',
        minDepth: 'full',
      },
    ],
  },

  // ─── Финансы ──────────────────────────────────────────
  makeTabGuide({ view: 'finance', slug: 'dashboard', tabId: 'dashboard' }),
  makeTabGuide({ view: 'finance', slug: 'payments', tabId: 'payments' }),
  makeTabGuide({ view: 'finance', slug: 'vacation', tabId: 'vacation' }),
  makeTabGuide({ view: 'finance', slug: 'ledger', tabId: 'ledger' }),
  makeTabGuide({ view: 'finance', slug: 'employees', tabId: 'employees' }),
  makeTabGuide({ view: 'finance', slug: 'org', tabId: 'org' }),

  // ─── Склад доп. вкладки ───────────────────────────────
  makeTabGuide({ view: 'warehouse', slug: 'requests', tabId: 'requests' }),
  makeTabGuide({ view: 'warehouse', slug: 'nomenclature', tabId: 'nomenclature' }),
  makeTabGuide({ view: 'warehouse', slug: 'workwear', tabId: 'workwear' }),
  makeTabGuide({ view: 'warehouse', slug: 'analytics', tabId: 'analytics' }),
  makeTabGuide({ view: 'warehouse', slug: 'importTab', tabId: 'import' }),
  makeTabGuide({ view: 'warehouse', slug: 'audit', tabId: 'audit' }),
  makeActionGuide({
    view: 'warehouse',
    slug: 'addProduct',
    target: 'warehouse:addProduct',
  }),
  makeActionGuide({
    view: 'warehouse',
    slug: 'technicalName',
    target: 'warehouse:technicalName',
  }),

  // ─── Производство ─────────────────────────────────────
  makeTabGuide({ view: 'production', slug: 'journal', tabId: 'journal' }),
  makeTabGuide({ view: 'production', slug: 'summaryTab', tabId: 'summary' }),

  // ─── Планировщик ──────────────────────────────────────
  makeTabGuide({ view: 'planner', slug: 'calendar', tabId: 'calendar' }),
  makeTabGuide({ view: 'planner', slug: 'reports', tabId: 'reports' }),
  makeTabGuide({ view: 'planner', slug: 'materials', tabId: 'materials' }),

  // ─── Дирекция ─────────────────────────────────────────
  makeTabGuide({ view: 'director', slug: 'dashboard', tabId: 'dashboard' }),
  makeTabGuide({ view: 'director', slug: 'queue', tabId: 'queue' }),
  makeTabGuide({ view: 'director', slug: 'planning', tabId: 'planning' }),
  makeActionGuide({
    view: 'director',
    slug: 'command',
    target: 'director:command',
  }),

  // ─── Закупки ──────────────────────────────────────────
  makeTabGuide({ view: 'procurement', slug: 'tracking', tabId: 'tracking' }),
  makeTabGuide({ view: 'procurement', slug: 'containers', tabId: 'containers' }),
  makeTabGuide({ view: 'procurement', slug: 'stock', tabId: 'stock' }),
  makeTabGuide({ view: 'procurement', slug: 'analytics', tabId: 'analytics' }),
  makeTabGuide({
    view: 'procurement',
    slug: 'newOrder',
    tabId: 'orders',
    action: { target: 'procurement:newOrder', stepKey: 's2' },
  }),

  // ─── Технолог ─────────────────────────────────────────
  makeTabGuide({ view: 'technologist', slug: 'stock', tabId: 'stock' }),
  makeTabGuide({ view: 'technologist', slug: 'mixerTab', tabId: 'mixer' }),
  makeTabGuide({ view: 'technologist', slug: 'tasks', tabId: 'tasks' }),
  makeTabGuide({ view: 'technologist', slug: 'wastewater', tabId: 'wastewater' }),
  makeTabGuide({ view: 'technologist', slug: 'journal', tabId: 'journal' }),
  makeTabGuide({ view: 'technologist', slug: 'qc', tabId: 'qc' }),
  makeTabGuide({
    view: 'technologist',
    slug: 'qcEadCalc',
    tabId: 'qc',
    action: { target: 'technologistQc:tabEadCalc', stepKey: 's2' },
  }),

  // ─── IT-офис ──────────────────────────────────────────
  makeTabGuide({
    view: 'it',
    slug: 'registry',
    tabId: 'registry',
    action: { target: 'it:addAsset', stepKey: 's2' },
  }),
  makeTabGuide({ view: 'it', slug: 'acts', tabId: 'acts' }),
  makeTabGuide({ view: 'it', slug: 'printers', tabId: 'printers' }),
  makeTabGuide({ view: 'it', slug: 'maintenance', tabId: 'maintenance' }),
  makeTabGuide({ view: 'it', slug: 'consumables', tabId: 'consumables' }),
  makeTabGuide({ view: 'it', slug: 'catalog', tabId: 'catalog' }),
  makeTabGuide({ view: 'it', slug: 'reports', tabId: 'reports' }),

  // ─── Инспектор кадров ─────────────────────────────────
  makeTabGuide({ view: 'hr_inspector', slug: 'dashboard', tabId: 'dashboard' }),
  makeTabGuide({ view: 'hr_inspector', slug: 'fired', tabId: 'fired' }),
  {
    id: 'hr_inspector.employees',
    view: 'hr_inspector',
    titleKey: 'coach.guide.hr_inspector.employees.title',
    blurbKey: 'coach.guide.hr_inspector.employees.blurb',
    steps: [
      {
        target: 'nav:hr_inspector',
        titleKey: 'coach.guide.nav.hr_inspector.title',
        bodyKey: 'coach.guide.nav.hr_inspector.body',
      },
      {
        target: 'hr_inspector:tabEmployees',
        titleKey: 'coach.guide.hr_inspector.employees.s1.title',
        bodyKey: 'coach.guide.hr_inspector.employees.s1.body',
      },
      {
        target: 'hr_inspector:addEmployee',
        titleKey: 'coach.guide.hr_inspector.employees.s2.title',
        bodyKey: 'coach.guide.hr_inspector.employees.s2.body',
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
  },
  makeTabGuide({ view: 'hr_inspector', slug: 'documents', tabId: 'documents' }),
  makeTabGuide({ view: 'hr_inspector', slug: 'trainings', tabId: 'trainings' }),
  makeTabGuide({ view: 'hr_inspector', slug: 'absences', tabId: 'absences' }),
  makeTabGuide({ view: 'hr_inspector', slug: 'foreign', tabId: 'foreign' }),
  makeTabGuide({ view: 'hr_inspector', slug: 'attendance', tabId: 'attendance' }),

  // ─── Журнал инженера ──────────────────────────────────
  makeActionGuide({
    view: 'engineer_log',
    slug: 'newIssue',
    target: 'engineer_log:newIssue',
  }),
  makeActionGuide({
    view: 'engineer_log',
    slug: 'addFull',
    target: 'engineer_log:addFull',
  }),

  // ─── Справочники: основные вкладки ────────────────────
  makeTabGuide({ view: 'directories', slug: 'counterparties', tabId: 'counterparties' }),
  makeTabGuide({ view: 'directories', slug: 'brigades', tabId: 'brigades' }),
  makeTabGuide({ view: 'directories', slug: 'positions', tabId: 'positions' }),
  makeTabGuide({ view: 'directories', slug: 'employeesDir', tabId: 'employees' }),
  makeTabGuide({ view: 'directories', slug: 'nomenclature', tabId: 'nomenclature' }),
  makeTabGuide({ view: 'directories', slug: 'finishedProducts', tabId: 'finishedProducts' }),
  makeActionGuide({
    view: 'directories',
    slug: 'finishedProductAdd',
    target: 'directories:finishedProductAdd',
  }),
  makeTabGuide({ view: 'directories', slug: 'formulations', tabId: 'formulations' }),
  makeTabGuide({ view: 'directories', slug: 'packagingRecipes', tabId: 'packagingRecipes' }),
  {
    id: 'directories.packagingMenu',
    view: 'directories',
    titleKey: 'coach.guide.directories.packagingMenu.title',
    blurbKey: 'coach.guide.directories.packagingMenu.blurb',
    steps: [
      {
        target: 'nav:directories',
        titleKey: 'coach.guide.nav.directories.title',
        bodyKey: 'coach.guide.nav.directories.body',
      },
      {
        target: 'directories:tabPackagingRecipes',
        titleKey: 'coach.guide.directories.packagingRecipes.s1.title',
        bodyKey: 'coach.guide.directories.packagingRecipes.s1.body',
      },
      {
        target: 'packaging:tabBoxes',
        titleKey: 'coach.guide.directories.packagingMenu.s1.title',
        bodyKey: 'coach.guide.directories.packagingMenu.s1.body',
      },
      {
        target: 'packaging:addBox',
        titleKey: 'coach.guide.directories.packagingBoxAdd.s1.title',
        bodyKey: 'coach.guide.directories.packagingBoxAdd.s1.body',
      },
    ],
  },
  makeActionGuide({
    view: 'directories',
    slug: 'packagingBoxAdd',
    target: 'packaging:addBox',
  }),
  makeTabGuide({
    view: 'directories',
    slug: 'payAccrual',
    tabId: 'payAccrual',
    action: { target: 'directories:nightLineFixed', stepKey: 's2' },
  }),

  // ─── Планировщик: явная кнопка нового заказа ──────────
  {
    id: 'warehouse.ledgerFlow',
    view: 'warehouse',
    titleKey: 'coach.guide.warehouse.ledgerFlow.title',
    blurbKey: 'coach.guide.warehouse.ledgerFlow.blurb',
    steps: [
      {
        target: 'nav:warehouse',
        titleKey: 'coach.guide.nav.warehouse.title',
        bodyKey: 'coach.guide.nav.warehouse.body',
      },
      {
        target: 'warehouse:flowNomenclature',
        titleKey: 'coach.guide.warehouse.ledgerFlow.s1.title',
        bodyKey: 'coach.guide.warehouse.ledgerFlow.s1.body',
      },
      {
        target: 'warehouse:flowDocuments',
        titleKey: 'coach.guide.warehouse.ledgerFlow.s2.title',
        bodyKey: 'coach.guide.warehouse.ledgerFlow.s2.body',
      },
      {
        target: 'warehouse:flowMovements',
        titleKey: 'coach.guide.warehouse.ledgerFlow.s3.title',
        bodyKey: 'coach.guide.warehouse.ledgerFlow.s3.body',
      },
    ],
  },
  makeActionGuide({
    view: 'planner',
    slug: 'newOrderBtn',
    target: 'planner:newOrder',
  }),
  makeActionGuide({
    view: 'meals',
    slug: 'order',
    target: 'meals:save',
  }),
  makeActionGuide({
    view: 'meals',
    slug: 'accept',
    target: 'meals:acceptDay',
  }),
  makeActionGuide({
    view: 'meals',
    slug: 'repeatWeek',
    target: 'meals:repeatWeek',
  }),
  makeActionGuide({
    view: 'meals',
    slug: 'publishWeek',
    target: 'meals:publishWeek',
  }),
  makeActionGuide({
    view: 'meals',
    slug: 'addAdvance',
    target: 'meals:addAdvance',
  }),
  // ─── Задачи (канбан) ───────────────────────────────────
  makeTabGuide({ view: 'tasks', slug: 'my', tabId: 'my', tabPrefix: 'tasks' }),
  makeTabGuide({ view: 'tasks', slug: 'summary', tabId: 'summary', tabPrefix: 'tasks' }),
  makeActionGuide({ view: 'tasks', slug: 'boardAdd', target: 'tasks:boardAdd' }),
  makeActionGuide({ view: 'planner', slug: 'linkCreate', target: 'tasks:linkCreate' }),
  makeActionGuide({ view: 'warehouse', slug: 'linkCreate', target: 'tasks:linkCreate' }),
]
