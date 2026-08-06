/**
 * Standard success response shape: { success, statusCode, message, data }
 */
export class ApiResponse {
  constructor(statusCode, message, data = null) {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
  }

  static ok(message, data) {
    return new ApiResponse(200, message, data);
  }

  static created(message, data) {
    return new ApiResponse(201, message, data);
  }
}

export default ApiResponse;
