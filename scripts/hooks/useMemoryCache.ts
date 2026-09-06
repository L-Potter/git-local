// Memory cache utility for browser storage
interface CacheItem<T> {
  data: T
  timestamp: number
  expiresAt: number
}

class MemoryCache {
  private cache = new Map<string, CacheItem<any>>()

  // Set data with expiration time (in milliseconds)
  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    const timestamp = Date.now()
    const expiresAt = timestamp + ttlMs

    this.cache.set(key, {
      data,
      timestamp,
      expiresAt
    })

    // Also store in sessionStorage for persistence across page reloads
    try {
      sessionStorage.setItem(`cache_${key}`, JSON.stringify({
        data,
        timestamp,
        expiresAt
      }))
    } catch (error) {
      console.warn('Failed to store in sessionStorage:', error)
    }
  }

  // Get data if not expired
  get<T>(key: string): T | null {
    // First check memory cache
    let item = this.cache.get(key)

    // If not in memory, try sessionStorage
    if (!item) {
      try {
        const stored = sessionStorage.getItem(`cache_${key}`)
        if (stored) {
          item = JSON.parse(stored)
          // Restore to memory cache if valid
          if (item && Date.now() < item.expiresAt) {
            this.cache.set(key, item)
          }
        }
      } catch (error) {
        console.warn('Failed to load from sessionStorage:', error)
      }
    }

    // Check if expired
    if (!item || Date.now() > item.expiresAt) {
      this.delete(key)
      return null
    }

    return item.data
  }

  // Delete specific key
  delete(key: string): void {
    this.cache.delete(key)
    try {
      sessionStorage.removeItem(`cache_${key}`)
    } catch (error) {
      console.warn('Failed to delete from sessionStorage:', error)
    }
  }

  // Clear all cache
  clear(): void {
    this.cache.clear()
    try {
      // Clear all cache items from sessionStorage
      const keys = Object.keys(sessionStorage)
      keys.forEach(key => {
        if (key.startsWith('cache_')) {
          sessionStorage.removeItem(key)
        }
      })
    } catch (error) {
      console.warn('Failed to clear sessionStorage:', error)
    }
  }

  // Get cache stats
  getStats(): { size: number, keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    }
  }
}

// Create singleton instance
const memoryCache = new MemoryCache()

// React hook for memory caching
export const useMemoryCache = () => {
  return {
    get: <T>(key: string): T | null => memoryCache.get<T>(key),
    set: <T>(key: string, data: T, ttlMs?: number): void => memoryCache.set(key, data, ttlMs),
    delete: (key: string): void => memoryCache.delete(key),
    clear: (): void => memoryCache.clear(),
    getStats: () => memoryCache.getStats()
  }
}

// Cache key constants
export const CACHE_KEYS = {
  CALENDAR_TAGS: 'calendar_tags',
  LEAVE_TYPES: 'leave_types',
  USERS: 'users',
  USER_PROFILE: (userId: number) => `user_profile_${userId}`,
  SHIFT_ASSIGNMENTS: (employeeId: string) => `shift_assignments_${employeeId}`
}

// Default TTL values (in milliseconds)
export const CACHE_TTL = {
  CALENDAR_TAGS: 12* 60 * 60 * 1000, // 12 hr
  LEAVE_TYPES: 12* 60  * 60 * 1000,   // 12 hr
  USERS:  12* 60 * 60 * 1000,          // 12 hr
  USER_PROFILE: 5 * 60 * 1000,   // 5 minutes
  SHIFT_ASSIGNMENTS: 5 * 60 * 1000 // 5 minutes
}

export default memoryCache
