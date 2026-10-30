export function brandValue(brandSource: string, key: string): string
export function checkBrand(
  packageJson: {
    author?: string | { name?: string }
    build?: {
      productName?: string
      appId?: string
      protocols?: { name?: string; schemes?: string[] }[]
      publish?: { provider: string; owner?: string; repo?: string }[]
    }
  },
  brandSource: string,
  installerNsh?: string | null
): string[]
