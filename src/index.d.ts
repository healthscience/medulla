// src/index.d.ts — TypeScript surface for @conduction/medulla.
export declare const PROTOCOL = 'conduction/medulla/v1'
export declare const INGRESS_TELEMETRY: 'INGRESS_TELEMETRY'
export declare const EGRESS_TELEMETRY: 'EGRESS_TELEMETRY'
export declare const COUPLE: 'COUPLE'
export declare const VERIFY: 'VERIFY'
export declare const COUPLED: 'COUPLED'
export declare const VERIFIED: 'VERIFIED'
export declare const MEDULLA_READY: 'MEDULLA_READY'
export declare const MEDULLA_ERROR: 'MEDULLA_ERROR'
export declare const INGRESS_COMMITTED: 'INGRESS_COMMITTED'

export interface Identity {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

export interface IngressRecord {
  id?: string
  v?: number
  from: string
  device: string
  action?: string
  payload: unknown
  cipher?: string
  nonce?: string
  sig?: string
  accountId?: string | null
  ts?: number
  recordedAt: number
}

export interface CommitResponse {
  id?: string
  type: 'INGRESS_COMMITTED'
  key: string
  device: string
  status: 'OK'
  recordedAt?: number
}

export interface EgressResponse {
  id?: string
  type: 'EGRESS_TELEMETRY'
  device: string
  records: Array<{ key: string; value: IngressRecord }>
  cursor: string | null
  status: 'OK'
}

export interface CouplingRecord {
  accountId: string
  publicKey: string
  instrument: string | null
  coupledAt: number
  [k: string]: unknown
}

export interface ChallengeResponse {
  publicKey: string | null
  signature: string
  challenge: string
  signedAt: number
}

export interface Envelope {
  id?: string
  v?: number
  from: string
  device: string
  action: string
  payload: unknown
  ts?: number
  nonce?: string
  sig?: string
  cipher?: string
  accountId?: string
}

export declare class Medulla {
  constructor(storageDir: string, opts?: Record<string, unknown>)
  storageDir: string
  publicKey: Uint8Array | null
  publicKeyHex: string | null
  ready(): Promise<void>
  ingest(envelope: Envelope): Promise<CommitResponse>
  ingest(device: string, payload: unknown, cipher?: string, timestamp?: number): Promise<CommitResponse>
  query(device: string, limit?: number): Promise<Array<{ key: string; value: IngressRecord }>>
  couple(accountId: string, publicKeyHex?: string, meta?: Record<string, unknown>): Promise<CouplingRecord>
  getCoupling(accountId: string): Promise<CouplingRecord | null>
  listCouplings(): Promise<CouplingRecord[]>
  signChallenge(challenge: string): Promise<ChallengeResponse>
  static verifyChallenge(challenge: string, signatureHex: string, publicKeyHex: string): boolean
  close(): Promise<void>
}

export declare function buildDbKey(device: string, timestamp?: number): string
export declare function parsePacket(raw: string): Envelope
export declare function commitResponse(id: string | undefined, key: string, device: string, extras?: Record<string, unknown>): CommitResponse
export declare function egressResponse(id: string | undefined, device: string, records: unknown[], cursor?: string | null): EgressResponse
export declare function signEnvelope(envelope: Envelope, secretKey: Uint8Array): string
export declare function verifyEnvelope(envelope: Envelope, publicKey: Uint8Array | string): boolean
export declare function createNonce(): string
export declare function buildEnvelope(fields?: Partial<Envelope>): Envelope
export declare function buildSignedEnvelope(fields: Partial<Envelope>, secretKey: Uint8Array): Envelope
export declare function signableBytes(envelope: Envelope): Uint8Array
