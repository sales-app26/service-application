import { Module } from '@nestjs/common';

import { CampaignLessonsService } from './campaign-lessons.service';
import { RoleplayCoachClient } from './roleplay-coach.client';
import { RoleplayService } from './roleplay.service';
import { TrainingLibraryController } from './training-library.controller';
import { TrainingLibraryService } from './training-library.service';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';
import { YoutubePlaylistClient } from './youtube-playlist.client';

/** Training inside every campaign: library, lessons, progress, quizzes and practice pitches. */
@Module({
  controllers: [TrainingLibraryController, TrainingController],
  providers: [
    CampaignLessonsService,
    TrainingLibraryService,
    TrainingService,
    RoleplayService,
    RoleplayCoachClient,
    YoutubePlaylistClient,
  ],
})
export class TrainingModule {}
