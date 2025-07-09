import Redis from 'ioredis'
import type { Cluster } from 'ioredis'
import { initializeRedisCluster, redisCluster, isRedisAlive } from './redis-cluster'
import { settings } from './settings'
import { emsLogger } from './util/logging'

// Mock dependencies
jest.mock('ioredis')
jest.mock('./settings')
jest.mock('./util/logging')

const mockRedis = Redis as jest.MockedClass<typeof Redis>
const mockSettings = settings as jest.Mocked<typeof settings>
const mockLogger = emsLogger as jest.Mocked<typeof emsLogger>

describe('Redis Cluster Module', () => {
  let mockCluster: jest.Mocked<Cluster>
  let mockClusterConstructor: jest.MockedClass<typeof Redis.Cluster>

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    
    // Reset module state by clearing the cluster instance
    // This is needed because the module maintains state
    delete require.cache[require.resolve('./redis-cluster')]
    
    // Mock cluster instance
    mockCluster = {
      ping: jest.fn(),
      on: jest.fn(),
      quit: jest.fn(),
      disconnect: jest.fn(),
    } as any

    // Mock Redis.Cluster constructor
    mockClusterConstructor = jest.fn(() => mockCluster) as any
    mockRedis.Cluster = mockClusterConstructor

    // Mock settings
    mockSettings.CACHE_HOST = 'test-host'
    mockSettings.CACHE_PORT = 6379
    mockSettings.CACHE_CMD_TIMEOUT_MS = 5000
    mockSettings.CACHE_OFFLINE_QUEUE = false
    mockSettings.CACHE_TLS = false
    mockSettings.CACHE_ERROR_OUTPUT_MS = 10000

    // Mock logger
    mockLogger.warn = jest.fn()
    mockLogger.error = jest.fn()
    mockLogger.info = jest.fn()

    // Mock Date.now for error timestamp testing
    jest.spyOn(Date, 'now').mockReturnValue(1000000)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('initializeRedisCluster', () => {
    it('should create a new Redis cluster when none exists', () => {
      const cluster = initializeRedisCluster()

      expect(mockClusterConstructor).toHaveBeenCalledTimes(1)
      expect(mockClusterConstructor).toHaveBeenCalledWith(
        [{ host: 'test-host', port: 6379 }],
        expect.objectContaining({
          clusterRetryStrategy: expect.any(Function),
          enableOfflineQueue: true, // !settings.CACHE_OFFLINE_QUEUE (false) = true
          scaleReads: 'slave',
          redisOptions: {
            tls: undefined, // settings.CACHE_TLS is false
          }
        })
      )
      expect(cluster).toBe(mockCluster)
    })

    it('should return existing cluster if already initialized', () => {
      const cluster1 = initializeRedisCluster()
      const cluster2 = initializeRedisCluster()

      expect(mockClusterConstructor).toHaveBeenCalledTimes(1)
      expect(cluster1).toBe(cluster2)
      expect(cluster1).toBe(mockCluster)
    })

    it('should configure TLS when CACHE_TLS is true', () => {
      mockSettings.CACHE_TLS = true

      initializeRedisCluster()

      expect(mockClusterConstructor).toHaveBeenCalledWith(
        [{ host: 'test-host', port: 6379 }],
        expect.objectContaining({
          redisOptions: {
            tls: {},
          }
        })
      )
    })

    it('should configure offline queue correctly', () => {
      mockSettings.CACHE_OFFLINE_QUEUE = true

      initializeRedisCluster()

      expect(mockClusterConstructor).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          enableOfflineQueue: false, // !true = false
        })
      )
    })

    describe('clusterRetryStrategy', () => {
      it('should return correct delay for retry attempts', () => {
        initializeRedisCluster()

        const clusterConfig = mockClusterConstructor.mock.calls[0][1]
        const retryStrategy = clusterConfig.clusterRetryStrategy

        const delay1 = retryStrategy(1)
        const delay5 = retryStrategy(5)
        const delay10 = retryStrategy(10)

        expect(delay1).toBe(1000) // Math.min(1 * 1000, 5000)
        expect(delay5).toBe(5000) // Math.min(5 * 1000, 5000)
        expect(delay10).toBe(5000) // Math.min(10 * 1000, 5000) - capped at timeout

        expect(mockLogger.warn).toHaveBeenCalledWith('Redis cluster reconnect attempt #1, retrying in 1000ms...')
        expect(mockLogger.warn).toHaveBeenCalledWith('Redis cluster reconnect attempt #5, retrying in 5000ms...')
        expect(mockLogger.warn).toHaveBeenCalledWith('Redis cluster reconnect attempt #10, retrying in 5000ms...')
      })
    })

    describe('event handlers', () => {
      it('should set up error event handler', () => {
        initializeRedisCluster()

        expect(mockCluster.on).toHaveBeenCalledWith('error', expect.any(Function))
        expect(mockCluster.on).toHaveBeenCalledWith('ready', expect.any(Function))
      })

      it('should handle error events and log unique errors', () => {
        initializeRedisCluster()

        const errorHandler = mockCluster.on.mock.calls.find(call => call[0] === 'error')[1]
        const testError = new Error('Connection failed')

        errorHandler(testError)

        expect(mockLogger.error).toHaveBeenCalledWith('Redis Cluster error:', 'Connection failed')
      })

      it('should suppress repeated identical error messages within time window', () => {
        mockSettings.CACHE_ERROR_OUTPUT_MS = 5000
        initializeRedisCluster()

        const errorHandler = mockCluster.on.mock.calls.find(call => call[0] === 'error')[1]
        const testError = new Error('Connection failed')

        // First error
        jest.spyOn(Date, 'now').mockReturnValue(1000)
        errorHandler(testError)
        expect(mockLogger.error).toHaveBeenCalledTimes(1)

        // Same error within time window - should be suppressed
        jest.spyOn(Date, 'now').mockReturnValue(3000) // 2 seconds later
        errorHandler(testError)
        expect(mockLogger.error).toHaveBeenCalledTimes(1) // Still 1

        // Same error after time window - should be logged
        jest.spyOn(Date, 'now').mockReturnValue(7000) // 6 seconds after first
        errorHandler(testError)
        expect(mockLogger.error).toHaveBeenCalledTimes(2)
      })

      it('should log different error messages even within time window', () => {
        initializeRedisCluster()

        const errorHandler = mockCluster.on.mock.calls.find(call => call[0] === 'error')[1]

        jest.spyOn(Date, 'now').mockReturnValue(1000)
        errorHandler(new Error('First error'))
        expect(mockLogger.error).toHaveBeenCalledTimes(1)

        jest.spyOn(Date, 'now').mockReturnValue(2000)
        errorHandler(new Error('Second error'))
        expect(mockLogger.error).toHaveBeenCalledTimes(2)
      })

      it('should handle errors without message property', () => {
        initializeRedisCluster()

        const errorHandler = mockCluster.on.mock.calls.find(call => call[0] === 'error')[1]
        const errorWithoutMessage = { toString: () => 'Error string representation' } as Error

        errorHandler(errorWithoutMessage)

        expect(mockLogger.error).toHaveBeenCalledWith('Redis Cluster error:', undefined)
      })

      it('should handle ready event', () => {
        initializeRedisCluster()

        const readyHandler = mockCluster.on.mock.calls.find(call => call[0] === 'ready')[1]
        readyHandler()

        expect(mockLogger.info).toHaveBeenCalledWith('Redis cluster initialized on: test-host:6379')
      })
    })
  })

  describe('isRedisAlive', () => {
    beforeEach(() => {
      mockSettings.CACHE_CMD_TIMEOUT_MS = 5000
    })

    it('should return true when ping returns PONG', async () => {
      mockCluster.ping.mockResolvedValue('PONG')

      const result = await isRedisAlive(mockCluster)

      expect(result).toBe(true)
      expect(mockCluster.ping).toHaveBeenCalledTimes(1)
    })

    it('should return false when ping returns non-PONG response', async () => {
      mockCluster.ping.mockResolvedValue('NOT_PONG')

      const result = await isRedisAlive(mockCluster)

      expect(result).toBe(false)
      expect(mockCluster.ping).toHaveBeenCalledTimes(1)
    })

    it('should return false when ping throws an error', async () => {
      const pingError = new Error('Ping failed')
      mockCluster.ping.mockRejectedValue(pingError)

      const result = await isRedisAlive(mockCluster)

      expect(result).toBe(false)
      expect(mockLogger.error).toHaveBeenCalledWith('Redis ping error:', 'Ping failed')
    })

    it('should return false when ping times out', async () => {
      // Mock ping to never resolve
      mockCluster.ping.mockImplementation(() => new Promise(() => {}))

      const result = await isRedisAlive(mockCluster, 100) // 100ms timeout

      expect(result).toBe(false)
      expect(mockLogger.error).toHaveBeenCalledWith('Redis ping error:', 'Redis ping timed out')
    })

    it('should use custom timeout when provided', async () => {
      mockCluster.ping.mockImplementation(() => new Promise(() => {}))

      const customTimeout = 200
      const startTime = Date.now()
      await isRedisAlive(mockCluster, customTimeout)
      const endTime = Date.now()

      // Should timeout around the custom timeout value (with some tolerance)
      expect(endTime - startTime).toBeGreaterThanOrEqual(customTimeout - 50)
      expect(endTime - startTime).toBeLessThan(customTimeout + 50)
    })

    it('should use default timeout from settings when no timeout provided', async () => {
      mockCluster.ping.mockImplementation(() => new Promise(() => {}))

      const startTime = Date.now()
      await isRedisAlive(mockCluster)
      const endTime = Date.now()

      // Should timeout around the default timeout value (with some tolerance)
      expect(endTime - startTime).toBeGreaterThanOrEqual(mockSettings.CACHE_CMD_TIMEOUT_MS - 50)
      expect(endTime - startTime).toBeLessThan(mockSettings.CACHE_CMD_TIMEOUT_MS + 50)
    })

    it('should handle errors without message property in ping', async () => {
      const errorWithoutMessage = { toString: () => 'Error string' } as Error
      mockCluster.ping.mockRejectedValue(errorWithoutMessage)

      const result = await isRedisAlive(mockCluster)

      expect(result).toBe(false)
      expect(mockLogger.error).toHaveBeenCalledWith('Redis ping error:', undefined)
    })
  })

  describe('module exports', () => {
    it('should export redisCluster as undefined initially', () => {
      // Import fresh module
      const { redisCluster: freshRedisCluster } = require('./redis-cluster')
      expect(freshRedisCluster).toBeUndefined()
    })

    it('should export redisCluster as cluster instance after initialization', () => {
      const cluster = initializeRedisCluster()
      const { redisCluster: moduleRedisCluster } = require('./redis-cluster')
      
      expect(moduleRedisCluster).toBe(cluster)
      expect(moduleRedisCluster).toBe(mockCluster)
    })
  })

  describe('integration scenarios', () => {
    it('should handle complete initialization flow', () => {
      const cluster = initializeRedisCluster()

      // Verify cluster creation
      expect(mockClusterConstructor).toHaveBeenCalledTimes(1)
      expect(cluster).toBe(mockCluster)

      // Verify event handlers are set up
      expect(mockCluster.on).toHaveBeenCalledWith('error', expect.any(Function))
      expect(mockCluster.on).toHaveBeenCalledWith('ready', expect.any(Function))

      // Simulate ready event
      const readyHandler = mockCluster.on.mock.calls.find(call => call[0] === 'ready')[1]
      readyHandler()
      expect(mockLogger.info).toHaveBeenCalledWith('Redis cluster initialized on: test-host:6379')

      // Test subsequent calls return same instance
      const cluster2 = initializeRedisCluster()
      expect(cluster2).toBe(cluster)
      expect(mockClusterConstructor).toHaveBeenCalledTimes(1) // Still only called once
    })
  })
})