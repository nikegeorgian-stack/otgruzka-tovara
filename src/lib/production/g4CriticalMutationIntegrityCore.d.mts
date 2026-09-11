export type G4CriticalMutationCommandType =
  | 'qc.review.start'
  | 'qc.release'
  | 'qc.regrade'
  | 'qc.reject'
  | 'qc.scrap.writeoff'
  | 'shipment.post'
  | 'shipment.cancel'

export const G4_CRITICAL_MUTATION_COMMANDS: readonly G4CriticalMutationCommandType[]
export function isG4CriticalMutationCommand(
  commandType: unknown,
): commandType is G4CriticalMutationCommandType
export function canonicalG4CriticalMutationCommand(
  commandType: G4CriticalMutationCommandType,
  command: unknown,
): unknown
export function stableG4CriticalMutationJson(
  commandType: G4CriticalMutationCommandType,
  command: unknown,
): string
export function g4CriticalMutationCommandFingerprint(
  commandType: G4CriticalMutationCommandType,
  command: unknown,
): string
