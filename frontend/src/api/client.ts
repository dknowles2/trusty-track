const API_BASE_URL = '/api'; // Vite proxy will handle this

async function handleResponse(response: Response) {
  if (!response.ok) {
    let errorDetail = response.statusText;
    try {
      const errorBody = await response.json();
      if (errorBody && errorBody.detail) {
        if (Array.isArray(errorBody.detail)) {
          // Handle Pydantic validation errors (array of objects)
          errorDetail = errorBody.detail
            .map((err: any) => err.msg || JSON.stringify(err))
            .join('; ');
        } else {
          errorDetail = errorBody.detail;
        }
      }
    } catch (e) {
      // Not a JSON error or other issue, use statusText
    }
    throw new Error(errorDetail);
  }
  return response.json();
}

export const apiClient = {
  get: async <T = any>(endpoint: string): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);
    return handleResponse(response);
  },
  post: async <T = any>(endpoint: string, data: any): Promise<T> => {
    const isFormData = data instanceof FormData;
    const headers: HeadersInit = isFormData ? {} : { 'Content-Type': 'application/json' };
  
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: headers,
      body: isFormData ? data : JSON.stringify(data),
    });
    return handleResponse(response);
  },
  put: async <T = any>(endpoint: string, data: any): Promise<T> => {
    const isFormData = data instanceof FormData;
    const headers: HeadersInit = isFormData ? {} : { 'Content-Type': 'application/json' };
  
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: headers,
      body: isFormData ? data : JSON.stringify(data),
    });
    return handleResponse(response);
  },
  delete: async <T = any>(endpoint: string): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
    });
    return handleResponse(response);
  }
};
