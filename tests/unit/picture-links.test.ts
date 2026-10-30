import { describe, expect, it } from 'vitest'
import { extractPictureLinks } from '@shared/item-links'

const P = 'ee92d4b8-5002-4fd4-b7c3-561d5244edd7'
const A = '95d18770-1862-4e4c-82d4-40417403cead'
const B = '234d74b9-bb7c-4136-9840-42d89b91807b'
const C = '1b8cf1be-21b4-4c72-b2d6-3118b4e101fe'
const T = 'dc1ecbbf-71b6-4c96-907c-120e30bcd072'

describe('extractPictureLinks', () => {
  it('finds the Library pictures a description shows, once each', () => {
    const text = [
      'Before',
      `![Pasted picture](ostler://library/${P}/${A})`,
      `A [link](ostler://library/${P}/${B}), not a picture`,
      `![again](ostler://library/${P}/${A}) ![task](ostler://task/${P}/${T})`,
      `![old name](nexus-dashboard://library/${P}/${C})`
    ].join('\n')
    expect(extractPictureLinks(text, 'ostler')).toEqual([
      { kind: 'library', projectId: P, id: A },
      { kind: 'library', projectId: P, id: C }
    ])
  })

  it('finds nothing in plain text', () => {
    expect(extractPictureLinks('no pictures here', 'ostler')).toEqual([])
  })
})
