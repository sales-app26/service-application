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
import {
  ProjectCourse,
  RoleplaySession,
  TrainingCertification,
  TrainingCourse,
  TrainingItem,
  TrainingProgress,
} from './training.entity';
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
  ProjectCourse,
  ProjectMember,
  RoleplaySession,
  TrainingCertification,
  TrainingCourse,
  TrainingItem,
  TrainingProgress,
  User,
  UserLeave,
  UserNotification,
};
export type { RoleplayFeedback, RoleplayTurn } from './training.entity';

/**
 * The seven version-1 tables (DB Design §1), in dependency order, then the
 * release-note tables added in `02_app_versions.sql` and the collaboration
 * tables added in `06_team_collaboration.sql`, then plan prices and offers
 * (`08_deal_terms.sql`), then training (`09_training.sql`).
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
  TrainingCourse,
  TrainingItem,
  ProjectCourse,
  TrainingProgress,
  RoleplaySession,
  TrainingCertification,
];
