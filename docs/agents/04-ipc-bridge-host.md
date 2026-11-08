# Module Spec: IPC Bridge & Host Shell (`App.js`)

## Objective
Implement the React Native host shell (`App.js`), instantiate the native `Worklet`, pass the real document storage path, and handle bi-directional IPC messaging.

## Constraints & Requirements
* **Language**: Pure JavaScript (`.js`). No TypeScript.
* **Storage Path**: Must pass `documentDirectory` from `expo-file-system` into the worklet arguments.
* **UI Responsiveness**: Must display live commit confirmations streamed back from the background worklet thread.

## Implementation Spec (`App.js`)
```javascript
import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Worklet } from 'react-native-bare-kit'
import { documentDirectory } from 'expo-file-system'
// @ts-ignore
import bundle from './medulla.bundle'

export default function ConductionInstrumentShell() {
  const [worklet, setWorklet] = useState(null)
  const [medullaStatus, setMedullaStatus] = useState('Initializing Medulla...')
  const [lastCommit, setLastCommit] = useState('Awaiting sensory ingress...')

  useEffect(() => {
    try {
      const instance = new Worklet()
      const storagePath = String(documentDirectory)

      instance.start('/medulla.bundle', bundle, [storagePath])

      instance.IPC.on('data', (raw) => {
        const msg = JSON.parse(raw)
        if (msg.type === 'MEDULLA_READY') {
          setMedullaStatus('Medulla Active (Corestore Mounted)')
        } else if (msg.type === 'INGRESS_COMMITTED') {
          setLastCommit(`Committed [${msg.device.toUpperCase()}]: ${msg.key}`)
        }
      })

      setWorklet(instance)
    } catch (err) {
      setMedullaStatus(`Initialization Error: ${err.message}`)
    }
  }, [])

  const triggerRadiaIngress = () => {
    if (!worklet) return
    worklet.IPC.write(JSON.stringify({
      device: 'radia',
      action: 'INGRESS_TELEMETRY',
      payload: { cranialAngle: 11.2, shoulderDelta: 0.5, alignmentScore: 0.94 },
      cipher: 'heli-phase-active'
    }))
  }

  const triggerCaleIngress = () => {
    if (!worklet) return
    worklet.IPC.write(JSON.stringify({
      device: 'cale',
      action: 'INGRESS_TELEMETRY',
      payload: { vocPpm: 0.28, co2Eq: 395, tempC: 20.8, humidityPct: 52 },
      cipher: 'heli-phase-active'
    }))
  }

  return (
    <View style="{styles.container}">
      <Text style="{styles.title}">CONDUCTION INSTRUMENT</Text>
      <Text style="{styles.status}">{medullaStatus}</Text>
      <View style="{styles.card}">
        <Text style="{styles.label}">Storage Ledger Status:</Text>
        <Text style="{styles.commitText}">{lastCommit}</Text>
      </View>
      <TouchableOpacity onPress="{triggerRadiaIngress}" style="{styles.radiaButton}">
        <Text style="{styles.buttonText}">Ingress Radia (Posture Vector)</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress="{triggerCaleIngress}" style="{styles.caleButton}">
        <Text style="{styles.buttonText}">Ingress Cale (Environment Telemetry)</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030303', padding: 24, justifyContent: 'center' },
  title: { color: '#00FFCC', fontSize: 18, fontWeight: 'bold', fontFamily: 'monospace', marginBottom: 4 },
  status: { color: '#777', fontSize: 12, fontFamily: 'monospace', marginBottom: 20 },
  card: { backgroundColor: '#111', padding: 16, borderRadius: 6, marginBottom: 20, borderWidth: 1, borderColor: '#222' },
  label: { color: '#888', fontSize: 11, marginBottom: 4, fontFamily: 'monospace' },
  commitText: { color: '#FFF', fontSize: 12, fontFamily: 'monospace' },
  radiaButton: { backgroundColor: '#1E293B', padding: 16, borderRadius: 6, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  caleButton: { backgroundColor: '#064E3B', padding: 16, borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: '#065F46' },
  buttonText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 }
})