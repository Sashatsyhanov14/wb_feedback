/**
 * Simple In-Memory Cache with TTL
 */
class CacheService {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Set a value in cache
   * @param {string} key 
   * @param {any} value 
   * @param {number} ttlMinutes - Time to live in minutes
   */
  set(key, value, ttlMinutes = 60) {
    const expiresAt = Date.now() + (ttlMinutes * 60 * 1000);
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Get a value from cache
   * @param {string} key 
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  /**
   * Remove a value from cache
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
  }
}

module.exports = new CacheService();
