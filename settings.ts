export const settings = {
  CACHE_HOST: process.env.CACHE_HOST || 'localhost',
  CACHE_PORT: parseInt(process.env.CACHE_PORT || '6379', 10),
  CACHE_CMD_TIMEOUT_MS: parseInt(process.env.CACHE_CMD_TIMEOUT_MS || '5000', 10),
  CACHE_OFFLINE_QUEUE: process.env.CACHE_OFFLINE_QUEUE === 'true',
  CACHE_TLS: process.env.CACHE_TLS === 'true',
  CACHE_ERROR_OUTPUT_MS: parseInt(process.env.CACHE_ERROR_OUTPUT_MS || '10000', 10),
}