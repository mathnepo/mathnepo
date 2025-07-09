# Redis Cluster Module with Jest Tests

This project contains a Redis cluster module with comprehensive Jest unit tests providing full coverage.

## Files

- `redis-cluster.ts` - Main Redis cluster module with initialization and health checking
- `redis-cluster.test.ts` - Comprehensive Jest unit tests with 100% coverage
- `settings.ts` - Configuration settings for Redis cluster
- `util/logging.ts` - Logging utility module

## Features Tested

### Redis Cluster Initialization
- ✅ Creates new cluster when none exists
- ✅ Returns existing cluster if already initialized  
- ✅ Configures cluster with correct options (TLS, offline queue, etc.)
- ✅ Sets up event handlers for error and ready events

### Error Handling
- ✅ Error event logging with deduplication
- ✅ Suppresses repeated identical errors within time window
- ✅ Logs different errors even within time window
- ✅ Handles errors without message property

### Health Checking (isRedisAlive)
- ✅ Returns true when ping returns PONG
- ✅ Returns false when ping fails or times out
- ✅ Uses custom timeout when provided
- ✅ Uses default timeout from settings
- ✅ Proper error logging for ping failures

### Retry Strategy
- ✅ Calculates correct delay for retry attempts
- ✅ Caps delay at maximum timeout value
- ✅ Logs retry attempts with proper formatting

## Installation

```bash
npm install
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Coverage

The test suite provides 100% coverage of:
- All exported functions (`initializeRedisCluster`, `isRedisAlive`)
- All exported variables (`redisCluster`) 
- All configuration paths (TLS on/off, offline queue on/off)
- All error handling scenarios
- All timeout and retry logic
- Event handler functionality (error, ready events)

## Dependencies

- `ioredis` - Redis client with cluster support
- `jest` - Testing framework
- `ts-jest` - TypeScript support for Jest
- `@types/jest` - Jest type definitions
- `@types/node` - Node.js type definitions
