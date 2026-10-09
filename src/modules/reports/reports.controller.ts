import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import {
  BUSINESS_RULE,
  MIME_TYPE,
  ROUTE,
  SWAGGER_SECURITY,
  SWAGGER_TAG,
} from '../../common/constants';
import {
  ApiOkEnvelope,
  ApiPaginatedEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  Roles,
} from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import { LeadSummaryDto } from '../leads/dto/lead.dto';
import { DashboardService } from './dashboard.service';
import {
  DashboardDto,
  DueTodayQueryDto,
  ExportFilterDto,
  HomeDto,
  ProjectFilterQueryDto,
  ReportFilterDto,
  SummaryDto,
  SummaryQueryDto,
  TimelineDto,
  TimelineQueryDto,
} from './dto/report.dto';
import { CsvFile, ExportsService } from './exports.service';
import { MeService } from './me.service';
import { SummaryService } from './summary.service';
import { TimelineService } from './timeline.service';

const toDownload = (file: CsvFile): StreamableFile =>
  new StreamableFile(file.content, {
    type: MIME_TYPE.CSV,
    disposition: `attachment; filename="${file.fileName}"`,
    length: file.content.length,
  });

@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class ReportsController {
  constructor(
    private readonly meService: MeService,
    private readonly timelineService: TimelineService,
    private readonly summaryService: SummaryService,
    private readonly dashboardService: DashboardService,
    private readonly exportsService: ExportsService,
  ) {}

  // ----------------------------------------------------------------- my work

  @Get(`${ROUTE.ME}/home`)
  @ApiTags(SWAGGER_TAG.ME)
  @Roles(UserRole.SALES_PERSON, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'Home screen numbers',
    description:
      'Own target progress per project (or one project), how many leads are due or overdue, follow-ups logged today and leads owned.',
  })
  @ApiOkEnvelope(HomeDto)
  home(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ProjectFilterQueryDto,
  ): Promise<HomeDto> {
    return this.meService.home(actor, query.projectId);
  }

  @Get(`${ROUTE.ME}/due-today`)
  @ApiTags(SWAGGER_TAG.ME)
  @Roles(UserRole.SALES_PERSON, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'Due today',
    description:
      'Own leads whose next follow-up date is today or earlier and that are not Converted, Lost or Not interested, in active projects. Oldest first; overdue ones carry `overdueDays`. A lead leaves the list once a new entry moves its date on.',
  })
  @ApiPaginatedEnvelope(LeadSummaryDto)
  dueToday(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: DueTodayQueryDto,
  ): Promise<PaginatedResponseDto<LeadSummaryDto>> {
    return this.meService.dueToday(actor, query);
  }

  // ---------------------------------------------------------------- timeline

  @Get(ROUTE.TIMELINE)
  @ApiTags(SWAGGER_TAG.TIMELINE)
  @ApiOperation({
    summary: 'One person’s day',
    description:
      'Every entry for one India date in time order, with lead, project, note, typed location, and for visits the photo, map pin and GPS accuracy. Sales persons see their own day ("My day"); admins pick the person. A moderator sees only entries in his projects.',
  })
  @ApiOkEnvelope(TimelineDto)
  timeline(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: TimelineQueryDto,
  ): Promise<TimelineDto> {
    return this.timelineService.day(actor, query);
  }

  @Get(`${ROUTE.TIMELINE}/summary`)
  @ApiTags(SWAGGER_TAG.TIMELINE)
  @ApiOperation({
    summary: 'One person’s week or month',
    description:
      'Totals and a day-by-day breakdown (follow-ups, visits, status changes, leads added, conversions) for any range of up to 92 India days. The portal asks for a Monday–Sunday week or a calendar month. Sales persons see their own; admins pick the person; a moderator’s numbers cover only his projects.',
  })
  @ApiOkEnvelope(SummaryDto)
  summary(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: SummaryQueryDto,
  ): Promise<SummaryDto> {
    return this.summaryService.build(actor, query);
  }

  // --------------------------------------------------------------- dashboard

  @Get(ROUTE.DASHBOARD)
  @ApiTags(SWAGGER_TAG.DASHBOARD)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'Admin dashboard',
    description:
      'Target vs achieved per person (current week/month), new leads and follow-ups in the date range, follow-ups today, who logged nothing today, leads by status, this week’s conversions to spot-check, and pending transfers. Filters: date range, project, person. A moderator’s numbers cover only his projects.',
  })
  @ApiOkEnvelope(DashboardDto)
  dashboard(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() filter: ReportFilterDto,
  ): Promise<DashboardDto> {
    return this.dashboardService.build(actor, filter);
  }

  // ----------------------------------------------------------------- exports

  @Get(`${ROUTE.EXPORTS}/leads`)
  @ApiTags(SWAGGER_TAG.EXPORTS)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiProduces(MIME_TYPE.CSV)
  @ApiOperation({
    summary: 'Export leads (CSV)',
    description: `Leads added in the date range, with their current state. At most ${BUSINESS_RULE.EXPORT_MAX_DAYS} days per file.`,
  })
  async exportLeads(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() filter: ExportFilterDto,
  ): Promise<StreamableFile> {
    return toDownload(await this.exportsService.leads(actor, filter));
  }

  @Get(`${ROUTE.EXPORTS}/follow-ups`)
  @ApiTags(SWAGGER_TAG.EXPORTS)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiProduces(MIME_TYPE.CSV)
  @ApiOperation({
    summary: 'Export follow-ups (CSV)',
    description: `Every entry in the date range with latitude, longitude, accuracy and a photo link that opens only after login. At most ${BUSINESS_RULE.EXPORT_MAX_DAYS} days per file.`,
  })
  async exportEntries(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() filter: ExportFilterDto,
  ): Promise<StreamableFile> {
    return toDownload(await this.exportsService.entries(actor, filter));
  }
}
