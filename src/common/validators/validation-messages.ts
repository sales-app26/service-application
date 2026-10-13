import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

/**
 * class-validator's own wording ("must be a UUID", "must be a valid ISO 8601
 * date string", "property x should not exist") lands under a form field on a
 * rep's phone. This rewrites it in plain words, per rule.
 *
 * Each message keeps the shape `<field> <text>` — the exception filter groups
 * by the first word and the portal drops it before showing the rest — so only
 * the text after the field name changes. A message a DTO wrote itself (a
 * `message:` option) is kept as written.
 */
const PLAIN_TEXT: Record<string, (limit: string | undefined) => string> = {
  isNotEmpty: () => 'can’t be empty',
  isDefined: () => 'is needed',
  isString: () => 'must be text',
  maxLength: (n) => (n ? `can be at most ${n} characters` : 'is too long'),
  minLength: (n) => (n ? `needs at least ${n} characters` : 'is too short'),
  isUuid: () => 'must be picked from the list',
  isEnum: () => 'must be picked from the list',
  isIn: () => 'must be picked from the list',
  isIsoDate: () => 'must be a date',
  isDateString: () => 'must be a date',
  isBoolean: () => 'must be yes or no',
  isInt: () => 'must be a whole number',
  isNumber: () => 'must be a number',
  min: (n) => (n ? `must be at least ${n}` : 'is too small'),
  max: (n) => (n ? `can be at most ${n}` : 'is too big'),
  isEmail: () => 'must be a full email address, like name@example.com',
  isArray: () => 'must be a list',
  arrayMinSize: (n) => (n ? `needs at least ${n}` : 'needs more'),
  arrayMaxSize: (n) => (n ? `can have at most ${n}` : 'has too many'),
  arrayUnique: () => 'has the same choice twice',
  isObject: () => 'isn’t filled in properly',
  matches: () => 'doesn’t look right',
  whitelistValidation: () => 'isn’t used here',
};

const FALLBACK = 'doesn’t look right';

/** class-validator's defaults name the property first; a DTO's own message does not. */
const isDefaultMessage = (message: string, property: string): boolean =>
  message.startsWith(`${property} `) ||
  message.startsWith(`each value in ${property} `) ||
  message.startsWith(`property ${property} `);

const plainMessages = (errors: ValidationError[], parentPath = ''): string[] =>
  errors.flatMap((error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = Object.entries(error.constraints ?? {}).map(([rule, message]) => {
      if (!isDefaultMessage(message, error.property)) return `${path} ${message}`;
      const limit = /\d+/u.exec(message)?.[0];
      return `${path} ${PLAIN_TEXT[rule]?.(limit) ?? FALLBACK}`;
    });
    return [...own, ...plainMessages(error.children ?? [], path)];
  });

/** `ValidationPipe({ exceptionFactory })`: the same 400, worded for people. */
export const plainValidationException = (errors: ValidationError[]): BadRequestException =>
  new BadRequestException(plainMessages(errors));
