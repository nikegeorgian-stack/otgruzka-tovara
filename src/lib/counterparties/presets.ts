import {
  findA2LineCounterparty,
  seedA2LineCounterparty,
} from './init'

export const A2LINE_COUNTERPARTY_NAME = 'A2LINE'

export { findA2LineCounterparty }

/** Создать заказчика A2LINE, если его ещё нет в справочнике */
export function buildA2LineCounterparty(existing: import('./types').Counterparty[]) {
  return seedA2LineCounterparty(existing)
}
