import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  validateSync,
} from 'class-validator';

import { IsIsoDate } from './is-iso-date.validator';
import { plainValidationException } from './validation-messages';

class Sample {
  @IsUUID('4')
  ownerId!: unknown;

  @IsString()
  @MaxLength(5)
  name!: unknown;

  @IsIsoDate()
  startsOn!: unknown;

  @IsEmail()
  @IsNotEmpty()
  email!: unknown;

  @Matches(/^\d$/u, { message: 'Version must look like 1.2.0.' })
  version!: unknown;
}

const messagesFor = (values: Record<string, unknown>): string[] => {
  const sample = Object.assign(new Sample(), values);
  const response = plainValidationException(validateSync(sample)).getResponse();
  return (response as { message: string[] }).message;
};

describe('plainValidationException', () => {
  it('words class-validator rules in plain language, field name first', () => {
    const messages = messagesFor({
      ownerId: 'not-an-id',
      name: 'Too long a name',
      startsOn: '2026-02-31',
      email: 'ravi',
      version: '1',
    });

    expect(messages).toEqual([
      'ownerId must be picked from the list',
      'name can be at most 5 characters',
      'startsOn must be a date',
      'email must be a full email address, like name@example.com',
    ]);
    expect(messages.join(' ')).not.toMatch(/UUID|ISO|valid/u);
  });

  it('keeps a message the DTO wrote itself', () => {
    expect(messagesFor({ ownerId: undefined, version: 'x' })).toContain(
      'version Version must look like 1.2.0.',
    );
  });
});
