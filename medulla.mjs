// medulla.mjs — bare worklet entry point.
// Host shell passes the POSIX storage path as argv[0] (see host/App.js).
// Imports the host-agnostic core so the same logic is unit-tested under Node.
import {
  Medulla,
  MEDULLA_READY,
  MEDULLA_ERROR,
  COUPLE,
  VERIFY,
  COUPLED,
  VERIFIED,
  INGRESS_TELEMETRY,
  EGRESS_TELEMETRY,
  SAVE_PHOTO,
  GET_PHOTO,
  LIST_PHOTOS,
  PHOTO_SAVED,
  PHOTO_LIST,
  PHOTO_RETRIEVED,
  egressResponse
} from './src/medulla-core.mjs'
import b4a from 'b4a'

const storageDir = Bare.argv[0] || Bare.homedir('.conduction-medulla')
const medulla = new Medulla(storageDir)

try {
  await medulla.ready()
  BareKit.IPC.write(JSON.stringify({
    type: MEDULLA_READY,
    path: storageDir,
    publicKey: medulla.publicKeyHex,
    protocol: 'conduction/medulla/v1'
  }))

  BareKit.IPC.on('data', async (rawPayload) => {
    let id = null
    try {
      const packet = JSON.parse(rawPayload)
      id = packet.id || null
      const { action, payload = {} } = packet

      if (action === INGRESS_TELEMETRY) {
        // Host sends an envelope (id, from, device, nonce, payload, ts[, sig]).
        // The worklet enforces ACL + replay protection, attaches instrument
        // signature, commits to the append-only ledger, and replies with the
        // correlated commit ack.
        const res = await medulla.ingest(packet)
        BareKit.IPC.write(JSON.stringify(res))
      } else if (action === EGRESS_TELEMETRY) {
        const records = await medulla.query(packet.device, payload?.limit)
        BareKit.IPC.write(JSON.stringify(egressResponse(id, packet.device, records)))
      } else if (action === COUPLE) {
        // External account registers this instrument's public key (from QR).
        const rec = await medulla.couple(payload.accountId, payload.publicKey, payload.meta || {})
        BareKit.IPC.write(JSON.stringify({ id, type: COUPLED, ...rec, status: 'OK' }))
      } else if (action === VERIFY) {
        // Host asks the worklet to sign a challenge so it can self-verify
        // coupling with its BentoBoxDS HOP prime account. The private key
        // never leaves the worklet.
        const res = await medulla.signChallenge(payload.challenge)
        BareKit.IPC.write(JSON.stringify({ id, type: VERIFIED, ...res, status: 'OK' }))
      } else if (action === SAVE_PHOTO) {
        // Host sends a captured frame's bytes (base64 or array) plus meta.
        const res = await medulla.savePhoto(packet.id, packet.buffer, payload)
        BareKit.IPC.write(JSON.stringify({ id, type: PHOTO_SAVED, ...res }))
      } else if (action === GET_PHOTO) {
        const res = await medulla.getPhoto(payload.id)
        if (!res) {
          BareKit.IPC.write(JSON.stringify({ id, type: MEDULLA_ERROR, error: `Photo not found: ${payload.id}` }))
          return
        }
        BareKit.IPC.write(JSON.stringify({ id, type: 'PHOTO_REtrieved', ...res, buffer: b4a.toString(res.buffer, 'base64') }))
      } else if (action === LIST_PHOTOS) {
        const res = await medulla.listPhotos(payload?.limit)
        BareKit.IPC.write(JSON.stringify({ id, type: PHOTO_LIST, photos: res }))
      } else {
        BareKit.IPC.write(JSON.stringify({ id, type: MEDULLA_ERROR, error: `Unknown action: ${action}` }))
      }
    } catch (err) {
      BareKit.IPC.write(JSON.stringify({ id, type: MEDULLA_ERROR, error: err.message }))
    }
  })
} catch (err) {
  BareKit.IPC.write(JSON.stringify({ type: MEDULLA_ERROR, error: err.message }))
}
