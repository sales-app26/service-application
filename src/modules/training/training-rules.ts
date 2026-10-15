import { randomUUID } from 'node:crypto';

import { BUSINESS_RULE, ERROR_CODE, TRAINING_ERROR } from '../../common/constants';
import { TrainingKind, TrainingStep } from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';

/*
 * The shapes of a lesson's `payload`, what an admin may send for each kind, and
 * what a rep is shown. Pure functions: no database, no clock — unit-tested.
 */

export interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  /** Index into `options`. Never sent to a rep before they answer. */
  answer: number;
  explanation: string | null;
}

export interface VideoPayload {
  youtubeId: string;
  startSeconds: number | null;
  endSeconds: number | null;
  /** Up to 5 quick questions after the video; answered right, the video is done. */
  checks: QuizQuestion[];
}

export interface DocumentPayload {
  /** A link instead of (or as well as) an uploaded file. */
  link: string | null;
  note: string | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
}

export interface CardPayload {
  markdown: string;
}

export interface QuizPayload {
  passPercent: number;
  questions: QuizQuestion[];
}

export type RoleplayLanguage = 'en' | 'hinglish';

export interface RoleplayPayload {
  persona: { name: string; shop: string; city: string; about: string };
  /** What the rep reads before starting: the situation and their goal. */
  brief: string;
  /** Hidden from the rep: how the owner behaves, the objections to raise, the facts. */
  ownerInstructions: string;
  /** The owner's first line; the AI writes one when empty. */
  opener: string | null;
  language: RoleplayLanguage;
  /** What the coach scores, one line each. */
  rubric: string[];
  passScore: number;
}

/** One video of a playlist: a module of the App tutorial. */
export interface PlaylistItem {
  youtubeId: string;
  title: string;
}

export interface PlaylistPayload {
  playlistId: string;
  /** Read from YouTube when the lesson is saved; empty when YouTube didn't list them. */
  items: PlaylistItem[];
}

export type LessonPayload =
  VideoPayload | DocumentPayload | CardPayload | QuizPayload | RoleplayPayload | PlaylistPayload;

/** Where a new lesson of each kind shows unless the admin picks another step. */
export const DEFAULT_STEP: Record<TrainingKind, TrainingStep> = {
  [TrainingKind.VIDEO]: TrainingStep.WATCH,
  [TrainingKind.DOCUMENT]: TrainingStep.LIBRARY,
  [TrainingKind.CARD]: TrainingStep.FIELD,
  [TrainingKind.QUIZ]: TrainingStep.PROVE,
  [TrainingKind.ROLEPLAY]: TrainingStep.PRACTISE,
  [TrainingKind.PLAYLIST]: TrainingStep.TUTORIAL,
};

const invalid = (message: string): BusinessException =>
  new BusinessException(message, ERROR_CODE.VALIDATION_FAILED);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
};

const optionalText = (value: unknown, max: number): string | null =>
  value === undefined || value === null || value === '' ? null : text(value, max);

const wholeSeconds = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 24 * 3600 ? n : NaN;
};

// ------------------------------------------------------------------ YouTube

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

