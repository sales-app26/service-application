import { TrainingKind } from '../../common/enums';
import {
  completionPercent,
  gradeAnswers,
  learnerContent,
  normalizePayload,
  parseYoutubeLink,
  QuizPayload,
  RoleplayPayload,
  VideoPayload,
} from './training-rules';

describe('parseYoutubeLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://youtu.be/dQw4w9WgXcQ?t=95', 'dQw4w9WgXcQ', 95],
    ['youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s', 'dQw4w9WgXcQ', 90],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ?start=12', 'dQw4w9WgXcQ', 12],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
  ])('reads %s', (link, id, start) => {
    expect(parseYoutubeLink(link)).toEqual({ youtubeId: id, startSeconds: start });
  });

  it.each([
    'https://vimeo.com/12345',
    'https://www.youtube.com/watch?v=short',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/channel/UC123',
    'not a link',
  ])('refuses %s', (link) => {
    expect(parseYoutubeLink(link)).toBeNull();
  });
});

describe('normalizePayload', () => {
  const question = { text: 'Which plan for 3 branches?', options: ['Growth', 'Pro'], answer: 1 };

  it('video: parses the link, keeps checks, and refuses an end before the start', () => {
    const video = normalizePayload(TrainingKind.VIDEO, {
      url: 'https://youtu.be/dQw4w9WgXcQ?t=30',
      endSeconds: 120,
      checks: [question],
    }) as VideoPayload;
    expect(video).toMatchObject({ youtubeId: 'dQw4w9WgXcQ', startSeconds: 30, endSeconds: 120 });
    expect(video.checks[0]).toMatchObject({ text: question.text, answer: 1, explanation: null });
    expect(video.checks[0].id).toMatch(/^[\w-]+$/u);

    expect(() =>
      normalizePayload(TrainingKind.VIDEO, {
        url: 'https://youtu.be/dQw4w9WgXcQ',
        startSeconds: 60,
        endSeconds: 30,
      }),
    ).toThrow('end time');
    expect(() => normalizePayload(TrainingKind.VIDEO, { url: 'https://vimeo.com/1' })).toThrow(
      'YouTube',
    );
  });

  it('document: link must be https, and file details survive an edit', () => {
    expect(() => normalizePayload(TrainingKind.DOCUMENT, { link: 'http://x.in/a.pdf' })).toThrow(
      'https',
    );
    const kept = normalizePayload(
      TrainingKind.DOCUMENT,
      { note: 'Read before your first visit', fileName: 'hacked.exe' },
      { fileName: 'playbook.pdf', contentType: 'application/pdf', sizeBytes: 1200 },
    );
    expect(kept).toEqual({
      link: null,
      note: 'Read before your first visit',
      fileName: 'playbook.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1200,
    });
  });

  it('card: needs text', () => {
    expect(() => normalizePayload(TrainingKind.CARD, { markdown: '  ' })).toThrow('text');
    expect(normalizePayload(TrainingKind.CARD, { markdown: '## Visit' })).toEqual({
      markdown: '## Visit',
    });
  });

  it('quiz: defaults the pass mark and checks every question', () => {
    const quiz = normalizePayload(TrainingKind.QUIZ, { questions: [question] }) as QuizPayload;
    expect(quiz.passPercent).toBe(80);
    expect(() => normalizePayload(TrainingKind.QUIZ, { questions: [] })).toThrow('at least one');
    expect(() =>
      normalizePayload(TrainingKind.QUIZ, { questions: [{ ...question, answer: 2 }] }),
    ).toThrow('Question 1');
    expect(() =>
      normalizePayload(TrainingKind.QUIZ, { questions: [{ ...question, options: ['Only one'] }] }),
    ).toThrow('Question 1');
    expect(() =>
      normalizePayload(TrainingKind.QUIZ, { questions: [question], passPercent: 0 }),
    ).toThrow('pass mark');
  });

  it('roleplay: needs a persona, brief, instructions and a rubric', () => {
    const scenario = {
      persona: { name: 'Ravi', shop: 'Ravi Cakes', city: 'Pune' },
      brief: 'Pitch Frostique to a single-shop bakery on Zomato.',
      ownerInstructions: 'Worried about delivery and commission.',
      rubric: ['Asked how orders come in today'],
      language: 'hinglish',
    };
    const parsed = normalizePayload(TrainingKind.ROLEPLAY, scenario) as RoleplayPayload;
    expect(parsed).toMatchObject({ language: 'hinglish', passScore: 70, opener: null });
    expect(parsed.persona).toEqual({ name: 'Ravi', shop: 'Ravi Cakes', city: 'Pune', about: '' });
    expect(() => normalizePayload(TrainingKind.ROLEPLAY, { ...scenario, rubric: [] })).toThrow(
      'scores',
    );
    expect(() =>
      normalizePayload(TrainingKind.ROLEPLAY, { ...scenario, ownerInstructions: '' }),
    ).toThrow('owner');
  });
});

