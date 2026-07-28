// Google Play receipt validator.
//
// Validates a purchase token against the Google Play Developer API v2
// (androidpublisher subscriptionsv2) using a service-account credential: a
// service-account JWT bearer grant is exchanged for an access token at the OAuth2
// token endpoint, then the subscriptionsv2 endpoint is queried for the
// (packageName, purchaseToken).
//
// SSRF invariant: the OAuth2 token endpoint (from the service-account JSON's
// token_uri) and the androidpublisher host are the ONLY endpoints reached; the
// caller's raw_receipt supplies ONLY the opaque purchase token appended to a
// hardcoded API path.
//
// Fault split: a service-account JSON we cannot parse / lacking auth fields is
// OUR misconfiguration (provider fault, before any fetch). A 404/410 from
// subscriptionsv2 (token not found / expired) is the caller's fault. A token
// exchange auth failure (401) or a 5xx is a provider fault (our credential /
// transient), never the caller's receipt.

import {
  assertNonEmptyProviderId,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  deriveTierFromInterval,
  parseIso8601Period,
  ReceiptValidationError,
  type ReceiptValidationResult,
  type SubscriptionStatus,
  type SubscriptionTier,
  withTimeout,
} from './types.ts'

const ANDROID_PUBLISHER_BASE = 'https://androidpublisher.googleapis.com'
const GOOGLE_AUTH_SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

export interface GoogleDeps {
  serviceAccountJson: string
  packageName: string
  fetchImpl?: typeof fetch
  productTierMap?: Record<string, SubscriptionTier>
  timeoutMs?: number
}

// subscriptionsv2 subscriptionState -> the 5-value receipt enum. An unrecognized
// state is a provider-contract violation (Play returning an undocumented state
// means OUR integration is out of date, not the caller's receipt).
export function mapGoogleStatus(state: string): SubscriptionStatus {
  switch (state) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return 'active'
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
    case 'SUBSCRIPTION_STATE_ON_HOLD':
      return 'past_due'
    case 'SUBSCRIPTION_STATE_CANCELED':
      return 'canceled'
    case 'SUBSCRIPTION_STATE_EXPIRED':
    case 'SUBSCRIPTION_STATE_PAUSED':
      return 'expired'
    case 'SUBSCRIPTION_STATE_PENDING':
      return 'pending'
    default:
      throw new ReceiptValidationError('unrecognized Play subscription state', {
        code: 'provider_contract_violation',
        fault: 'provider',
        status: 502,
      })
  }
}

// Play reports expiryTime as either an RFC-3339 string or a numeric epoch-ms
// string — normalize both to UTC ISO-8601.
export function normalizeGoogleTimestamp(value: string): string {
  if (/^\d+$/.test(value)) {
    return new Date(Number(value)).toISOString()
  }
  return new Date(value).toISOString()
}

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri: string
}

interface LineItem {
  productId?: string
  expiryTime?: string
  billingPeriodDuration?: string
}

interface SubscriptionsV2Response {
  subscriptionState?: string
  lineItems?: LineItem[]
}

export async function validateGoogleReceipt(
  rawReceipt: unknown,
  deps: GoogleDeps,
): Promise<ReceiptValidationResult> {
  const purchaseToken = extractPurchaseToken(rawReceipt)
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
  const productTierMap = deps.productTierMap ?? {}

  const serviceAccount = parseServiceAccount(deps.serviceAccountJson)

  const accessToken = await exchangeToken(fetchImpl, serviceAccount, timeoutMs)

  const url = `${ANDROID_PUBLISHER_BASE}/androidpublisher/v3/applications/` +
    `${encodeURIComponent(deps.packageName)}/purchases/subscriptionsv2/tokens/` +
    `${encodeURIComponent(purchaseToken)}`

  const response = await withTimeout(
    (signal) =>
      fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      }),
    timeoutMs,
  )

  if (response.status === 404 || response.status === 410) {
    throw new ReceiptValidationError('purchase token not found or expired', {
      code: 'receipt_not_found',
      fault: 'client',
    })
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ReceiptValidationError('play subscription lookup failed', {
      code: 'provider_unavailable',
      fault: 'provider',
    })
  }

  const body = (await response.json()) as SubscriptionsV2Response
  const lineItem = body.lineItems?.[0]
  if (!lineItem) {
    throw new ReceiptValidationError('play subscription has no line items', {
      code: 'provider_contract_violation',
      fault: 'provider',
      status: 502,
    })
  }
  if (typeof lineItem.expiryTime !== 'string' || lineItem.expiryTime.trim() === '') {
    throw new ReceiptValidationError('play line item is missing an expiry', {
      code: 'provider_contract_violation',
      fault: 'provider',
      status: 502,
    })
  }

  // The purchase token is the durable, per-purchase subscription identifier for
  // Play (the productId is the shared SKU and would collide across buyers).
  const providerSubscriptionId = assertNonEmptyProviderId(purchaseToken)
  const status = mapGoogleStatus(String(body.subscriptionState ?? ''))
  const { interval, intervalCount } = parseIso8601Period(
    String(lineItem.billingPeriodDuration ?? ''),
  )
  const tier = deriveTierFromInterval(
    interval,
    intervalCount,
    lineItem.productId ?? null,
    productTierMap,
  )

  return {
    provider_subscription_id: providerSubscriptionId,
    status,
    current_period_end: normalizeGoogleTimestamp(lineItem.expiryTime),
    tier,
    bound_user_id: null,
    raw_metadata: {
      provider: 'play_iap',
      product_id: lineItem.productId,
      provider_status: body.subscriptionState,
    },
  }
}

