import { ApiProperty } from '@nestjs/swagger';

import { PAGINATION, SWAGGER_EXAMPLE } from '../constants';

/** Paging counters attached to every list response. */
export class PaginationMetaDto {
  @ApiProperty({ description: 'Current page number.', example: SWAGGER_EXAMPLE.PAGE })
  page: number;

  @ApiProperty({ description: 'Records requested per page.', example: SWAGGER_EXAMPLE.LIMIT })
  limit: number;

  @ApiProperty({
    description: 'Total records matching the filter, ignoring paging.',
    example: SWAGGER_EXAMPLE.TOTAL,
  })
  total: number;

  @ApiProperty({ description: 'Total number of pages available.', example: 7 })
  totalPages: number;

  @ApiProperty({ description: 'Whether a next page exists.', example: true })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether a previous page exists.', example: false })
  hasPreviousPage: boolean;

  constructor(page: number, limit: number, total: number) {
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    this.page = page;
    this.limit = limit;
    this.total = total;
    this.totalPages = totalPages;
    this.hasNextPage = page < totalPages;
    this.hasPreviousPage = page > PAGINATION.DEFAULT_PAGE && total > 0;
  }
}

/**
 * The payload placed in `data` by list endpoints.
 *
 * Keeping `items` and `meta` together — rather than putting `meta` beside
 * `data` in the envelope — means a paginated payload survives being passed
 * around as a single value.
 */
export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'Records for the requested page.', isArray: true })
  items: T[];

  @ApiProperty({ description: 'Paging counters.', type: PaginationMetaDto })
  meta: PaginationMetaDto;

  constructor(items: T[], meta: PaginationMetaDto) {
    this.items = items;
    this.meta = meta;
  }

  /** Builds a page straight from a TypeORM `findAndCount()` result. */
  static from<T>([items, total]: [T[], number], page: number, limit: number) {
    return new PaginatedResponseDto<T>(items, new PaginationMetaDto(page, limit, total));
  }
}
