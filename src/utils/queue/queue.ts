export class RequestQueueWithPromise {
  constructor(maxConcurrent = 5) {
    this.queue = [];
    this.maxConcurrent = maxConcurrent;
    this.currentlyProcessing = 0;
    this.isPaused = false; // Flag to track whether the queue is paused
  }

  // Add a request to the queue and return a promise
  enqueue(request) {
    return new Promise((resolve, reject) => {
      // Push the request and its resolve and reject callbacks to the queue
      this.queue.push({ request, resolve, reject });
      this.process();
    });
  }

  // Process requests in the queue
  async process() {
    // Process requests only if the queue is not paused
    if (this.isPaused) return;

    while (
      this.queue.length > 0 &&
      this.currentlyProcessing < this.maxConcurrent
    ) {
      this.currentlyProcessing++;

      const { request, resolve, reject } = this.queue.shift();

      try {
        const response = await request();
        resolve(response);
      } catch (error) {
        reject(error);
      } finally {
        this.currentlyProcessing--;
        await this.process();
      }
    }
  }

  // Pause the queue processing
  pause() {
    this.isPaused = true;
  }

  // Resume the queue processing
  resume() {
    this.isPaused = false;
    this.process(); // Continue processing when resumed
  }

  // Clear pending requests in the queue
  clear() {
    this.queue.length = 0;
  }
}