/** `90`, `90s`, `1m30s`, `1h2m3s` → seconds; anything else → null. */
const parseTimestamp = (value: string | null): number | null => {
  if (!value) return null;
  if (/^\d+$/u.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(value);
  if (!m || value === '') return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
};

/**
 * The video id (and start time, if the link has one) from any common YouTube
 * link: watch, youtu.be, shorts, embed, live, nocookie. A bare 11-character id
 * is accepted too. Null when it isn't YouTube.
 */
export const parseYoutubeLink = (
  input: string,
): { youtubeId: string; startSeconds: number | null } | null => {
  const raw = input.trim();
  if (YOUTUBE_ID.test(raw)) return { youtubeId: raw, startSeconds: null };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v');
  } else {
    const [, kind, value] = url.pathname.split('/');
    if (['shorts', 'embed', 'live', 'v'].includes(kind ?? '')) id = value ?? null;
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  const start = parseTimestamp(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return { youtubeId: id, startSeconds: start };
};

const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/u;

/**
 * The playlist id from a YouTube playlist link (`/playlist?list=…`, or a watch link that
 * carries `list=`), or a bare id. Null when it isn't one.
 */
export const parsePlaylistLink = (input: string): string | null => {
  const raw = input.trim();
  if (PLAYLIST_ID.test(raw) && !YOUTUBE_ID.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const list = url.searchParams.get('list');
  return list && PLAYLIST_ID.test(list) ? list : null;
};

/** What a playlist's RSS feed lists: its title and its videos, in playlist order. */
export const parsePlaylistFeed = (xml: string): { title: string | null; items: PlaylistItem[] } => {
  const decode = (s: string) =>
    s
      .replace(/&amp;/gu, '&')
      .replace(/&lt;/gu, '<')
      .replace(/&gt;/gu, '>')
      .replace(/&quot;/gu, '"')
      .replace(/&#39;|&apos;/gu, "'")
      .trim();
  const head = xml.split('<entry>')[0];
  const title = /<title>([^<]*)<\/title>/u.exec(head)?.[1];
  const items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gu)]
    .map((m) => ({
      youtubeId: /<yt:videoId>([^<]+)<\/yt:videoId>/u.exec(m[1])?.[1] ?? '',
      title: decode(/<title>([^<]*)<\/title>/u.exec(m[1])?.[1] ?? ''),
    }))
    .filter((i) => YOUTUBE_ID.test(i.youtubeId));
  return { title: title ? decode(title) : null, items };
};

export const youtubeThumbnail = (youtubeId: string): string =>
  `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;

// ------------------------------------------------------------------ questions

const normalizeQuestions = (raw: unknown, max: number): QuizQuestion[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw invalid(TRAINING_ERROR.QUESTIONS_REQUIRED);
  if (raw.length > max) throw invalid(TRAINING_ERROR.TOO_MANY_QUESTIONS(max));
  return raw.map((q, index) => {
    const shapeError = invalid(TRAINING_ERROR.QUESTION_SHAPE(index + 1));
    if (!isRecord(q)) throw shapeError;
    const questionText = text(q.text, BUSINESS_RULE.QUIZ_QUESTION_MAX_LENGTH);
    const options = Array.isArray(q.options)
      ? q.options.map((o) => text(o, BUSINESS_RULE.QUIZ_OPTION_MAX_LENGTH))
      : [];
    const answer = q.answer;
    if (
      !questionText ||
      options.length < BUSINESS_RULE.QUIZ_MIN_OPTIONS ||
      options.length > BUSINESS_RULE.QUIZ_MAX_OPTIONS ||
      options.some((o) => o === null) ||
      typeof answer !== 'number' ||
      !Number.isInteger(answer) ||
      answer < 0 ||
      answer >= options.length
    ) {
      throw shapeError;
    }
    const explanation = optionalText(q.explanation, BUSINESS_RULE.QUIZ_EXPLANATION_MAX_LENGTH);
    if (q.explanation && !explanation) throw shapeError;
    const id =
      typeof q.id === 'string' && /^[\w-]{1,40}$/u.test(q.id) ? q.id : randomUUID().slice(0, 8);
    return { id, text: questionText, options: options as string[], answer, explanation };
  });
};

// ------------------------------------------------------------------ payloads

/**
 * Checks what an admin sent for a lesson of `kind` and returns the payload to
 * store. A document's file fields are set only by the upload, never from here:
 * `current` carries them over when a document is edited.
 */
export const normalizePayload = (
  kind: TrainingKind,
  raw: unknown,
  current?: Record<string, unknown> | null,
): LessonPayload => {
  const input = isRecord(raw) ? raw : {};
  switch (kind) {
    case TrainingKind.VIDEO: {
      const link = typeof input.url === 'string' ? input.url : input.youtubeId;
      const parsed = typeof link === 'string' ? parseYoutubeLink(link) : null;
      if (!parsed) throw invalid(TRAINING_ERROR.YOUTUBE_LINK);
      const start = wholeSeconds(input.startSeconds);
      const end = wholeSeconds(input.endSeconds);
      if (Number.isNaN(start) || Number.isNaN(end)) throw invalid(TRAINING_ERROR.VIDEO_TIMES);
      const startSeconds = start ?? parsed.startSeconds;
      if (end !== null && end <= (startSeconds ?? 0)) throw invalid(TRAINING_ERROR.VIDEO_TIMES);
      return {
        youtubeId: parsed.youtubeId,
        startSeconds,
        endSeconds: end,
        checks: normalizeQuestions(input.checks, BUSINESS_RULE.VIDEO_MAX_CHECKS),
      };
    }
    case TrainingKind.DOCUMENT: {
      const link = optionalText(input.link, BUSINESS_RULE.LESSON_LINK_MAX_LENGTH);
      if (input.link && !link) throw invalid(TRAINING_ERROR.LINK_FORMAT);
      if (link && !/^https:\/\//iu.test(link)) throw invalid(TRAINING_ERROR.LINK_FORMAT);
      const prior = isRecord(current) ? current : {};
      return {
        link,
        note: optionalText(input.note, BUSINESS_RULE.LESSON_SUMMARY_MAX_LENGTH),
        fileName: typeof prior.fileName === 'string' ? prior.fileName : null,
        contentType: typeof prior.contentType === 'string' ? prior.contentType : null,
        sizeBytes: typeof prior.sizeBytes === 'number' ? prior.sizeBytes : null,
      };
    }
    case TrainingKind.CARD: {
      const markdown = text(input.markdown, BUSINESS_RULE.LESSON_MARKDOWN_MAX_LENGTH);
      if (!markdown) throw invalid(TRAINING_ERROR.MARKDOWN_REQUIRED);
      return { markdown };
    }
    case TrainingKind.QUIZ: {
      const questions = normalizeQuestions(input.questions, BUSINESS_RULE.QUIZ_MAX_QUESTIONS);
      if (questions.length === 0) throw invalid(TRAINING_ERROR.QUESTIONS_REQUIRED);
      const passPercent =
        input.passPercent === undefined || input.passPercent === null
          ? BUSINESS_RULE.QUIZ_DEFAULT_PASS_PERCENT
          : input.passPercent;
      if (
        typeof passPercent !== 'number' ||
        !Number.isInteger(passPercent) ||
        passPercent < 1 ||
        passPercent > 100
      ) {
        throw invalid(TRAINING_ERROR.PASS_PERCENT);
      }
      return { passPercent, questions };
    }
    case TrainingKind.PLAYLIST: {
      const link = typeof input.url === 'string' ? input.url : input.playlistId;
      const playlistId = typeof link === 'string' ? parsePlaylistLink(link) : null;
      if (!playlistId) throw invalid(TRAINING_ERROR.PLAYLIST_LINK);
      const items = Array.isArray(input.items)
        ? input.items
            .filter(isRecord)
            .map((i) => ({
              youtubeId: typeof i.youtubeId === 'string' ? i.youtubeId : '',
              title: text(i.title, BUSINESS_RULE.LESSON_TITLE_MAX_LENGTH) ?? 'Untitled module',
            }))
            .filter((i) => YOUTUBE_ID.test(i.youtubeId))
            .slice(0, BUSINESS_RULE.PLAYLIST_MAX_ITEMS)
        : [];
      return { playlistId, items };
    }
    case TrainingKind.ROLEPLAY: {
      const max = BUSINESS_RULE.ROLEPLAY_TEXT_MAX_LENGTH;
      const persona = isRecord(input.persona) ? input.persona : {};
      const name = text(persona.name, 60);
      const shop = text(persona.shop, 120);
      const city = optionalText(persona.city, 60) ?? '';
      const about = optionalText(persona.about, 600) ?? '';
      const brief = text(input.brief, max);
      const ownerInstructions = text(input.ownerInstructions, max);
      if (!name || !shop || !brief || !ownerInstructions)
        throw invalid(TRAINING_ERROR.ROLEPLAY_SHAPE);
      const rubric = Array.isArray(input.rubric)
        ? input.rubric.map((r) => text(r, BUSINESS_RULE.ROLEPLAY_RUBRIC_ITEM_MAX_LENGTH))
        : [];
      if (
        rubric.length === 0 ||
        rubric.length > BUSINESS_RULE.ROLEPLAY_RUBRIC_MAX ||
        rubric.some((r) => r === null)
      ) {
        throw invalid(TRAINING_ERROR.ROLEPLAY_RUBRIC);
      }
      const passScore =
        input.passScore === undefined || input.passScore === null
          ? BUSINESS_RULE.ROLEPLAY_DEFAULT_PASS_SCORE
          : input.passScore;
      if (
        typeof passScore !== 'number' ||
        !Number.isInteger(passScore) ||
        passScore < 1 ||
        passScore > 100
      ) {
        throw invalid(TRAINING_ERROR.PASS_PERCENT);
      }
      return {
        persona: { name, shop, city, about },
        brief,
        ownerInstructions,
        opener: optionalText(input.opener, 600),
        language: input.language === 'hinglish' ? 'hinglish' : 'en',
        rubric: rubric as string[],
        passScore,
      };
    }
  }
};

// ------------------------------------------------------------------ what a rep sees

/** A question as a rep sees it: no answer, no explanation. */
const askable = (q: QuizQuestion) => ({ id: q.id, text: q.text, options: q.options });

/**
 * The part of a payload a rep may see. Quiz and check answers, and the hidden
 * owner instructions of a role-play, never leave the server here.
 */
export const learnerContent = (
  kind: TrainingKind,
  payload: Record<string, unknown>,
  hasFile: boolean,
): Record<string, unknown> => {
  switch (kind) {
    case TrainingKind.VIDEO: {
      const p = payload as unknown as VideoPayload;
      return {
        youtubeId: p.youtubeId,
        thumbnailUrl: youtubeThumbnail(p.youtubeId),
        startSeconds: p.startSeconds ?? null,
        endSeconds: p.endSeconds ?? null,
        checks: (p.checks ?? []).map(askable),
      };
    }
    case TrainingKind.DOCUMENT: {
      const p = payload as unknown as DocumentPayload;
      return {
        link: p.link ?? null,
        note: p.note ?? null,
        fileName: hasFile ? (p.fileName ?? null) : null,
        contentType: hasFile ? (p.contentType ?? null) : null,
        sizeBytes: hasFile ? (p.sizeBytes ?? null) : null,
        hasFile,
      };
    }
    case TrainingKind.CARD:
      return { markdown: (payload as unknown as CardPayload).markdown };
    case TrainingKind.QUIZ: {
      const p = payload as unknown as QuizPayload;
      return { passPercent: p.passPercent, questions: p.questions.map(askable) };
    }
    case TrainingKind.PLAYLIST: {
      const p = payload as unknown as PlaylistPayload;
      return {
        playlistId: p.playlistId,
        items: (p.items ?? []).map((i) => ({ ...i, thumbnailUrl: youtubeThumbnail(i.youtubeId) })),
      };
    }
    case TrainingKind.ROLEPLAY: {
      const p = payload as unknown as RoleplayPayload;
      return {
        persona: p.persona,
        brief: p.brief,
        language: p.language,
        rubric: p.rubric,
        passScore: p.passScore,
      };
    }
  }
};

// ------------------------------------------------------------------ grading

export interface GradedAnswer {
  questionId: string;
  correct: boolean;
  /** The right option's index, shown after submitting. */
  answer: number;
  explanation: string | null;
}

export interface GradeResult {
  score: number;
  passed: boolean;
  results: GradedAnswer[];
}

/**
 * Grades answers given in question order. A quiz passes at its pass mark; the
 * checks after a video pass only when every one is right.
 */
export const gradeAnswers = (
  questions: QuizQuestion[],
  answers: number[],
  passPercent: number,
): GradeResult => {
  if (answers.length !== questions.length) throw invalid(TRAINING_ERROR.ANSWERS_COUNT);
  const results = questions.map((q, i) => ({
    questionId: q.id,
    correct: answers[i] === q.answer,
    answer: q.answer,
    explanation: q.explanation,
  }));
  const right = results.filter((r) => r.correct).length;
  const score = questions.length === 0 ? 100 : Math.round((right / questions.length) * 100);
  return { score, passed: score >= passPercent, results };
};

/**
 * A playlist's progress from its modules: the share watched to the end (90%), and whether
 * every module is. With no modules listed, the lesson is marked done by the rep.
 */
/**
 * A playlist read again from YouTube, in the order the admin arranged: modules still in the
 * playlist keep their place (with YouTube's current title), new videos join at the end in
 * YouTube's order, and videos taken off the playlist drop out.
 */
export const mergePlaylistOrder = (
  arranged: PlaylistItem[],
  listed: PlaylistItem[],
): PlaylistItem[] => {
  const fresh = new Map(listed.map((i) => [i.youtubeId, i]));
  const kept = arranged.flatMap((i) => fresh.get(i.youtubeId) ?? []);
  const known = new Set(kept.map((i) => i.youtubeId));
  return [...kept, ...listed.filter((i) => !known.has(i.youtubeId))];
};

export const playlistProgress = (
  items: PlaylistItem[],
  watched: Record<string, number>,
  donePercent: number,
): { percent: number; complete: boolean } => {
  if (items.length === 0) return { percent: 0, complete: false };
  const done = items.filter((i) => (watched[i.youtubeId] ?? 0) >= donePercent).length;
  return { percent: Math.round((done / items.length) * 100), complete: done === items.length };
};

/** The share of required lessons done, 0–100. */
export const completionPercent = (done: number, required: number): number =>
  required === 0 ? 100 : Math.round((Math.min(done, required) / required) * 100);
