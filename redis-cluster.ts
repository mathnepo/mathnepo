import Redis from 'ioredis'
import type { Cluster } from 'ioredis'
import { settings } from './settings'
import { emsLogger } from './util/logging'

let redisCluster: Cluster | undefined

// Keep track of last error to suppress repeated identical error logs
let lastErrorMessage: string = ''
let lastErrorTimestamp: number = 0

export function initializeRedisCluster(): Cluster {
  if (!redisCluster) {
    redisCluster = new Redis.Cluster([
      {
        host: settings.CACHE_HOST,
        port: settings.CACHE_PORT,
      }
    ], {
      // ioredis cluster options
      clusterRetryStrategy: (times) => {
        const delay: number = Math.min(times * 1000, settings.CACHE_CMD_TIMEOUT_MS)
        emsLogger.warn(`Redis cluster reconnect attempt #${times}, retrying in ${delay}ms...`)

        return delay
      },

      enableOfflineQueue: !settings.CACHE_OFFLINE_QUEUE,
      // Use replicas by default in ioredis cluster (readOnly: true for replicas)
      scaleReads: 'slave', // read from replicas
      redisOptions: {
        tls: settings.CACHE_TLS ? {} : undefined,
      }
    })

    redisCluster.on('error', (err: Error) => {
      const now: number = Date.now()
      const msg: string = err.message || err.toString()

      if (msg !== lastErrorMessage || (now - lastErrorTimestamp) > settings.CACHE_ERROR_OUTPUT_MS) {
        emsLogger.error('Redis Cluster error:', err.message)
        lastErrorMessage = msg
        lastErrorTimestamp = now
      }
    })

    redisCluster.on('ready', () => {
      emsLogger.info(`Redis cluster initialized on: ${settings.CACHE_HOST}:${settings.CACHE_PORT}`)
    })
  }

  return redisCluster
}

async function isRedisAlive(cluster: Cluster, timeoutMs = settings.CACHE_CMD_TIMEOUT_MS): Promise<boolean> {
  try {
    return await Promise.race([
      cluster.ping().then(res => res === 'PONG'),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Redis ping timed out')), timeoutMs)
      )
    ])
  } catch (err) {
    emsLogger.error('Redis ping error:', err.message)

    return false
  }
}

export { redisCluster, isRedisAlive }