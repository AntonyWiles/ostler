import { MIN_COLUMN_WIDTH, tableColumnWidth } from '../src/screens/tableLayout'

describe('tableColumnWidth', () => {
  it('shares the width evenly when every column has room', () => {
    expect(tableColumnWidth(2, 360)).toBe(180)
  })

  it('never squeezes a column under the minimum, however many there are', () => {
    for (const columns of [3, 5, 8, 20]) {
      expect(tableColumnWidth(columns, 360)).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH)
    }
  })

  it('keeps the minimum before the table has been measured', () => {
    expect(tableColumnWidth(4, 0)).toBe(MIN_COLUMN_WIDTH)
  })

  it('leaves room for at least a dozen letters at the table text size', () => {
    // 13pt text runs about 7pt a letter.
    expect(MIN_COLUMN_WIDTH).toBeGreaterThanOrEqual(12 * 7)
  })
})
