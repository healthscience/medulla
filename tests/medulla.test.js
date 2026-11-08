import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import {
  Medulla,
  buildDbKey,
  parsePacket,
  commitResponse,
  egressResponse,
  buildEnvelope,
  signEnvelope,
  verifyEnvelope,
  createNonce,
  INGRESS_TELEMETRY
} from '../src/index.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import b4a from 'b4a'
import sodium from 'sodium-native'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'medulla-test-'))

describe('medulla ingress helpers', () => {
  it('builds db key', () => {
    const key = buildDbKey('radia', 123)
    expect(key).toBe('conduction/radia/123')
  })

  it('parses packet', () => {
    const packet = parsePacket(JSON.stringify({ id: '1', device: 'cale', from: 'cale', action: INGRESS_TELEMETRY, payload: { tempC: 20 }, nonce: 'n' }))
    expect(packet.device).toBe('cale')
    expect(packet.action).toBe(INGRESS_TELEMETRY)
  })

  it('commit response shape', () => {
    const res = commitResponse('req1', 'conduction/radia/1', 'radia')
    expect(res.type).toBe('INGRESS_COMMITTED')
    expect(res.status).toBe('OK')
    expect(res.id).toBe('req1')
    expect(res.key).toBe('conduction/radia/1')
  })

  it('egress response shape', () => {
    const res = egressResponse('req2', 'cale', [{ key: 'x' }], 'cursor')
    expect(res.type).toBe('EGRESS_TELEMETRY')
    expect(res.records).toHaveLength(1)
    expect(res.cursor).toBe('cursor')
    expect(res.id).toBe('req2')
  })

  it('creates unique nonces', () => {
    expect(createNonce()).not.toBe(createNonce())
  })

  it('signs and verifies envelopes', () => {
    const pk = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
    const sk = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(pk, sk)
    const env = buildEnvelope({ id: '1', from: 'radia', device: 'radia', action: INGRESS_TELEMETRY, payload: { x: 1 } })
    env.sig = signEnvelope(env, sk)
    expect(verifyEnvelope(env, pk)).toBe(true)
    env.payload.x = 2
    expect(verifyEnvelope(env, pk)).toBe(false)
  })
})

describe('medulla core', () => {
  let medulla

  beforeEach(async () => {
    medulla = new Medulla(path.join(tmp, 'core-' + Math.random().toString(36).slice(2)))
    await medulla.ready()
  })

  afterEach(async () => {
    await medulla.close()
  })

  it('creates a persistent identity', () => {
    expect(medulla.publicKey).toBeInstanceOf(Uint8Array)
    expect(medulla.publicKey).toHaveLength(32)
    expect(typeof medulla.publicKeyHex).toBe('string')
    expect(medulla.publicKeyHex).toHaveLength(64)
  })

  it('ingests legacy telemetry and commits', async () => {
    const res = await medulla.ingest('radia', { cranialAngle: 11.2 }, 'heli-phase-active', 1000)
    expect(res.type).toBe('INGRESS_COMMITTED')
    expect(res.key).toBe('conduction/radia/1000')
    expect(res.device).toBe('radia')
  })

  it('ingests envelope telemetry and commits with signature', async () => {
    const env = buildEnvelope({
      id: 'req-radia-1',
      from: 'radia',
      device: 'radia',
      action: INGRESS_TELEMETRY,
      payload: { cranialAngle: 11.2 },
      ts: 2000
    })
    const res = await medulla.ingest(env)
    expect(res.id).toBe('req-radia-1')
    expect(res.key).toBe('conduction/radia/2000')
    const records = await medulla.query('radia')
    expect(records[0].value.sig).toBeTruthy()
    expect(records[0].value.nonce).toBe(env.nonce)
  })

  it('queries records newest-first', async () => {
    await medulla.ingest('cale', { tempC: 20 }, 'c', 100)
    await medulla.ingest('cale', { tempC: 21 }, 'c', 200)
    await medulla.ingest('radia', { x: 1 }, 'c', 300)

    const cale = await medulla.query('cale', 10)
    expect(cale).toHaveLength(2)
    expect(cale[0].key).toBe('conduction/cale/200')
    expect(cale[1].key).toBe('conduction/cale/100')
    expect(cale[0].value.device).toBe('cale')
  })

  it('rejects replayed nonces', async () => {
    const env = buildEnvelope({ id: '1', from: 'radia', device: 'radia', action: INGRESS_TELEMETRY, payload: { x: 1 } })
    await medulla.ingest(env)
    await expect(medulla.ingest({ ...env, id: '2', ts: Date.now() })).rejects.toThrow(/Replay/)
  })

  it('couples account and signs/verifies challenge', async () => {
    const rec = await medulla.couple('account-abc', medulla.publicKeyHex)
    expect(rec.accountId).toBe('account-abc')
    expect(rec.publicKey).toBe(medulla.publicKeyHex)
    expect((await medulla.getCoupling('account-abc')).instrument).toBe(medulla.publicKeyHex)

    const challenge = `couple:${Date.now()}:nonce123`
    const signed = await medulla.signChallenge(challenge)
    expect(signed.publicKey).toBe(medulla.publicKeyHex)
    expect(Medulla.verifyChallenge(challenge, signed.signature, medulla.publicKeyHex)).toBe(true)
    expect(Medulla.verifyChallenge(challenge + 'x', signed.signature, medulla.publicKeyHex)).toBe(false)
  })

  it('reloads identity across instances', async () => {
    const dir = path.join(tmp, 'persist-id')
    const m1 = new Medulla(dir)
    await m1.ready()
    const first = m1.publicKeyHex
    await m1.close()

    const m2 = new Medulla(dir)
    await m2.ready()
    expect(m2.publicKeyHex).toBe(first)
    await m2.close()
  })
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})
