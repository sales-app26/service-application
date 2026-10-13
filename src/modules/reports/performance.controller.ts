import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
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
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  Roles,
} from '../../common/decorators';
import { UuidParamDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import { RepReviewDto, ScorecardDto, ScorecardQueryDto } from './dto/scorecard.dto';
import { ScorecardService } from './scorecard.service';

const DEFINITIONS = [
  'Conversion % = deals won ÷ (deals won + leads the rep marked Not interested or Lost in the period that are not Won now).',
  'Active days = days in the period, up to today and not on leave, with at least one follow-up, visit or stage change. Working days = days up to today minus days on leave.',
  'Target = each campaign’s weekly or monthly target scaled to the dates; achieved = deals won in those campaigns.',
].join('\n\n');

/**
 * The team scorecard and one rep's review, for the sales head (every
 * campaign) and sales managers (their campaigns). Sales reps are refused.
 */
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class PerformanceController {
  constructor(private readonly scorecards: ScorecardService) {}

  @Get(`${ROUTE.REPORTS}/scorecard`)
  @ApiTags(SWAGGER_TAG.DASHBOARD)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'Team scorecard',
    description: `One row per sales rep in the caller’s campaigns (or one campaign), for India dates \`from\`–\`to\` (at most ${BUSINESS_RULE.DASHBOARD_MAX_DAYS} days), with team totals and the average rep. Pipeline numbers (overdue, open) are right now.\n\n${DEFINITIONS}`,
  })
  @ApiOkEnvelope(ScorecardDto)
  scorecard(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ScorecardQueryDto,
  ): Promise<ScorecardDto> {
    return this.scorecards.scorecard(actor, query);
  }

  @Get(`${ROUTE.REPORTS}/people/${ROUTE.ID_PARAM}/review`)
  @ApiTags(SWAGGER_TAG.DASHBOARD)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'One rep’s review',
    description: `The scorecard numbers for one person next to the team average, a trend (daily up to 31 days, then weekly), stage funnel, lost reasons, lead sources, plan mix, the 10 latest deals won, activity by weekday and the managers’ feedback. The person must be someone the caller can see; a sales manager’s numbers cover only his campaigns.\n\n${DEFINITIONS}`,
  })
  @ApiOkEnvelope(RepReviewDto)
  review(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Query() query: ScorecardQueryDto,
  ): Promise<RepReviewDto> {
    return this.scorecards.review(actor, params.id, query);
  }

  @Get(`${ROUTE.EXPORTS}/scorecard`)
  @ApiTags(SWAGGER_TAG.EXPORTS)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiProduces(MIME_TYPE.CSV)
  @ApiOperation({
    summary: 'Export the scorecard (CSV)',
    description: `The team scorecard for the dates, one line per sales rep, then the team total and the team average. At most ${BUSINESS_RULE.EXPORT_MAX_DAYS} days per file.`,
  })
  async exportScorecard(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ScorecardQueryDto,
  ): Promise<StreamableFile> {
    const file = await this.scorecards.scorecardCsv(actor, query);
    return new StreamableFile(file.content, {
      type: MIME_TYPE.CSV,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.content.length,
    });
  }
}
