/**
 * Банки Грузии и работа с IBAN.
 * Источник кодов: Национальный банк Грузии (nbg.gov.ge/payment-system/iban).
 * Грузинский IBAN: GE + 2 контрольные цифры + 2 буквы (код банка) + 16 цифр = 22 символа.
 */

export type GeorgianBank = {
  /** Двухбуквенный код банка внутри IBAN (позиции 5–6). */
  code: string
  /** SWIFT/BIC. */
  bic: string
  nameRu: string
  nameKa: string
}

export const GEORGIAN_BANKS: GeorgianBank[] = [
  { code: 'BG', bic: 'BAGAGE22', nameRu: 'Банк Грузии', nameKa: 'საქართველოს ბანკი' },
  { code: 'TB', bic: 'TBCBGE22', nameRu: 'ТиБиСи Банк', nameKa: 'თიბისი ბანკი' },
  { code: 'LB', bic: 'LBRTGE22', nameRu: 'Либерти Банк', nameKa: 'ლიბერთი ბანკი' },
  { code: 'CD', bic: 'JSCRGE22', nameRu: 'Кредо Банк', nameKa: 'კრედო ბანკი' },
  { code: 'PC', bic: 'MIBGGE22', nameRu: 'ПроКредит Банк', nameKa: 'პროკრედიტ ბანკი' },
  { code: 'BS', bic: 'CBASGE22', nameRu: 'Базисбанк', nameKa: 'ბაზისბანკი' },
  { code: 'CR', bic: 'CRTUGE22', nameRu: 'Банк Карту', nameKa: 'ბანკი ქართუ' },
  { code: 'KS', bic: 'TEBAGE22', nameRu: 'Терабанк', nameKa: 'ტერაბანკი' },
  { code: 'HB', bic: 'HABGGE22', nameRu: 'Халик Банк Грузия', nameKa: 'ხალიკ ბანკი საქართველო' },
  { code: 'BT', bic: 'DISNGE22', nameRu: 'Силк Банк', nameKa: 'სილქ ბანკი' },
  { code: 'VT', bic: 'UGEBGE22', nameRu: 'ВТБ Банк Джорджия', nameKa: 'ვითიბი ბანკი ჯორჯია' },
  { code: 'ZB', bic: 'TCZBGE22', nameRu: 'Зираат Банк Грузия', nameKa: 'ზირაათ ბანკი საქართველო' },
  { code: 'PB', bic: 'PAHAGE22', nameRu: 'ПАША Банк Грузия', nameKa: 'პაშა ბანკი საქართველო' },
  { code: 'IS', bic: 'ISBKGE22', nameRu: 'Ишбанк Грузия', nameKa: 'იშბანკი საქართველო' },
  { code: 'PS', bic: 'PSRAGE22', nameRu: 'Пейсера Банк Грузия', nameKa: 'პეისერა ბანკი' },
  { code: 'HS', bic: 'HAJSGE22', nameRu: 'Хеш Банк', nameKa: 'ჰეშ ბანკი' },
  { code: 'PV', bic: 'PAVEGE22', nameRu: 'Пейв Банк Джорджия', nameKa: 'პეივ ბანკ ჯორჯია' },
  { code: 'MB', bic: 'MOMBGE22', nameRu: 'Микробанк ЭмБиСи', nameKa: 'მიკრობანკი ემბისი' },
  { code: 'BC', bic: 'BCRYGE22', nameRu: 'Микробанк Кристал', nameKa: 'მიკრობანკი კრისტალი' },
  { code: 'TR', bic: 'TRESGE22', nameRu: 'Казначейство (Минфин)', nameKa: 'სახაზინო სამსახური' },
  { code: 'NB', bic: 'BNLNGE22', nameRu: 'Национальный банк Грузии', nameKa: 'საქართველოს ეროვნული ბანკი' },
]

const BANK_BY_CODE = new Map(GEORGIAN_BANKS.map((b) => [b.code, b]))

/** Нормализует IBAN: убирает пробелы, в верхний регистр. */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

/** Форматирует IBAN группами по 4 символа для отображения. */
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})/g, '$1 ').trim()
}

/** Определяет банк по IBAN (по 2 буквам кода). */
export function detectBankFromIban(raw: string): GeorgianBank | null {
  const iban = normalizeIban(raw)
  if (!iban.startsWith('GE') || iban.length < 6) return null
  const code = iban.slice(4, 6)
  return BANK_BY_CODE.get(code) ?? null
}

export function bankByCode(code: string | undefined): GeorgianBank | null {
  if (!code) return null
  return BANK_BY_CODE.get(code) ?? null
}

export function bankName(code: string | undefined, locale: 'ru' | 'ka'): string {
  const b = bankByCode(code)
  if (!b) return code ?? ''
  return locale === 'ka' ? b.nameKa : b.nameRu
}

/** Контрольная сумма IBAN по стандарту mod-97 (ISO 13616/7064). */
function iban97Valid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0)
    const value =
      code >= 65 && code <= 90 ? (code - 55).toString() : ch // A-Z → 10..35
    for (const digit of value) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97
    }
  }
  return remainder === 1
}

export type IbanCheck = {
  ok: boolean
  /** Код ошибки для локализации, если ok=false. */
  errorKey?: string
  bank?: GeorgianBank | null
}

/**
 * Проверка грузинского IBAN: длина 22, страна GE, контрольная сумма,
 * банковский код из официального списка, тело — 16 цифр.
 */
export function checkGeorgianIban(raw: string): IbanCheck {
  const iban = normalizeIban(raw)
  if (!iban) return { ok: false, errorKey: 'hr.bank.ibanEmpty' }
  if (!/^GE\d{2}[A-Z]{2}\d{16}$/.test(iban)) {
    return { ok: false, errorKey: 'hr.bank.ibanFormat' }
  }
  const bank = detectBankFromIban(iban)
  if (!bank) return { ok: false, errorKey: 'hr.bank.ibanBank' }
  if (!iban97Valid(iban)) return { ok: false, errorKey: 'hr.bank.ibanChecksum' }
  return { ok: true, bank }
}
