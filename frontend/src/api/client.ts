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
    const isFormData = data instanceof FormData;
    const headers: HeadersInit = isFormData ? {} : { 'Content-Type': 'application/json' };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: headers,
      body: isFormData ? data : JSON.stringify(data),
    });
     if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
    }
    return response.json();
  },
  put: async (endpoint: string, data: any) => {
    const isFormData = data instanceof FormData;
    const headers: HeadersInit = isFormData ? {} : { 'Content-Type': 'application/json' };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: headers,
      body: isFormData ? data : JSON.stringify(data),
    });
    if (!response.ok) {
       throw new Error(`API Error: ${response.statusText}`);
    }
    return response.json();
  },
  delete: async (endpoint: string) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
       throw new Error(`API Error: ${response.statusText}`);
    }
    return response.json();
  }
};
