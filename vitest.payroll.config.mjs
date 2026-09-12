import { fileURLToPath } from 'node:url'

// Requires Vitest 3.2.4 and jsdom 26.1.0 in the verification environment.
export default {
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    maxWorkers: 1,
    pool: 'forks',
    isolate: true,
    include: [
      'tests/payrollIntegrity.test.ts',
      'tests/timesheetIntegrity.test.ts',
      'tests/timesheetDraftRecovery.test.tsx',
      'tests/timesheetEntries.test.ts',
      'tests/timesheetScope.test.ts',
      'tests/timesheetCellSave.test.ts',
      'tests/vacationOvertimeDelta.test.ts',
      'tests/salaryBonusPremium.test.ts',
      'tests/brigadierPay.test.ts',
      'tests/nightLineBonus.test.ts',
      'tests/vacationNormHours.test.ts',
      'tests/holidaySchedules.test.ts',
      'tests/nightShiftDocument.test.ts',
      'tests/cloudMerge.employeeTrash.test.ts',
      'tests/brigadesUndefinedGuard.test.ts',
      'tests/s1s8IsolatedFixture.test.ts',
    ],
  },
}
