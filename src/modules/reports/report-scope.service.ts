import { Injectable } from '@nestjs/common';

import { COMMON_ERROR, ERROR_CODE } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { BusinessException } from '../../common/exceptions/business.exception';
import { InstantRange, istDateSpan, istToday } from '../../common/utils';
import { ProjectAccessService } from '../access/project-access.service';

export interface ResolvedRange extends InstantRange {
  from: string;
  to: string;
}

/**
 * The project scope and date window every report runs in.
 *
 * Scope is `null` for "every project" (Super Admin only) and otherwise an
 * explicit id list — possibly empty, which must match nothing. Every report
 * query takes it as `$n::uuid[]` with `($n IS NULL OR project_id = ANY($n))`,
 * so a moderator's numbers, lists and exports can only ever cover his
 * projects (PRD §5.12, §9).
 */
@Injectable()
export class ReportScopeService {
  constructor(private readonly access: ProjectAccessService) {}

  async projectScope(actor: AuthenticatedUser, projectId?: string): Promise<string[] | null> {
    if (projectId) {
      if (this.access.isSuperAdmin(actor)) {
        await this.access.findProjectOrFail(projectId);
      } else {
        await this.access.assertCanView(actor, projectId);
      }
      return [projectId];
    }

    return (await this.access.scopeProjectIds(actor)) ?? null;
  }

  /** `from`–`to` inclusive, India dates; either missing means today. */
  range(from?: string, to?: string): ResolvedRange {
    const today = istToday();
    const start = from ?? to ?? today;
    const end = to ?? from ?? today;

    if (start > end) {
      throw new BusinessException(COMMON_ERROR.INVALID_DATE_RANGE, ERROR_CODE.VALIDATION_FAILED);
    }
    return { from: start, to: end, ...istDateSpan(start, end) };
  }
}
