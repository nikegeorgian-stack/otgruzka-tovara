import type { ItActType, ItAsset, ItAssetKind, ItHandoverAct } from './types'

const KIND_FOLDER: Record<ItAssetKind, string> = {
  laptop: 'Ноутбуки',
  tablet: 'Планшеты',
  printer: 'Принтеры',
  monitor: 'Мониторы',
  phone: 'Телефоны',
  ups: 'ИБП',
  router: 'Сеть',
  switch: 'Сеть',
  projector: 'Проекторы',
  scanner: 'Сканеры',
  keyboard: 'Периферия',
  mouse: 'Периферия',
  headset: 'Периферия',
  webcam: 'Периферия',
  docking: 'Док-станции',
  other: 'Прочее',
}

const ACT_FOLDER: Record<ItActType, string> = {
  issue: 'Выдача',
  return: 'Возврат',
  transfer: 'Передача',
  write_off: 'Списание',
}

export function assetFolderPath(asset: ItAsset): string {
  const kind = KIND_FOLDER[asset.kind] ?? 'Прочее'
  const year = (asset.purchaseDate ?? asset.createdAt).slice(0, 4)
  return `IT/Техника/${kind}/${year}/${asset.inventoryNo}`
}

export function actFolderPath(act: ItHandoverAct): string {
  const year = act.date.slice(0, 4)
  const type = ACT_FOLDER[act.actType]
  return `IT/Акты/${year}/${type}/${act.number}`
}

export function maintenanceFolderPath(asset: ItAsset): string {
  return `${assetFolderPath(asset)}/Обслуживание`
}

export function consumableFolderPath(specName: string): string {
  const safe = specName.replace(/[/\\?*:|"]/g, '_').trim()
  return `IT/Расходники/${safe}`
}
