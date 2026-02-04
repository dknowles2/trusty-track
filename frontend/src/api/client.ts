const API_BASE_URL = '/api'; // Vite proxy will handle this

async function handleResponse(response: Response) {
  if (!response.ok) {
    let errorDetail = response.statusText;
    try {
      const errorBody = await response.json();
      if (errorBody && errorBody.detail) {
        errorDetail = errorBody.detail;
      }
    } catch (e) {
      // Not a JSON error or other issue, use statusText
    }
    throw new Error(errorDetail);
  }
  return response.json();
}

export const apiClient = {
  get: async (endpoint: string) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);
    return handleResponse(response);
  },
  post: async (endpoint: string, data: any) => {
    const isFormData = data instanceof FormData;
    const headers: HeadersInit = isFormData ? {} : { 'Content-Type': 'application/json' };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: headers,
      body: isFormData ? data : JSON.stringify(data),
    });
    return handleResponse(response);
  },
  put: async (endpoint: string, data: any) => {
    const isFormData = data instanceof FormData;
    const headers: HeadersInit = isFormData ? {} : { 'Content-Type': 'application/json' };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: headers,
      body: isFormData ? data : JSON.stringify(data),
    });
    return handleResponse(response);
  },
  delete: async (endpoint: string) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
    });
    return handleResponse(response);
  }
};
