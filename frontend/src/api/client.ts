const API_BASE_URL = '/api'; // Vite proxy will handle this

export const apiClient = {
  get: async (endpoint: string) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);
    if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
    }
    return response.json();
  },
  post: async (endpoint: string, data: any) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
     if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
    }
    return response.json();
  },
    // Add put/delete as needed
};
