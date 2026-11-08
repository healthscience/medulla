import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { Medulla } from '../src/index.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'medulla-photo-'))

describe('medulla photo store (Hyperdrive)', () => {
  let medulla
  beforeEach(async () => {
    medulla = new Medulla(path.join(tmp, 'core-' + Math.random().toString(36).slice(2)))
    await medulla.ready()
  })
  afterEach(async () => { await medulla.close() })

  it('saves a frame to the Hyperdrive image store', async () => {
    const img = Buffer.from('fake-jpeg-bytes')
    const saved = await medulla.savePhoto('photo-1', img, { contract: 'exoCue-cameraOverlay-v1' })
    expect(saved.id).toBe('photo-1')
    expect(saved.path).toBe('photos/photo-1.jpg')
    expect(saved.bytes).toBe(img.length)
    expect(typeof saved.driveKey).toBe('string')
  })

  it('round-trips a saved frame', async () => {
    const img = Buffer.from('round-trip-check')
    await medulla.savePhoto('photo-2', img)
    const got = await medulla.getPhoto('photo-2')
    expect(got).not.toBeNull()
    expect(got.buffer.equals(img)).toBe(true)
    expect(got.bytes).toBe(img.length)
  })

  it('returns null for a missing photo', async () => {
    expect(await medulla.getPhoto('nope')).toBeNull()
  })

  it('lists saved photos', async () => {
    await medulla.savePhoto('photo-3', Buffer.from('a'))
    await medulla.savePhoto('photo-4', Buffer.from('bb'))
    const listed = await medulla.listPhotos()
    expect(listed).toHaveLength(2)
    expect(listed.map((e) => e.name).sort()).toEqual(['photos/photo-3.jpg', 'photos/photo-4.jpg'])
  })

  it('persists the image store across instances', async () => {
    const img = Buffer.from('persist-check')
    await medulla.savePhoto('photo-5', img)
    const dir = medulla.storageDir
    await medulla.close()
    const m2 = new Medulla(dir)
    await m2.ready()
    const got = await m2.getPhoto('photo-5')
    expect(got.buffer.equals(img)).toBe(true)
    await m2.close()
  })
})

afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }) })
