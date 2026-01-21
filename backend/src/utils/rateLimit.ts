interface QueueItem {
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export class RateLimiter {
  private queue: QueueItem[] = [];
  private processing = false;
  private minInterval: number;

  constructor(requestsPerMinute: number) {
    // Convert requests per minute to milliseconds between requests
    this.minInterval = (60 * 1000) / requestsPerMinute;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }

      // Wait before processing next request
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.minInterval));
      }
    }

    this.processing = false;
  }
}