function extractPurchaseToken(rawReceipt: unknown): string {
  if (
    rawReceipt !== null &&
    typeof rawReceipt === 'object' &&
    typeof (rawReceipt as { purchaseToken?: unknown }).purchaseToken === 'string' &&
    (rawReceipt as { purchaseToken: string }).purchaseToken.trim() !== ''
  ) {
    return (rawReceipt as { purchaseToken: string }).purchaseToken
  }
  throw new ReceiptValidationError('play receipt must carry a non-empty purchaseToken', {
    code: 'invalid_receipt_shape',
    fault: 'client',
  })
}

// Parse + field-validate the service-account JSON. A parse failure or a missing
// auth field is OUR misconfiguration (provider fault) — surfaced BEFORE any
// network call.
function parseServiceAccount(json: string): ServiceAccount {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(json) as Record<string, unknown>
  } catch {
    throw serviceAccountMisconfigured()
  }
  const clientEmail = parsed.client_email
  const privateKey = parsed.private_key
  const tokenUri = parsed.token_uri
  if (
    typeof clientEmail !== 'string' || clientEmail === '' ||
    typeof privateKey !== 'string' || privateKey === '' ||
    typeof tokenUri !== 'string' || tokenUri === ''
  ) {
    throw serviceAccountMisconfigured()
  }
  return { client_email: clientEmail, private_key: privateKey, token_uri: tokenUri }
}

function serviceAccountMisconfigured(): ReceiptValidationError {
  return new ReceiptValidationError('play service account credential is misconfigured', {
    code: 'service_account_misconfigured',
    fault: 'provider',
  })
}

// Exchange the service-account JWT bearer grant for an access token. The
// assertion is signed with the configured private key on a best-effort basis: a
// key that cannot sign yields an assertion Google rejects at the token endpoint
// (401 -> provider fault), the same outcome as any other bad credential, so the
// key material is not pre-validated here.
async function exchangeToken(
  fetchImpl: typeof fetch,
  account: ServiceAccount,
  timeoutMs: number,
): Promise<string> {
  const assertion = await buildAssertion(account)
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })
  const response = await withTimeout(
    (signal) =>
      fetchImpl(account.token_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal,
      }),
    timeoutMs,
  )
  if (response.status < 200 || response.status >= 300) {
    throw new ReceiptValidationError('play token exchange failed', {
      code: 'provider_auth_failed',
      fault: 'provider',
    })
  }
  const body = (await response.json()) as { access_token?: unknown }
  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new ReceiptValidationError('play token exchange returned no access token', {
      code: 'provider_auth_failed',
      fault: 'provider',
    })
  }
  return body.access_token
}

async function buildAssertion(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: account.client_email,
    scope: GOOGLE_AUTH_SCOPE,
    aud: account.token_uri,
    iat: now,
    exp: now + 3600,
  }
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${
    base64UrlEncode(JSON.stringify(claim))
  }`
  const signature = await signRs256(signingInput, account.private_key)
  return `${signingInput}.${signature}`
}

// Sign RS256 with the PEM private key. Any crypto failure (e.g. an unusable key)
// returns an empty signature so the token exchange still runs and Google returns
// the authoritative 401 (mapped to a provider fault upstream).
async function signRs256(signingInput: string, pem: string): Promise<string> {
  try {
    const der = pemToDer(pem)
    const key = await crypto.subtle.importKey(
      'pkcs8',
      der as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(signingInput),
    )
    return base64UrlEncodeBytes(new Uint8Array(sig))
  } catch {
    return ''
  }
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function base64UrlEncode(input: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(input))
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
