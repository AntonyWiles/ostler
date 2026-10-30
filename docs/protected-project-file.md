# Protected project files

A project file exported with **Protect with a password** keeps the `.ostler-project`
name and holds the ordinary project file, the zip described in
[Import and export](user-guide/11-import-and-export.md), encrypted whole. The code is
`electron/services/protected-project-file.ts`.

## Layout

| Offset   | Size | Field                                                    |
| -------- | ---- | -------------------------------------------------------- |
| 0        | 8    | Magic: ASCII `OSTLRENC`                                  |
| 8        | 1    | Format version: `1`                                      |
| 9        | 4    | scrypt `N` (unsigned 32-bit, big-endian; a power of two) |
| 13       | 4    | scrypt `r` (unsigned 32-bit, big-endian)                 |
| 17       | 4    | scrypt `p` (unsigned 32-bit, big-endian)                 |
| 21       | 16   | Salt (random for each export)                            |
| 37       | 12   | Nonce (random for each export)                           |
| 49       | …    | The zip, encrypted with AES-256-GCM                      |
| end − 16 | 16   | The GCM authentication tag                               |

The password is at least 8 characters. The key is `scrypt(password, salt, 32 bytes, { N, r, p })`,
with the password in Unicode NFC. The
whole 49-byte header is the cipher's associated data, so changing a byte of the header, the body or
the tag makes the tag check fail. Export uses `N = 2^17`, `r = 8`, `p = 1` (about 128 MB of
memory).

## Reading one

- A file is protected when it starts with the magic (or `NEXUSENC`, written by builds from before
  the rename); anything else is read as an ordinary project file.
- The header is hostile: Ostler refuses a version it does not know and scrypt parameters outside
  `2^14 ≤ N ≤ 2^20` (a power of two), `1 ≤ r ≤ 16`, `1 ≤ p ≤ 4` and `128 × N × r ≤ 256 MB`, before
  deriving any key.
- Encryption and decryption stream in 1 MB chunks: the file is never in memory whole. Decryption
  writes to a new file under the data folder, and only once the tag checks out is that file
  unpacked, through the same hostile-file checks as any project file. The decrypted file is
  removed whatever happens.
- A wrong password, a refused header and a damaged file give the same message: "This password does
  not open the file, or the file is damaged."
- The password is never stored, logged or put in an error. There is no recovery and no hint.
