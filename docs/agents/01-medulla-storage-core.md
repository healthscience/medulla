# Module Spec: Medulla Storage Core (`medulla.mjs`)

## Objective
Establish the autonomous C/POSIX background worklet, initialize persistent local storage via `Corestore`, and mount the append-only `Hyperbee` index.

## Constraints & Requirements
* **Language**: Pure JavaScript (`.mjs`). Absolutely zero TypeScript.
* **Storage**: Must mount directly onto the POSIX path passed via `Bare.argv[0]`. No mock memory stores.
* **Lifecycle**: Must signal ready state to the host shell via `BareKit.IPC`.

## Implementation Spec (`medulla.mjs`)
```javascript
import Bare from 'bare'
import Corestore from 'corestore'
import Hyperbee from 'hyperbee'

const storageDir = Bare.argv[0] || Bare.homedir('.conduction-medulla')
const store = new Corestore(storageDir)

await store.ready()

const bee = new Hyperbee(store.get({ name: 'medulla-conduction-index' }), {
  keyEncoding: 'utf-8',
  valueEncoding: 'json'
})

await bee.ready()

BareKit.IPC.write(JSON.stringify({ type: 'MEDULLA_READY', path: storageDir }))

BareKit.IPC.on('data', async (rawPayload) => {
  try {
    const packet = JSON.parse(rawPayload)
    const { device, action, payload, cipher } = packet

    if (action === 'INGRESS_TELEMETRY') {
      const timestamp = Date.now()
      const dbKey = `conduction/${device}/${timestamp}`

      await bee.put(dbKey, {
        device,
        payload,
        cipher,
        recordedAt: timestamp
      })

      BareKit.IPC.write(JSON.stringify({
        type: 'INGRESS_COMMITTED',
        key: dbKey,
        device,
        status: 'OK'
      }))
    }
  } catch (err) {
    BareKit.IPC.write(JSON.stringify({ type: 'MEDULLA_ERROR', error: err.message }))
  }
})