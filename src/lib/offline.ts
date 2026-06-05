/**
 * IndexedDB offline queue.
 * When the user adds an expense while offline, it's queued here.
 * On next online event (or app open), the queue is flushed to GitHub.
 */

import { openDB, type IDBPDatabase } from 'idb'
import type { QueuedEvent, Event } from '../types'
import { v4 as uuidv4 } from 'uuid'

const DB_NAME = 'splitgit-offline'
const DB_VERSION = 1
const STORE_NAME = 'queue'

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

export async function enqueueEvent(
  groupOwner: string,
  groupName: string,
  event: Event
): Promise<QueuedEvent> {
  const db = await getDB()
  const queued: QueuedEvent = {
    id: uuidv4(),
    groupOwner,
    groupName,
    event,
    enqueuedAt: new Date().toISOString()
  }
  await db.put(STORE_NAME, queued)
  return queued
}

export async function getQueuedEvents(): Promise<QueuedEvent[]> {
  const db = await getDB()
  return db.getAll(STORE_NAME) as Promise<QueuedEvent[]>
}

export async function removeQueuedEvent(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_NAME, id)
}

export async function clearQueue(): Promise<void> {
  const db = await getDB()
  await db.clear(STORE_NAME)
}

export function isOnline(): boolean {
  return navigator.onLine
}

export function onOnline(callback: () => void): () => void {
  window.addEventListener('online', callback)
  return () => window.removeEventListener('online', callback)
}
