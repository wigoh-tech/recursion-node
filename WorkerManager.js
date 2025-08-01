class WorkerManager {
    constructor(workerScript) {
      this.workerScript = workerScript;
      this.messageId = 0;
      this.pendingRequests = new Map();
      this.processor = null;
    }
  
    setProcessor(processor) {
      this.processor = processor;
    }
  
    async init() {
      const registration = await navigator.serviceWorker.register(this.workerScript);
      this.worker = registration.active || registration.waiting || registration.installing;
      
      if (!this.worker) {
        await navigator.serviceWorker.ready;
        this.worker = registration.active;
      }
  
      navigator.serviceWorker.addEventListener('message', this.handleMessage.bind(this));
    }
  
    handleMessage(event) {
      const { messageId, result, error } = event.data;
      const request = this.pendingRequests.get(messageId);
      
      if (request) {
        this.pendingRequests.delete(messageId);
        error ? request.reject(new Error(error)) : request.resolve(result);
      }
    }
  
    async process(payload) {
      return new Promise((resolve, reject) => {
        const messageId = ++this.messageId;
        this.pendingRequests.set(messageId, { resolve, reject });
        
        this.worker.postMessage({ messageId, payload });
        
        setTimeout(() => {
          if (this.pendingRequests.has(messageId)) {
            this.pendingRequests.delete(messageId);
            reject(new Error('Timeout after 180 seconds'));
          }
        }, 180000);
      });
    }
  }