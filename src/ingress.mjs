// src/ingress.mjs — shared conduction protocol.
// Host-agnostic: imported by the bare worklet (medulla.mjs) and by host apps
// (via @conduction/medulla/ingress). Pure Node, no `bare`, no React Native.
import b4a from 'b4a'
import sodium from 'sodium-native'

export const PROTOCOL = 'conduction/medulla/v1'
export const INGRESS_TELEMETRY = 'INGRESS_TELEMETRY'
export const EGRESS_TELEMETRY = 'EGRESS_TELEMETRY'
export const COUPLE = 'COUPLE'
export const VERIFY = 'VERIFY'
export const COUPLED = 'COUPLED'
export const VERIFIED = 'VERIFIED'
export const MEDULLA_READY = 'MEDULLA_READY'
export const MEDULLA_ERROR = 'MEDULLA_ERROR'
export const INGRESS_COMMITTED = 'INGRESS_COMMITTED'
export const SAVE_PHOTO = 'SAVE_PHOTO'
export const GET_PHOTO = 'GET_PHOTO'
export const LIST_PHOTOS = 'LIST_PHOTOS'
export const PHOTO_SAVED = 'PHOTO_SAVED'
export const PHOTO_LIST = 'PHOTO_LIST'
export const PHOTO_RETRIEVED = 'PHOTO_RETRIEVED'

const NONCE_BYTES = 24

// Ledger key: conduction/<device>/<timestamp>
export function buildDbKey(device, timestamp = Date.now()) {
  return `conduction/${device}/${timestamp}`
}

// Parse a raw IPC payload into its fields.
export function parsePacket(raw) {
  const packet = JSON.parse(raw)
  const { id, v, from, device, action, payload, ts, nonce, sig, cipher } = packet
  return { id, v, from, device, action, payload, ts, nonce, sig, cipher }
}

// Ack sent after a successful ingress commit. Carries the request `id` so the
// host can correlate it back to the packet it sent (RPC semantics).
export function commitResponse(id, key, device, extras = {}) {
  return { id, type: INGRESS_COMMITTED, key, device, status: 'OK', ...extras }
}

// Ack sent back to an egressing host/device after a ledger read.
export function egressResponse(id, device, records, cursor = null) {
  return { id, type: EGRESS_TELEMETRY, device, records, cursor, status: 'OK' }
}

// --- Authorization primitives ----------------------------------------------

// Deterministic bytes that get signed. Same on both sides so a signature
// produced by the worklet verifies against a public key registered by the
// host's BentoBoxDS account during coupling.
export function signableBytes(envelope) {
  const { id, v, from, device, action, ts, nonce } = envelope
  const payloadStr = JSON.stringify(envelope.payload ?? null)
  const head = b4a.from(
    `${PROTOCOL}|${id ?? ''}|${v ?? 1}|${from ?? ''}|${device ?? ''}|${action ?? ''}|${ts ?? 0}|${nonce ?? ''}`,
    'utf-8'
  )
  const body = b4a.from(payloadStr, 'utf-8')
  return b4a.concat([head, b4a.from('|', 'utf-8'), body])
}

// Sign an envelope with the instrument's private key. Returns hex signature.
export function signEnvelope(envelope, secretKey) {
  const msg = signableBytes(envelope)
  const sig = b4a.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(sig, msg, secretKey)
  return b4a.toString(sig, 'hex')
}

// Verify an envelope signature against a public key. Returns boolean.
export function verifyEnvelope(envelope, publicKey) {
  if (!envelope || !envelope.sig || !publicKey) return false
  try {
    const msg = signableBytes(envelope)
    const sig = b4a.from(String(envelope.sig), 'hex')
    const pk = typeof publicKey === 'string' ? b4a.from(publicKey, 'hex') : publicKey
    if (sig.byteLength !== sodium.crypto_sign_BYTES) return false
    return sodium.crypto_sign_verify_detached(sig, msg, pk)
  } catch (_) {
    return false
  }
}

// Fresh anti-replay nonce.
export function createNonce() {
  const n = b4a.alloc(NONCE_BYTES)
  sodium.randombytes_buf(n)
  return b4a.toString(n, 'hex')
}

// Build a host→worklet envelope. The host never holds the private key; for
// local IPC the worklet signs/attaches the instrument signature on ingest.
// For external devices (BLE/wearables) the device signs and the worklet verifies.
export function buildEnvelope({ id, from, device, action, payload, ts = Date.now(), cipher, accountId } = {}) {
  return {
    id: id || `env-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    v: 1,
    from,
    device,
    action,
    payload,
    ts,
    nonce: createNonce(),
    ...(cipher ? { cipher } : {}),
    ...(accountId ? { accountId } : {})
  }
}

// Convenience: build and sign an envelope (used by worklet or any holder of a secret key).
export function buildSignedEnvelope(fields, secretKey) {
  const env = buildEnvelope(fields)
  env.sig = signEnvelope(env, secretKey)
  return env
}
