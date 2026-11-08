// src/medulla-core.mjs
// Host-agnostic conduction core: identity, append-only ledger, ingress/egress,
// device coupling and self-verification for BentoBoxDS HOP prime account sync.
// Pure Node — no `bare`, no React Native. Runs in a bare worklet *or* under plain
// `node` for unit tests.
import Corestore from 'corestore'
import Hyperbee from 'hyperbee'
import Hyperdrive from 'hyperdrive'
import b4a from 'b4a'
import sodium from 'sodium-native'
import {
  PROTOCOL,
  INGRESS_TELEMETRY,
  EGRESS_TELEMETRY,
  COUPLE,
  VERIFY,
  COUPLED,
  VERIFIED,
  MEDULLA_READY,
  MEDULLA_ERROR,
  INGRESS_COMMITTED,
  SAVE_PHOTO,
  GET_PHOTO,
  LIST_PHOTOS,
  PHOTO_SAVED,
  PHOTO_LIST,
  PHOTO_RETRIEVED,
  buildDbKey,
  parsePacket,
  commitResponse,
  egressResponse,
  signEnvelope,
  verifyEnvelope,
  createNonce,
  buildEnvelope,
  buildSignedEnvelope,
  signableBytes
} from './ingress.mjs'

export {
  PROTOCOL,
  INGRESS_TELEMETRY,
  EGRESS_TELEMETRY,
  COUPLE,
  VERIFY,
  COUPLED,
  VERIFIED,
  MEDULLA_READY,
  MEDULLA_ERROR,
  INGRESS_COMMITTED,
  SAVE_PHOTO,
  GET_PHOTO,
  LIST_PHOTOS,
  PHOTO_SAVED,
  PHOTO_LIST,
  PHOTO_RETRIEVED
}

const IDENTITY_KEY = 'identity'
const IDENTITY_STORE = 'medulla-identity'
const LEDGER_STORE = 'medulla-conduction-index'
const COUPLE_STORE = 'medulla-couplings'
const NONCE_STORE = 'medulla-nonces'
const NONCE_TTL_MS = 5 * 60 * 1000

export class Medulla {
  constructor(storageDir, opts = {}) {
    this.storageDir = storageDir
    this.store = new Corestore(storageDir)
    this.bee = null
    this.identity = null // { publicKey, secretKey } as Buffers
    this.coupleBee = null // account/device -> coupling record
    this.nonceBee = null // nonce -> expiresAt
    this.photos = null // Hyperdrive holding captured frames (radia units)
    this.opts = opts
  }

