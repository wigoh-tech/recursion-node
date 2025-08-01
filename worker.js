// worker.js - Service Worker
self.addEventListener('message', async (event) => {
    const { messageId, payload, businessLogic } = event.data;
    
    try {
      // Inject and execute business logic
      if (businessLogic) {
        eval(businessLogic);
      }
      
      const result = await optimizeBgLayersWithAI(payload.html, payload.id);
      
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({ messageId, result });
      });
      
    } catch (error) {
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({ messageId, error: error.message });
      });
    }
  });
  