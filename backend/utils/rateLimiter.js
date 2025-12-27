const logger = require('./logger');

/**
 * Rate Limiter for Twitter API calls
 * Implements token bucket algorithm with configurable limits
 */
class RateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 450;
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
    this.retryAfterMs = options.retryAfterMs || 60 * 1000; // 1 minute
    
    this.requests = [];
    this.isLimited = false;
    this.limitResetTime = null;
  }

  /**
   * Check if we can make a request
   * @throws Error if rate limited
   */
  async checkLimit() {
    const now = Date.now();

    // Check if we're in a forced rate limit period
    if (this.isLimited && this.limitResetTime && now < this.limitResetTime) {
      const waitTime = this.limitResetTime - now;
      logger.warn(`Rate limited, must wait ${Math.ceil(waitTime / 1000)}s`);
      throw new RateLimitError(waitTime);
    }

    // Reset limit if time has passed
    if (this.isLimited && this.limitResetTime && now >= this.limitResetTime) {
      this.isLimited = false;
      this.limitResetTime = null;
      this.requests = [];
    }

    // Remove old requests outside the window
    this.requests = this.requests.filter(
      timestamp => now - timestamp < this.windowMs
    );

    // Check if we've hit the limit
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const resetTime = oldestRequest + this.windowMs;
      const waitTime = resetTime - now;
      
      logger.warn(`Rate limit reached (${this.requests.length}/${this.maxRequests}), reset in ${Math.ceil(waitTime / 1000)}s`);
      throw new RateLimitError(waitTime);
    }

    // Record this request
    this.requests.push(now);
    
    return true;
  }

  /**
   * Force a rate limit (e.g., when Twitter returns 429)
   */
  forceLimit(resetTimeMs) {
    this.isLimited = true;
    this.limitResetTime = Date.now() + resetTimeMs;
    logger.warn(`Forced rate limit until ${new Date(this.limitResetTime).toISOString()}`);
  }

  /**
   * Get current rate limit status
   */
  getStatus() {
    const now = Date.now();
    this.requests = this.requests.filter(
      timestamp => now - timestamp < this.windowMs
    );

    return {
      remaining: Math.max(0, this.maxRequests - this.requests.length),
      limit: this.maxRequests,
      windowMs: this.windowMs,
      isLimited: this.isLimited,
      resetTime: this.limitResetTime ? new Date(this.limitResetTime).toISOString() : null
    };
  }

  /**
   * Wait if rate limited, then proceed
   */
  async waitIfLimited() {
    try {
      await this.checkLimit();
    } catch (error) {
      if (error instanceof RateLimitError) {
        logger.info(`Waiting ${Math.ceil(error.waitTime / 1000)}s for rate limit reset`);
        await new Promise(resolve => setTimeout(resolve, error.waitTime));
        return this.waitIfLimited(); // Recursive check after waiting
      }
      throw error;
    }
  }
}

/**
 * Custom error for rate limiting
 */
class RateLimitError extends Error {
  constructor(waitTime) {
    super(`Rate limit exceeded, retry after ${Math.ceil(waitTime / 1000)} seconds`);
    this.name = 'RateLimitError';
    this.waitTime = waitTime;
    this.retryAfter = Math.ceil(waitTime / 1000);
  }
}

module.exports = RateLimiter;
module.exports.RateLimitError = RateLimitError;