  async ready() {
    await this.store.ready()
    this.identity = await this._loadOrCreateIdentity()
    this.bee = new Hyperbee(this.store.get({ name: LEDGER_STORE }), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
    this.coupleBee = new Hyperbee(this.store.get({ name: COUPLE_STORE }), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
    this.nonceBee = new Hyperbee(this.store.get({ name: NONCE_STORE }), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
    // Hyperdrive image store. The captured frame bytes live here so a peer can
    // move the ratio lines; the overlay-data contract is saved separately to
    // the ledger and references this path by id. Pass the raw Corestore
    // (not a namespace) — hyperdrive 11 expects a corestore-like object.
    this.photos = new Hyperdrive(this.store)
    await this.photos.ready()
    await this.bee.ready()
    await this.coupleBee.ready()
    await this.nonceBee.ready()
    await this._purgeExpiredNonces()
  }

  async _loadOrCreateIdentity() {
    const idBee = new Hyperbee(this.store.get({ name: IDENTITY_STORE }), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
    await idBee.ready()
    let rec = await idBee.get(IDENTITY_KEY)
    if (!rec || !rec.value || !rec.value.publicKey || !rec.value.secretKey) {
      const pk = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
      const sk = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
      sodium.crypto_sign_keypair(pk, sk)
      await idBee.put(IDENTITY_KEY, {
        publicKey: b4a.toString(pk, 'hex'),
        secretKey: b4a.toString(sk, 'hex'),
        createdAt: Date.now()
      })
      rec = await idBee.get(IDENTITY_KEY)
    }
    return {
      publicKey: b4a.from(rec.value.publicKey, 'hex'),
      secretKey: b4a.from(rec.value.secretKey, 'hex')
    }
  }

  get publicKey() {
    return this.identity ? this.identity.publicKey : null
  }

  get publicKeyHex() {
    return this.identity ? b4a.toString(this.identity.publicKey, 'hex') : null
  }

  // --- Coupling (BentoBoxDS HOP prime account) -----------------------------

  // Record that an external account has coupled this instrument. The account
  // supplies the instrument's public key (from the QR). Idempotent.
  async couple(accountId, publicKeyHex, meta = {}) {
    if (!this.coupleBee) throw new Error('Medulla not ready — call ready() first')
    if (!accountId) throw new Error('accountId required')
    const rec = {
      accountId: String(accountId),
      publicKey: publicKeyHex || this.publicKeyHex,
      instrument: this.publicKeyHex,
      coupledAt: Date.now(),
      ...meta
    }
    await this.coupleBee.put(String(accountId), rec)
    return rec
  }

  async getCoupling(accountId) {
    if (!this.coupleBee) throw new Error('Medulla not ready — call ready() first')
    const rec = await this.coupleBee.get(String(accountId))
    return rec ? rec.value : null
  }

  async listCouplings() {
    if (!this.coupleBee) throw new Error('Medulla not ready — call ready() first')
    const out = []
    for await (const entry of this.coupleBee.createReadStream()) out.push(entry.value)
    return out
  }

  // Sign a challenge nonce with the instrument's private key. The host sends
  // the signed result to its BentoBoxDS account to self-verify coupling.
  // The private key never leaves the worklet.
  async signChallenge(challenge) {
    if (!this.identity) throw new Error('Medulla not ready — call ready() first')
    const msg = b4a.from(String(challenge), 'utf-8')
    const sig = b4a.alloc(sodium.crypto_sign_BYTES)
    sodium.crypto_sign_detached(sig, msg, this.identity.secretKey)
    return {
      publicKey: this.publicKeyHex,
      signature: b4a.toString(sig, 'hex'),
      challenge: String(challenge),
      signedAt: Date.now()
    }
  }

  // Verify a challenge signature (used on the account/BentoBoxDS side or in tests).
  static verifyChallenge(challenge, signatureHex, publicKeyHex) {
    try {
      const msg = b4a.from(String(challenge), 'utf-8')
      const sig = b4a.from(String(signatureHex), 'hex')
      const pk = b4a.from(String(publicKeyHex), 'hex')
      return sodium.crypto_sign_verify_detached(sig, msg, pk)
    } catch (_) {
      return false
    }
  }

  // --- Ingress / Egress ----------------------------------------------------

  // Persist one ingress telemetry envelope for a device. For first-party device
  // telemetry (from === device, e.g. radia/cale host) the worklet accepts the
  // packet and attaches a signature; for external devices (BLE/wearables) the
  // packet must carry a valid sig from the device's coupled key.
  async ingest(input, payload, cipher, timestamp) {
    if (!this.bee) throw new Error('Medulla not ready — call ready() first')

    // Back-compat: allow legacy ingest(device, payload, cipher, timestamp)
    let envelope
    if (input && typeof input === 'object' && input.action === INGRESS_TELEMETRY) {
      envelope = { ...input }
    } else {
      envelope = buildEnvelope({
        id: `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: String(input),
        device: String(input),
        action: INGRESS_TELEMETRY,
        payload,
        ts: timestamp || Date.now(),
        cipher
      })
    }

    await this._authorize(envelope)

    // Attach instrument signature for auditability (private key stays in worklet).
    if (!envelope.sig) {
      envelope.sig = signEnvelope(envelope, this.identity.secretKey)
    }

    const ts = envelope.ts || Date.now()
    const key = buildDbKey(envelope.device, ts)
    await this.bee.put(key, {
      id: envelope.id,
      v: envelope.v ?? 1,
      from: envelope.from,
      device: envelope.device,
      action: envelope.action,
      payload: envelope.payload,
      cipher: envelope.cipher,
      nonce: envelope.nonce,
      sig: envelope.sig,
      accountId: envelope.accountId || null,
      ts,
      recordedAt: ts
    })
    return commitResponse(envelope.id, key, envelope.device, { recordedAt: ts })
  }

  // Read back committed ingress records for a device, newest-first.
  async query(device, limit = 100) {
    if (!this.bee) throw new Error('Medulla not ready — call ready() first')
    const results = []
    const stream = this.bee.createReadStream({
      gt: `conduction/${device}/`,
      lte: `conduction/${device}/\uFFFF`,
      reverse: true,
      limit
    })
    for await (const entry of stream) results.push(entry)
    return results
  }

  // --- Internals -----------------------------------------------------------

  async _authorize(envelope) {
    if (!this.identity) throw new Error('Medulla not ready — call ready() first')

    const { from, device, nonce, sig } = envelope
    if (!device) throw new Error('device required')
    if (!from) throw new Error('from required')

    // ACL: first-party device writes must come from their owning app/device.
    // External devices (BLE) may write only if they have a coupling record.
    if (from !== device) {
      const coupled = await this._devicePublicKey(from)
      if (!coupled) {
        throw new Error(`ACL denied: '${from}' may not write device '${device}'`)
      }
    }

    // Replay protection: nonce must be fresh.
    if (!nonce) throw new Error('Missing nonce')
    const existing = await this.nonceBee.get(String(nonce))
    if (existing && existing.value && existing.value.expiresAt > Date.now()) {
      throw new Error('Replay detected: nonce already used')
    }
    await this.nonceBee.put(String(nonce), { usedAt: Date.now(), expiresAt: Date.now() + NONCE_TTL_MS })

    // Signature verification when provided. First-party host→worklet IPC may be
    // unsigned (private key never leaves worklet); external device packets must
    // be signed by their coupled key.
    if (sig) {
      const pkHex = await this._devicePublicKey(from)
      const pk = pkHex ? b4a.from(pkHex, 'hex') : this.identity.publicKey
      if (!verifyEnvelope(envelope, pk)) {
        throw new Error('Signature verification failed')
      }
    } else if (from !== device) {
      throw new Error('External device packets must be signed')
    }
  }

  async _devicePublicKey(deviceOrFrom) {
    // External devices (BLE/wearable) couple their own public key under their id.
    // Phone-owned devices (radia/cale) use the instrument keypair.
    // Unknown devices return null so the ACL check denies them (no silent fallback
    // to the instrument key — that would let any `from` write as the instrument).
    if (deviceOrFrom === this.publicKeyHex) return this.publicKeyHex
    const rec = await this.coupleBee.get(String(deviceOrFrom))
    if (rec && rec.value && rec.value.publicKey) return rec.value.publicKey
    return null
  }

  async _purgeExpiredNonces() {
    try {
      const now = Date.now()
      const toDelete = []
      for await (const entry of this.nonceBee.createReadStream({ reverse: false })) {
        if (entry.value && entry.value.expiresAt < now) toDelete.push(entry.key)
      }
      for (const key of toDelete) await this.nonceBee.del(key)
    } catch (_) {
      // non-fatal: best-effort cleanup
    }
  }

  // --- Photo capture (Hyperdrive image store) -------------------------------
  // Save a captured frame's bytes to the Hyperdrive photo store. The overlay-data
  // contract (radia units) is committed to the ledger separately and references
  // this path by id, so a peer can move the ratio lines against the image.
  _photoPath(id) {
    return `photos/${id}.jpg`
  }

  async savePhoto(id, buffer, meta = {}) {
    if (!this.photos) throw new Error('Medulla not ready — call ready() first')
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
    const path = this._photoPath(id)
    await this.photos.put(path, buf)
    return {
      id,
      path,
      bytes: buf.length,
      driveKey: this.photos.key ? b4a.toString(this.photos.key, 'hex') : null,
      savedAt: Date.now(),
      ...meta
    }
  }

  async getPhoto(id) {
    if (!this.photos) throw new Error('Medulla not ready — call ready() first')
    const entry = await this.photos.get(this._photoPath(id))
    if (!entry) return null
    const rs = this.photos.createReadStream(this._photoPath(id))
    let buf = Buffer.alloc(0)
    for await (const chunk of rs) buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    return { id, path: this._photoPath(id), entry, bytes: buf.length, buffer: buf }
  }

  async listPhotos(limit = 100) {
    if (!this.photos) throw new Error('Medulla not ready — call ready() first')
    const out = []
    for await (const entry of this.photos.entries({ limit })) {
      // hyperdrive entries() yields { seq, key, value }; the value is only
      // populated for some entry types, so derive the name from the key and
      // fetch the length via get() when available.
      const key = entry.key
      const rawName = typeof key === 'string' ? key : (key ? b4a.toString(key, 'utf-8') : null)
      // hyperdrive normalizes keys with a leading slash; strip it for a clean name.
      const name = rawName ? rawName.replace(/^\/+/, '') : null
      let length = null
      try {
        const e = await this.photos.get(name)
        if (e) length = e.length != null ? e.length : (e.size != null ? e.size : null)
      } catch (_) { /* best-effort */ }
      out.push({ seq: entry.seq, key, name, path: name, length, size: length })
    }
    return out
  }

  async close() {
    if (this.photos) await this.photos.close()
    if (this.store) await this.store.close()
  }
}

// Re-export protocol helpers so host shells and worklets share one import path.
export {
  buildDbKey,
  parsePacket,
  commitResponse,
  egressResponse,
  signEnvelope,
  verifyEnvelope,
  createNonce,
  buildEnvelope,
  buildSignedEnvelope,
  signableBytes
} from './ingress.mjs'
