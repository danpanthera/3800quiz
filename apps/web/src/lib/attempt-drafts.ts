export interface AttemptDraft {
  attemptId: string
  answerRevision: number
  answers: Record<string, string[]>
  updatedAt: string
}

const DATABASE_NAME = '3800quiz-web'
const DATABASE_VERSION = 1
const STORE_NAME = 'attempt-drafts'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'attemptId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

export async function getAttemptDraft(attemptId: string): Promise<AttemptDraft | undefined> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(attemptId)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result as AttemptDraft | undefined)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => database.close()
  })
}

export async function saveAttemptDraft(draft: AttemptDraft): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(draft)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error)
    }
  })
}

export async function deleteAttemptDraft(attemptId: string): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(attemptId)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error)
    }
  })
}