import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { COMMON_ERROR, SUCCESS_MESSAGE, USER_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { EntryType, ProjectStatus, UserRole } from '../../common/enums';
import {
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { istDayRange, istToday } from '../../common/utils';
import { FollowUp, User } from '../../database/entities';
import { EntryPresenter } from '../leads/entry.presenter';
import { TimelineDto, TimelineQueryDto } from './dto/report.dto';
import { ReportScopeService } from './report-scope.service';

/**
 * One person's day, in time order (FR-14, PRD §5.11): time, lead, business,
 * status, note, typed location — and for visits the photo, map pin and GPS
 * accuracy, so an admin can check the photo against the place typed.
 *
 * Entries from several projects show together, each labelled with its
 * project. A moderator sees only the entries made in his projects.
 */
@Injectable()
export class TimelineService {
  constructor(
    @InjectRepository(FollowUp) private readonly followUps: Repository<FollowUp>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly scope: ReportScopeService,
    private readonly entryPresenter: EntryPresenter,
  ) {}

  async day(actor: AuthenticatedUser, query: TimelineQueryDto): Promise<TimelineDto> {
    const date = query.date ?? istToday();
    const userId = query.userId ?? actor.id;

    if (actor.role === UserRole.SALES_PERSON && userId !== actor.id) {
      throw new ForbiddenBusinessException(COMMON_ERROR.FORBIDDEN);
    }

    const person = await this.users.findOne({ where: { id: userId } });
    if (!person) {
      throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);
    }

    const projectIds = await this.scope.projectScope(actor, query.projectId);
    const { start, end } = istDayRange(date);

    const qb = this.followUps
      .createQueryBuilder('f')
      .innerJoinAndSelect('f.user', 'user')
      .leftJoinAndSelect('f.location', 'location')
      .innerJoinAndSelect('f.lead', 'lead', 'lead.deleted_at IS NULL')
      .innerJoinAndSelect('f.project', 'project')
      .where('f.user_id = :userId', { userId })
      .andWhere('f.deleted_at IS NULL')
      .andWhere('f.created_at >= :start AND f.created_at < :end', { start, end })
      .orderBy('f.createdAt', 'ASC')
      .addOrderBy('f.id', 'ASC');

    if (projectIds !== null) {
      if (projectIds.length === 0) {
        return this.empty(date, person);
      }
      qb.andWhere('f.project_id IN (:...projectIds)', { projectIds });
    }

    const rows = await qb.getMany();
    const presented = await this.entryPresenter.present(rows, {
      viewerId: actor.id,
      isProjectOpen: (projectId) =>
        rows.find((row) => row.projectId === projectId)?.project.status === ProjectStatus.ACTIVE,
    });

    const entries = presented.map((entry, index) => ({
      ...entry,
      lead: {
        id: rows[index].lead.id,
        name: rows[index].lead.name,
        businessName: rows[index].lead.businessName,
      },
      project: {
        id: rows[index].project.id,
        name: rows[index].project.name,
        type: rows[index].project.type,
        status: rows[index].project.status,
      },
    }));

    const followUps = entries.filter((entry) => entry.entryType === EntryType.FOLLOW_UP);
    return {
      date,
      user: { id: person.id, name: person.name },
      entries,
      followUps: followUps.length,
      visits: followUps.filter((entry) => entry.hasPhoto).length,
      statusChanges: entries.length - followUps.length,
      message: entries.length === 0 ? SUCCESS_MESSAGE.NOTHING_LOGGED : null,
    };
  }

  private empty(date: string, person: User): TimelineDto {
    return {
      date,
      user: { id: person.id, name: person.name },
      entries: [],
      followUps: 0,
      visits: 0,
      statusChanges: 0,
      message: SUCCESS_MESSAGE.NOTHING_LOGGED,
    };
  }
}
