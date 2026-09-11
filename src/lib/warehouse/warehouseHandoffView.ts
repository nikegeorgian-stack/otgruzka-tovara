export function canViewWarehouseCanonicalHandoff(
  webWarehouseMode: boolean,
  currentUser?: { roleId?: string } | null,
): boolean {
  return (
    webWarehouseMode &&
    (currentUser?.roleId === 'warehouse_keeper' || currentUser?.roleId === 'sysadmin')
  )
}
