import ApiError from '../utils/ApiError.js';

/**
 * Validate a request section (body | query | params) against a Joi schema.
 */
export const validate = (schema, source = 'body') =>
  function validateMiddleware(req, _res, next) {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      const details = error.details.map((d) => d.message.replace(/"/g, "'"));
      return next(ApiError.badRequest('Invalid input', details));
    }
    req[source] = value;
    return next();
  };

export default validate;
