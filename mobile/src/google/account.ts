import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes
} from '@react-native-google-signin/google-signin'

/** The full Drive scope (plan decision D6): files made by the PC's client must be visible here. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

/**
 * The Web OAuth client id of the Google Cloud project, optional for this app: the Android client
 * (package name plus signing-key SHA-1) is what lets the sign-in work. Read from the environment,
 * never typed in code.
 */
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_OSTLER_GOOGLE_WEB_CLIENT_ID

export type SignInResult =
  | { status: 'signed-in'; email: string }
  | { status: 'cancelled' }
  | { status: 'no-play-services' }
  | { status: 'failed' }

let configured = false

function configure(): void {
  if (configured) return
  GoogleSignin.configure({
    scopes: [DRIVE_SCOPE],
    ...(WEB_CLIENT_ID ? { webClientId: WEB_CLIENT_ID } : {})
  })
  configured = true
}

/** Opens Google's account chooser. Google Play services keeps the account; Ostler keeps nothing. */
export async function signIn(): Promise<SignInResult> {
  configure()
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
    const response = await GoogleSignin.signIn()
    if (response.type !== 'success') return { status: 'cancelled' }
    return { status: 'signed-in', email: response.data.user.email }
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { status: 'no-play-services' }
    }
    return { status: 'failed' }
  }
}

export async function signOut(): Promise<void> {
  configure()
  await GoogleSignin.signOut()
}

/**
 * The signed-in account's email, or null. Restores a session Google Play services still holds, so
 * the person stays signed in across app starts.
 */
export async function currentAccount(): Promise<string | null> {
  configure()
  const live = GoogleSignin.getCurrentUser()
  if (live) return live.user.email
  if (!GoogleSignin.hasPreviousSignIn()) return null
  try {
    const response = await GoogleSignin.signInSilently()
    return response.type === 'success' ? response.data.user.email : null
  } catch {
    return null
  }
}

/**
 * The library refuses a second token call while one is running (ASYNC_OP_IN_PROGRESS), and sync
 * makes several Drive requests at once. So every caller waits on the same call, and calls to
 * Google go one at a time.
 */
let inFlight: Promise<string | null> | null = null
let queue: Promise<unknown> = Promise.resolve()

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => undefined)
  return next
}

/** A fresh access token (Google Play services refreshes it), or null when sign-in is needed. */
export function accessToken(): Promise<string | null> {
  configure()
  inFlight ??= oneAtATime(async () => {
    try {
      const tokens = await GoogleSignin.getTokens()
      return tokens.accessToken || null
    } catch {
      return null
    }
  }).finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Forget a token Google refused, so `accessToken()` returns a new one. */
export function discardToken(token: string): Promise<void> {
  configure()
  return oneAtATime(async () => {
    try {
      await GoogleSignin.clearCachedAccessToken(token)
    } catch {
      // Nothing cached: the next getTokens() fetches anyway.
    }
  })
}