describe('learnerContent', () => {
  it('never shows answers or hidden role-play instructions', () => {
    const quiz = normalizePayload(TrainingKind.QUIZ, {
      questions: [{ text: 'Q?', options: ['A', 'B'], answer: 1, explanation: 'Because B.' }],
    });
    const shown = learnerContent(TrainingKind.QUIZ, quiz as never, false);
    expect(JSON.stringify(shown)).not.toContain('"answer"');
    expect(JSON.stringify(shown)).not.toContain('Because B.');

    const roleplay = normalizePayload(TrainingKind.ROLEPLAY, {
      persona: { name: 'Ravi', shop: 'Ravi Cakes' },
      brief: 'Pitch it.',
      ownerInstructions: 'SECRET: worried about delivery',
      rubric: ['Did discovery'],
    });
    expect(
      JSON.stringify(learnerContent(TrainingKind.ROLEPLAY, roleplay as never, false)),
    ).not.toContain('SECRET');
  });

  it('hides a document’s file details until it has a file', () => {
    const doc = {
      link: null,
      note: null,
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 9,
    };
    expect(learnerContent(TrainingKind.DOCUMENT, doc, false)).toMatchObject({
      hasFile: false,
      fileName: null,
    });
    expect(learnerContent(TrainingKind.DOCUMENT, doc, true)).toMatchObject({
      hasFile: true,
      fileName: 'a.pdf',
    });
  });
});

describe('gradeAnswers', () => {
  const questions = [
    { id: 'a', text: '1', options: ['x', 'y'], answer: 0, explanation: 'x is right' },
    { id: 'b', text: '2', options: ['x', 'y'], answer: 1, explanation: null },
    { id: 'c', text: '3', options: ['x', 'y'], answer: 1, explanation: null },
    { id: 'd', text: '4', options: ['x', 'y'], answer: 0, explanation: null },
    { id: 'e', text: '5', options: ['x', 'y'], answer: 0, explanation: null },
  ];

  it('scores and passes at the mark', () => {
    const result = gradeAnswers(questions, [0, 1, 1, 0, 1], 80);
    expect(result).toMatchObject({ score: 80, passed: true });
    expect(result.results[4]).toEqual({
      questionId: 'e',
      correct: false,
      answer: 0,
      explanation: null,
    });
    expect(gradeAnswers(questions, [1, 1, 1, 0, 1], 80)).toMatchObject({
      score: 60,
      passed: false,
    });
  });

  it('needs one answer per question', () => {
    expect(() => gradeAnswers(questions, [0, 1], 80)).toThrow('Answer every question');
  });

  it('completion percent caps at 100 and treats no required lessons as done', () => {
    expect(completionPercent(3, 4)).toBe(75);
    expect(completionPercent(5, 4)).toBe(100);
    expect(completionPercent(0, 0)).toBe(100);
  });
});
