import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  batchMixCanonicalCommandJson,
  batchMixCommandFingerprint,
  sha256Utf8,
} from '@/lib/formulations/batchMixFingerprint.mjs'

describe('R3.1C batch mixer canonical SHA-256', () => {
  it.each(['', 'abc', 'Пропитка 🧪', 'x'.repeat(1000)])(
    'matches the Node SHA-256 reference for %j',
    (value) => {
      expect(sha256Utf8(value)).toBe(
        createHash('sha256').update(value, 'utf8').digest('hex'),
      )
    },
  )

  it('canonicalizes object keys and ignores undefined fields', () => {
    const left = {
      z: 1,
      a: { y: 2, x: undefined },
      lines: [{ b: 2, a: 1 }],
    }
    const right = {
      lines: [{ a: 1, b: 2 }],
      a: { y: 2 },
      z: 1,
    }
    expect(batchMixCanonicalCommandJson(left)).toBe(batchMixCanonicalCommandJson(right))
    expect(batchMixCommandFingerprint(left)).toBe(batchMixCommandFingerprint(right))
    expect(batchMixCommandFingerprint(left)).toMatch(
      /^batch-mix:v2:sha256:[a-f0-9]{64}$/,
    )
  })

  it('changes for any semantic payload change', () => {
    const original = {
      batchRunId: 'run-1',
      receiptLines: [{ itemId: 'impregnation-kg', quantity: 100 }],
    }
    expect(
      batchMixCommandFingerprint({
        ...original,
        receiptLines: [{ itemId: 'impregnation-kg', quantity: 101 }],
      }),
    ).not.toBe(batchMixCommandFingerprint(original))
  })
})
