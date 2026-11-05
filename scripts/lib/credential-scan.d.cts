export function credentialReason(text: string): string | null
export function localSecrets(root: string): Array<[string, string]>
export function scanBuffer(buffer: Buffer, secrets: Array<[string, string]>): string[]
export function readZipEntry(zipFile: string, name: string): Buffer | null
