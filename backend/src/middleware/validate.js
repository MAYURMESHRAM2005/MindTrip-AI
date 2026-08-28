import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

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
      logger.warn(`[VALIDATE] Input validation failed for ${req.method} ${req.originalUrl} (${source}): ${details.join('; ')}`);
      return next(ApiError.badRequest('Invalid input', details));
    }
    logger.debug(`[VALIDATE] Input validated OK for ${req.method} ${req.originalUrl} (${source})`);
    req[source] = value;
    return next();
  };

export default validate;
