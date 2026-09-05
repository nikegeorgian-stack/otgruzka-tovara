import { describe, expect, it } from 'vitest'
import { personalPushKind } from '@/lib/cloud/fstPushNotify'

describe('personalPushKind', () => {
  it('maps status codes a person should be told about', () => {
    expect(personalPushKind('Б')).toBe('sick')
    expect(personalPushKind('ОТ')).toBe('vacation')
    expect(personalPushKind('В')).toBe('rest')
    expect(personalPushKind('ОО')).toBe('unpaid')
    expect(personalPushKind('ПР')).toBe('idle')
    expect(personalPushKind('X')).toBe('violation')
    expect(personalPushKind('Н')).toBe('night')
  })

  it('does not notify on ordinary shift hours', () => {
    expect(personalPushKind('8')).toBeNull()
    expect(personalPushKind('11')).toBeNull()
    expect(personalPushKind('')).toBeNull()
  })
})
