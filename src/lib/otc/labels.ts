import type { Locale } from '@/i18n/types'
import type {
  OtcDefectStage,
  OtcDefectStatus,
  OtcPassStatus,
  OtcProductKind,
  OtcTestKind,
} from './types'

export const OTC_PRODUCT_KINDS: OtcProductKind[] = ['mesh', 'rooflex', 'membrane']

export const OTC_TEST_KINDS: OtcTestKind[] = [
  'alkali_resistance',
  'tensile_strength',
  'mass_per_area',
  'mesh_size',
  'loss_on_ignition',
  'fabric_width',
  'threads_per_10cm',
  'water_resistance_w1',
]

/** Какие испытания доступны для вида продукции */
export function testKindsForProduct(kind: OtcProductKind): OtcTestKind[] {
  switch (kind) {
    case 'mesh':
      return [
        'tensile_strength',
        'mass_per_area',
        'mesh_size',
        'loss_on_ignition',
      ]
    case 'rooflex':
      return ['tensile_strength', 'fabric_width', 'threads_per_10cm', 'mass_per_area']
    case 'membrane':
      return ['water_resistance_w1', 'mass_per_area', 'tensile_strength']
    default:
      return ['tensile_strength']
  }
}

export function productKindLabel(kind: OtcProductKind, locale: Locale): string {
  const ru: Record<OtcProductKind, string> = {
    mesh: 'Сетка',
    rooflex: 'Руфлекс',
    membrane: 'Мембрана',
  }
  const ka: Record<OtcProductKind, string> = {
    mesh: 'ბადე',
    rooflex: 'რუფლექსი',
    membrane: 'მემბრანა',
  }
  return locale === 'ka' ? ka[kind] : ru[kind]
}

export function testKindLabel(kind: OtcTestKind, locale: Locale): string {
  const ru: Record<OtcTestKind, string> = {
    alkali_resistance: 'Щёлочестойкость',
    tensile_strength: 'Прочность на разрыв',
    mass_per_area: 'Масса на ед. площади',
    mesh_size: 'Размер ячейки',
    loss_on_ignition: 'Потери при прокаливании',
    fabric_width: 'Ширина полотна',
    threads_per_10cm: 'Нитей на 10 см',
    water_resistance_w1: 'Водостойкость W1',
  }
  const ka: Record<OtcTestKind, string> = {
    alkali_resistance: 'ტუტეგამძლეობა',
    tensile_strength: 'გაჭიმვის სიმტკიცე',
    mass_per_area: 'მასა ფართობზე',
    mesh_size: 'უჯრის ზომა',
    loss_on_ignition: 'დანაკარგი წვაზე',
    fabric_width: 'ქსოვილის სიგანე',
    threads_per_10cm: 'ძაფები 10 სმ-ზე',
    water_resistance_w1: 'წყალგამძლეობა W1',
  }
  return locale === 'ka' ? ka[kind] : ru[kind]
}

export function passStatusLabel(status: OtcPassStatus, locale: Locale): string {
  if (locale === 'ka') {
    if (status === 'pass') return 'შესაბამისი'
    if (status === 'fail') return 'არ შეესაბამება'
    return 'მოლოდინში'
  }
  if (status === 'pass') return 'Соответствует'
  if (status === 'fail') return 'Не соответствует'
  return 'Ожидает'
}

export function defectStatusLabel(status: OtcDefectStatus, locale: Locale): string {
  const ru = { open: 'Открыт', in_progress: 'В работе', closed: 'Закрыт' }
  const ka = { open: 'ღია', in_progress: 'მუშავდება', closed: 'დახურული' }
  return locale === 'ka' ? ka[status] : ru[status]
}

export function defectStageLabel(stage: OtcDefectStage, locale: Locale): string {
  const ru = { greige: 'Суровьё', finished: 'Готовая продукция', other: 'Прочее' }
  const ka = { greige: 'ნედლეული', finished: 'მზა პროდუქცია', other: 'სხვა' }
  return locale === 'ka' ? ka[stage] : ru[stage]
}

/** Сжать фото для хранения в сторе (data URL). */
export function compressImageFile(file: File, maxEdge = 1280, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('img'))
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(String(reader.result))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
