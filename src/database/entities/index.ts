import { AppVersion, AppVersionView } from './app-version.entity';
import { FollowUp } from './follow-up.entity';
import { LeadComment } from './lead-comment.entity';
import { LeadTransfer } from './lead-transfer.entity';
import { Lead } from './lead.entity';
import { Location } from './location.entity';
import { MessageTemplate } from './message-template.entity';
import { Offer } from './offer.entity';
import { PlanPrice } from './plan-price.entity';
import { UserNotification } from './notification.entity';
import { ProjectMember } from './project-member.entity';
import { Project } from './project.entity';
import { UserLeave } from './user-leave.entity';
import { User } from './user.entity';

export {
  AppVersion,
  AppVersionView,
  FollowUp,
  Lead,
  LeadComment,
  LeadTransfer,
  Location,
  MessageTemplate,
  Offer,
  PlanPrice,
  Project,
  ProjectMember,
  User,
  UserLeave,
  UserNotification,
};

/**
 * The seven version-1 tables (DB Design §1), in dependency order, then the
 * release-note tables added in `02_app_versions.sql` and the collaboration
 * tables added in `06_team_collaboration.sql`, then plan prices and offers
 * (`08_deal_terms.sql`).
 */
export const ALL_ENTITIES = [
  User,
  Project,
  ProjectMember,
  Location,
  Lead,
  FollowUp,
  LeadTransfer,
  AppVersion,
  AppVersionView,
  UserLeave,
  LeadComment,
  UserNotification,
  MessageTemplate,
  PlanPrice,
  Offer,
];
