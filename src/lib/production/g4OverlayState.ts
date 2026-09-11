/** Preserve G3 activation across G4 acknowledgements from older servers. */
export function resolveG3ProductionDomainActive(
  legacyProduction: Record<string, unknown>,
  acknowledgedProductionActive: boolean | undefined,
): boolean {
  if (acknowledgedProductionActive !== undefined) return acknowledgedProductionActive === true
  return legacyProduction.g3ProductionDomainActive === true
}
