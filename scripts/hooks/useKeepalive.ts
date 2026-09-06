import { useEffect, useRef, useCallback, useState } from 'react'

const PING_INTERVAL_MS = 1500 // ping every 1.5 seconds
const FAIL_THRESHOLD = 2       // alert after 2 consecutive failures

export function useKeepalive() {
  const [backendDown, setBackendDown] = useState(false)
  const consecutiveFailures = useRef(0)
  const alertShown = useRef(false)

  const ping = useCallback(async () => {
    try {
      const res = await fetch('/api/ping', { method: 'GET', cache: 'no-store' })
      if (res.ok) {
        consecutiveFailures.current = 0
        if (backendDown) setBackendDown(false)
        alertShown.current = false
      } else {
        throw new Error('non-ok response')
      }
    } catch {
      consecutiveFailures.current += 1
      if (consecutiveFailures.current >= FAIL_THRESHOLD && !alertShown.current) {
        alertShown.current = true
        setBackendDown(true)
        alert('⚠️ 應用程序已離線或被系統關閉。\n請重新啟動應用程序後再繼續操作。')
      }
    }
  }, [backendDown])

  useEffect(() => {
    // Initial ping on mount
    ping()
    const id = setInterval(ping, PING_INTERVAL_MS)
    return () => clearInterval(id)
  }, [ping])

  return { backendDown }
}
