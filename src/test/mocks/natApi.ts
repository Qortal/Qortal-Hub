export async function createClient() {
  return {
    close: () => undefined,
    externalIp: async () => '127.0.0.1',
    map: async () => undefined,
    unmap: async () => undefined,
  };
}

export default {
  createClient,
};

