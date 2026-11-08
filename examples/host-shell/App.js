// examples/host-shell/App.js — reference React Native host shell for radia/cale.
// Copy/adapt into the host app repo; not part of medulla runtime/library code.
// This file is intentionally host-only: it imports the core via the package
// entry point and never re-implements crypto, P2P or storage.
// The host never holds the instrument private key; it asks the worklet to
// sign/verify via IPC (COUPLE, VERIFY, INGRESS_TELEMETRY).
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Worklet } from 'react-native-bare-kit'
import { documentDirectory } from 'expo-file-system'
import {
  MEDULLA_READY,
  MEDULLA_ERROR,
  INGRESS_COMMITTED,
  INGRESS_TELEMETRY,
  COUPLE,
  COUPLED,
  VERIFY,
  VERIFIED,
  buildEnvelope
} from '@conduction/medulla'
// @ts-ignore
import bundle from './medulla.bundle'

export default function ConductionInstrumentShell({ onIngress, onCoupled, onVerified, title = 'CONDUCTION INSTRUMENT', appId = 'radia' }) {
  const [worklet, setWorklet] = useState(null)
  const [publicKey, setPublicKey] = useState(null)
  const [medullaStatus, setMedullaStatus] = useState('Initializing Medulla...')
  const [lastCommit, setLastCommit] = useState('Awaiting sensory ingress...')
  const pending = useRef(new Map()) // id -> { resolve, reject }

  const send = useCallback((action, payload = {}, extras = {}) => {
    if (!worklet) return Promise.reject(new Error('Medulla not ready'))
    const envelope = { id: `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, action, payload, ...extras }
    return new Promise((resolve, reject) => {
      pending.current.set(envelope.id, { resolve, reject })
      worklet.IPC.write(JSON.stringify(envelope))
      setTimeout(() => {
        if (pending.current.has(envelope.id)) {
          pending.current.delete(envelope.id)
          reject(new Error(`RPC timeout: ${action}`))
        }
      }, 15000)
    })
  }, [worklet])

  useEffect(() => {
    let instance
    try {
      instance = new Worklet()
      const storagePath = String(documentDirectory)
      instance.start('/medulla.bundle', bundle, [storagePath])

      instance.IPC.on('data', (raw) => {
        let msg
        try { msg = JSON.parse(raw) } catch (_) { return }

        if (msg.id && pending.current.has(msg.id)) {
          const { resolve, reject } = pending.current.get(msg.id)
          pending.current.delete(msg.id)
          if (msg.type === MEDULLA_ERROR) reject(new Error(msg.error))
          else resolve(msg)
        }

        if (msg.type === MEDULLA_READY) {
          setPublicKey(msg.publicKey || null)
          setMedullaStatus(`Medulla Active — ${msg.publicKey?.slice(0, 8)}…`)
        } else if (msg.type === INGRESS_COMMITTED) {
          setLastCommit(`Committed [${String(msg.device || '').toUpperCase()}]: ${msg.key}`)
          onIngress?.(msg)
        } else if (msg.type === COUPLED) {
          onCoupled?.(msg)
        } else if (msg.type === VERIFIED) {
          onVerified?.(msg)
        } else if (msg.type === MEDULLA_ERROR) {
          setMedullaStatus(`Medulla Error: ${msg.error}`)
        }
      })

      setWorklet(instance)
    } catch (err) {
      setMedullaStatus(`Initialization Error: ${err.message}`)
    }
    return () => { try { instance?.stop?.() } catch (_) {} }
  }, [onIngress, onCoupled, onVerified])

  // Send authenticated telemetry ingress. The worklet attaches the instrument
  // signature and enforces ACL + replay protection.
  const sendIngress = useCallback((device, payload, cipher = 'heli-phase-active') => {
    if (!worklet) return Promise.resolve(null)
    const env = buildEnvelope({
      from: appId,
      device,
      action: INGRESS_TELEMETRY,
      payload,
      cipher
    })
    return send(INGRESS_TELEMETRY, null, env)
  }, [worklet, appId, send])

  // Couple this instrument to a BentoBoxDS HOP prime account (after QR scan).
  const couple = useCallback((accountId, meta = {}) => {
    return send(COUPLE, { accountId, publicKey, meta })
  }, [send, publicKey])

  // Ask the worklet to sign a challenge for self-verification. The private key
  // never leaves the worklet; the host forwards the signature to BentoBoxDS.
  const verify = useCallback((challenge) => {
    return send(VERIFY, { challenge })
  }, [send])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.status}>{medullaStatus}</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Instrument Public Key:</Text>
        <Text style={styles.commitText}>{publicKey ? `${publicKey.slice(0, 16)}…` : '—'}</Text>
        <Text style={[styles.label, { marginTop: 8 }]}>Storage Ledger Status:</Text>
        <Text style={styles.commitText}>{lastCommit}</Text>
      </View>
      <TouchableOpacity onPress={() => sendIngress('radia', { cranialAngle: 11.2 })} style={styles.radiaButton}>
        <Text style={styles.buttonText}>Ingress Radia (Posture Vector)</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => sendIngress('cale', { tempC: 20.8 })} style={styles.caleButton}>
        <Text style={styles.buttonText}>Ingress Cale (Environment Telemetry)</Text>
      </TouchableOpacity>
      {publicKey ? (
        <Text style={styles.hint}>Use sendIngress/couple/verify from host props for production flows.</Text>
      ) : null}
    </View>
  )
}

export { sendIngressShape }
function sendIngressShape() { return null } // placeholder to keep named export stable

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030303', padding: 24, justifyContent: 'center' },
  title: { color: '#00FFCC', fontSize: 18, fontWeight: 'bold', fontFamily: 'monospace', marginBottom: 4 },
  status: { color: '#777', fontSize: 12, fontFamily: 'monospace', marginBottom: 20 },
  card: { backgroundColor: '#111', padding: 16, borderRadius: 6, marginBottom: 20, borderWidth: 1, borderColor: '#222' },
  label: { color: '#888', fontSize: 11, marginBottom: 4, fontFamily: 'monospace' },
  commitText: { color: '#FFF', fontSize: 12, fontFamily: 'monospace' },
  radiaButton: { backgroundColor: '#1E293B', padding: 16, borderRadius: 6, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  caleButton: { backgroundColor: '#064E3B', padding: 16, borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: '#065F46' },
  buttonText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  hint: { color: '#555', fontSize: 10, fontFamily: 'monospace', marginTop: 12 }
})
