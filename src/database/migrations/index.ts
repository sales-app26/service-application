import { InitSalesSchema1791446400000 } from './1791446400000-InitSalesSchema';
import { AppVersions1791532800000 } from './1791532800000-AppVersions';
import { UserDeletion1791619200000 } from './1791619200000-UserDeletion';
import { SingleUseCapture1791705600000 } from './1791705600000-SingleUseCapture';
import { SalesInsights1791792000000 } from './1791792000000-SalesInsights';
import { TeamCollaboration1791878400000 } from './1791878400000-TeamCollaboration';
import { VisitPlace1791964800000 } from './1791964800000-VisitPlace';
import { DealTerms1792051200000 } from './1792051200000-DealTerms';
import { Training1792137600000 } from './1792137600000-Training';
import { TrainingPlaylists1792224000000 } from './1792224000000-TrainingPlaylists';

/** Every migration, in the order they apply. */
export const MIGRATIONS = [
  InitSalesSchema1791446400000,
  AppVersions1791532800000,
  UserDeletion1791619200000,
  SingleUseCapture1791705600000,
  SalesInsights1791792000000,
  TeamCollaboration1791878400000,
  VisitPlace1791964800000,
  DealTerms1792051200000,
  Training1792137600000,
  TrainingPlaylists1792224000000,
];
