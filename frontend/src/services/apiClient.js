import api from './api';

/**
 * All backend endpoints as small functions. Components never call axios directly.
 */
export const authApi = {
  register: (payload) => api.post('/auth/register', payload),
  login: (payload) => api.post('/auth/login', payload),
  logout: () => api.post('/auth/logout'),
  refresh: () => api.post('/auth/refresh'),
  me: () => api.get('/auth/me'),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, password) => api.post(`/auth/reset-password/${token}`, { password }),
  verifyEmail: (token) => api.get(`/auth/verify-email/${token}`),
  googleToken: (idToken) => api.post('/auth/google/token', { idToken }),
};

export const userApi = {
  me: () => api.get('/users/me'),
  update: (payload) => api.patch('/users/me', payload),
  preferences: () => api.get('/users/preferences'),
  updatePreferences: (payload) => api.patch('/users/preferences', payload),
  deleteAccount: () => api.delete('/users/me'),
  saveDestination: (destination) => api.post('/users/destinations', { destination }),
};

export const tripApi = {
  generate: (payload) => api.post('/trips/generate', payload),
  list: () => api.get('/trips'),
  get: (id) => api.get(`/trips/${id}`),
  update: (id, payload) => api.patch(`/trips/${id}`, payload),
  remove: (id) => api.delete(`/trips/${id}`),
  itinerary: (id) => api.get(`/trips/${id}/itinerary`),
  optimizeBudget: (id) => api.post(`/trips/${id}/optimize-budget`),
  makeCheaper: (id) => api.post(`/trips/${id}/make-cheaper`),
  replaceHotel: (id) => api.post(`/trips/${id}/replace-hotel`),
  moveActivity: (id, payload) => api.post(`/trips/${id}/activities/move`, payload),
  pdfUrl: (id) => `/api/trips/${id}/pdf`,
  chat: (id, payload) => api.post(`/trips/${id}/chat`, payload),
};

export const hotelsApi = {
  search: (params) => api.get('/hotels/search', { params }),
};

export const flightsApi = {
  search: (params) => api.get('/flights/search', { params }),
};

export const trainsApi = {
  search: (params) => api.get('/trains/search', { params }),
};

export const busesApi = {
  search: (params) => api.get('/buses/search', { params }),
};

export const restaurantsApi = {
  search: (params) => api.get('/restaurants/search', { params }),
};

export const placesApi = {
  search: (params) => api.get('/places/search', { params }),
  nearby: (params) => api.get('/places/nearby', { params }),
  saved: () => api.get('/places/saved'),
  savePlace: (payload) => api.post('/places/saved', payload),
  deleteSaved: (id) => api.delete(`/places/saved/${id}`),
  photo: (ref) => api.get('/places/photo', { params: { ref } }),
  imageSearch: (formData) => api.post('/places/image-search', formData),
};

export const mapsApi = {
  geocode: (address) => api.get('/maps/geocode', { params: { address } }),
  directions: (params) => api.get('/maps/directions', { params }),
  nearby: (params) => api.get('/maps/nearby', { params }),
};

export const weatherApi = {
  current: (params) => api.get('/weather/current', { params }),
  forecast: (params) => api.get('/weather/forecast', { params }),
};

export const currencyApi = {
  rates: () => api.get('/currency/rates'),
  convert: (params) => api.get('/currency/convert', { params }),
};

export const chatApi = {
  send: (payload) => api.post('/chat', payload),
  history: () => api.get('/chat/history'),
  clear: () => api.delete('/chat/history'),
};

export const voiceApi = {
  command: (payload) => api.post('/voice/command', payload),
};

export const expensesApi = {
  list: (params) => api.get('/expenses', { params }),
  add: (payload) => api.post('/expenses', payload),
  update: (id, payload) => api.patch(`/expenses/${id}`, payload),
  remove: (id) => api.delete(`/expenses/${id}`),
  summary: (params) => api.get('/expenses/summary', { params }),
  analyze: (params) => api.get('/expenses/analyze', { params }),
};

export const ticketsApi = {
  list: (params) => api.get('/tickets', { params }),
  add: (payload) => api.post('/tickets', payload),
  remove: (id) => api.delete(`/tickets/${id}`),
  qr: (id) => api.post(`/tickets/${id}/qr`),
};

export const emergencyApi = {
  nearby: (params) => api.get('/emergency/nearby', { params }),
  contacts: () => api.get('/emergency/contacts'),
  addContact: (payload) => api.post('/emergency/contacts', payload),
  updateContact: (id, payload) => api.patch(`/emergency/contacts/${id}`, payload),
  deleteContact: (id) => api.delete(`/emergency/contacts/${id}`),
};

export const notificationsApi = {
  list: () => api.get('/notifications'),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
  clear: () => api.delete('/notifications'),
};

export const translateApi = {
  translate: (text, target) => api.post('/translate', { text, target }),
};

export const adminApi = {
  stats: () => api.get('/admin/stats'),
  users: (params) => api.get('/admin/users', { params }),
  updateUser: (id, payload) => api.patch(`/admin/users/${id}`, payload),
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  trips: () => api.get('/admin/trips'),
  aiUsage: (days) => api.get('/admin/ai-usage', { params: { days } }),
  providers: () => api.get('/admin/providers'),
  errors: (days) => api.get('/admin/errors', { params: { days } }),
  analytics: () => api.get('/admin/analytics'),
};

export const healthApi = {
  check: () => api.get('/health'),
};

export default { authApi, userApi, tripApi, hotelsApi, flightsApi, trainsApi, busesApi, restaurantsApi, placesApi, mapsApi, weatherApi, currencyApi, chatApi, voiceApi, expensesApi, ticketsApi, emergencyApi, notificationsApi, translateApi, adminApi, healthApi };
