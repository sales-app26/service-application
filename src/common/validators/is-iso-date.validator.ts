import { ValidateBy, ValidationOptions, buildMessage } from 'class-validator';

import { isValidIsoDate } from '../utils/ist-time.util';

/**
 * A real calendar date as `YYYY-MM-DD` — no time, no zone, no 31 February.
 *
 * Dates in this API are calendar days in India (a next follow-up date, a
 * project's end date), so a timestamp would carry a time zone it has no use
 * for and invite the "5h30m early" bug.
 */
export const IsIsoDate = (options?: ValidationOptions): PropertyDecorator =>
  ValidateBy(
    {
      name: 'isIsoDate',
      validator: {
        validate: (value: unknown): boolean => typeof value === 'string' && isValidIsoDate(value),
        defaultMessage: buildMessage(
          (prefix) => `${prefix}$property must be a calendar date as YYYY-MM-DD`,
          options,
        ),
      },
    },
    options,
  );
