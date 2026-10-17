import { ApiClient } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/**
 * Training inside every campaign (`09_training.sql`): the sales head's library,
 * a campaign attaching courses and adding its own lessons, a rep watching,
 * reading, answering a quiz and practising a pitch with the AI owner (a fake
 * Claude), certification, and the manager's board — each with its scoping.
 */
describe('Training (e2e)', () => {
  let harness: Harness;
  let head: ApiClient;
  let meera: ApiClient; // moderator, member of the campaign
  let omar: ApiClient; // moderator, not a member
  let ravi: ApiClient; // rep, member
  let priya: ApiClient; // rep, member
  let sana: ApiClient; // rep, not a member
  const ids: Record<string, string> = {};
  let projectId: string;
  let courseId: string;
  let draftId: string;
  const lesson: Record<string, string> = {};

  const question = (text: string, answer: number) => ({
    text,
    options: ['Starter', 'Growth', 'Pro'],
    answer,
    explanation: `Because of ${text}`,
  });
  const syllabus = async (client: ApiClient) => {
    const res = await client.get(`/projects/${projectId}/training`);
    expect(res.status).toBe(200);
    return res.body.data;
  };
  const lessonOf = (data: any, id: string) =>
    [...data.courses.flatMap((c: any) => c.lessons), ...data.campaignLessons].find(
      (l: any) => l.id === id,
    );

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    head = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const person = async (name: string, email: string, role: 'moderator' | 'sales_person') => {
      const res = await head.post('/users', { name, email, role });
      expect(res.status).toBe(201);
      ids[name.split(' ')[0].toLowerCase()] = res.body.data.id;
      return api.as(await harness.supabase.accessToken(res.body.data.id));
    };
    meera = await person('Meera Nair', 'meera@pronttera.in', 'moderator');
    omar = await person('Omar Khan', 'omar@pronttera.in', 'moderator');
    ravi = await person('Ravi Kumar', 'ravi@pronttera.in', 'sales_person');
    priya = await person('Priya Desai', 'priya@pronttera.in', 'sales_person');
    sana = await person('Sana Shaikh', 'sana@pronttera.in', 'sales_person');

    const project = await head.post('/projects', {
      name: 'Pune Retail Drive',
      type: 'online',
      startDate: '2026-01-01',
    });
    projectId = project.body.data.id;
    for (const id of [ids.meera, ids.ravi, ids.priya]) {
      expect((await head.post(`/projects/${projectId}/members`, { userId: id })).status).toBe(201);
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  // ---------------------------------------------------------------- the library

  describe('library', () => {
    it('only the sales head builds courses; managers see published ones only', async () => {
      expect((await meera.post('/training/courses', { title: 'Mine' })).status).toBe(403);
      expect((await ravi.get('/training/courses')).status).toBe(403);

      const course = await head.post('/training/courses', {
        title: 'Frostique: core sales training',
        description: 'Everything a rep needs.',
      });
      expect(course.status).toBe(201);
      expect(course.body.data).toMatchObject({
        published: false,
        lessonCount: 0,
        campaignCount: 0,
      });
      courseId = course.body.data.id;
      draftId = (await head.post('/training/courses', { title: 'Still a draft' })).body.data.id;

      expect((await meera.get('/training/courses')).body.data).toEqual([]);
      expect((await meera.get(`/training/courses/${courseId}`)).status).toBe(404);
      const published = await head.patch(`/training/courses/${courseId}`, { published: true });
      expect(published.body.data.published).toBe(true);
      expect((await meera.get('/training/courses')).body.data.map((c: any) => c.id)).toEqual([
        courseId,
      ]);
    });

    it('adds one lesson of each kind, checking each kind’s shape', async () => {
      const add = (body: Record<string, unknown>) =>
        head.post(`/training/courses/${courseId}/items`, body);

      const badVideo = await add({
        kind: 'video',
        title: 'X',
        payload: { url: 'https://vimeo.com/1' },
      });
      expect(badVideo.status).toBe(400);
      expect(badVideo.body.message).toContain('YouTube');

      const video = await add({
        kind: 'video',
        title: 'Frostique in 90 seconds',
        minutes: 2,
        sort: 1,
        payload: {
          url: 'https://youtu.be/dQw4w9WgXcQ?t=10',
          checks: [question('one branch', 1)],
        },
      });
      expect(video.status).toBe(201);
      expect(video.body.data).toMatchObject({
        step: 'watch',
        payload: { youtubeId: 'dQw4w9WgXcQ', startSeconds: 10 },
      });
      lesson.video = video.body.data.id;

      lesson.card = (
        await add({
          kind: 'card',
          title: 'The 25-minute visit',
          sort: 2,
          payload: { markdown: '1. Hook' },
        })
      ).body.data.id;
      lesson.quiz = (
        await add({
          kind: 'quiz',
          title: 'The rep quiz',
          sort: 3,
          payload: {
            passPercent: 50,
            questions: [question('three branches', 2), question('a home baker', 0)],
          },
        })
      ).body.data.id;
      const doc = await add({
        kind: 'document',
        title: 'Sales playbook',
        required: false,
        sort: 4,
        payload: { note: 'For reference' },
      });
      expect(doc.body.data).toMatchObject({ step: 'library', hasFile: false, required: false });
      lesson.document = doc.body.data.id;
      lesson.roleplay = (
        await add({
          kind: 'roleplay',
          title: 'Pitch Ravi: single bakery, Pune',
          sort: 5,
          payload: {
            persona: {
              name: 'Ravi Shinde',
              shop: 'Shinde Cakes',
              city: 'Pune',
              about: 'On Zomato.',
            },
            brief: 'Get Ravi to start a free trial.',
            ownerInstructions: 'HIDDEN: worried about who will deliver.',
            rubric: ['Asked how orders come in today', 'Answered the delivery worry'],
            language: 'hinglish',
          },
        })
      ).body.data.id;

      const detail = await head.get(`/training/courses/${courseId}`);
      expect(detail.body.data.course.lessonCount).toBe(5);
      expect(detail.body.data.lessons.map((l: any) => l.kind)).toEqual([
        'video',
        'card',
        'quiz',
        'document',
        'roleplay',
      ]);
    });

    it('uploads a PDF for a document lesson; only the sales head may for a library lesson', async () => {
      const pdf = Buffer.from('%PDF-1.4\n% playbook\n');
      expect(
        (
          await meera.postForm(
            `/training/items/${lesson.document}/file`,
            {},
            pdf,
            'file',
            'p.pdf',
            'application/pdf',
          )
        ).status,
      ).toBe(403);
      const wrongType = await head.postForm(
        `/training/items/${lesson.document}/file`,
        {},
        Buffer.from('x'),
        'file',
        'notes.txt',
        'text/plain',
      );
      expect(wrongType.status).toBe(400);
      const ok = await head.postForm(
        `/training/items/${lesson.document}/file`,
        {},
        pdf,
        'file',
        'Frostique Sales Playbook!.pdf',
        'application/pdf',
      );
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({
        hasFile: true,
        payload: { fileName: 'Frostique Sales Playbook.pdf', contentType: 'application/pdf' },
      });
    });
  });

  // ---------------------------------------------------------------- one campaign

  describe('campaign', () => {
    it('its managers attach published courses; others can’t', async () => {
      const draft = await meera.put(`/projects/${projectId}/training/courses`, {
        courseIds: [courseId, draftId],
      });
      expect(draft.status).toBe(400);
      expect(draft.body.message).toContain('draft');
      expect(
        (await head.put(`/projects/${projectId}/training/courses`, { courseIds: [draftId] })).body
          .message,
      ).toContain('draft');
      expect(
        (await ravi.put(`/projects/${projectId}/training/courses`, { courseIds: [courseId] }))
          .status,
      ).toBe(403);
      expect(
        (await omar.put(`/projects/${projectId}/training/courses`, { courseIds: [courseId] }))
          .status,
      ).toBe(404);

      const set = await meera.put(`/projects/${projectId}/training/courses`, {
        courseIds: [courseId],
      });
      expect(set.status).toBe(200);
      expect(set.body.data.map((c: any) => c.campaignCount)).toEqual([1]);
    });

    it('its managers add lessons only this campaign has', async () => {
      expect(
        (
          await ravi.post(`/projects/${projectId}/training/items`, {
            kind: 'card',
            title: 'Pune briefing',
            payload: { markdown: 'x' },
          })
        ).status,
      ).toBe(403);
      const local = await meera.post(`/projects/${projectId}/training/items`, {
        kind: 'card',
        title: 'Pune briefing',
        payload: { markdown: 'Delivery partners cover Kothrud and Baner.' },
      });
      expect(local.status).toBe(201);
      expect(local.body.data).toMatchObject({ projectId, courseId: null, step: 'field' });
      lesson.local = local.body.data.id;
      // A manager may change his campaign's lesson, never a library one.
      expect(
        (await meera.patch(`/training/items/${lesson.local}`, { title: 'Pune: what to know' }))
          .status,
      ).toBe(200);
      expect(
        (await meera.patch(`/training/items/${lesson.card}`, { title: 'Mine now' })).status,
      ).toBe(403);
    });

    it('members see the syllabus with no answers and no hidden instructions', async () => {
      const data = await syllabus(ravi);
      expect(data).toMatchObject({
        projectName: 'Pune Retail Drive',
        canManage: false,
        certifiedAt: null,
        requiredCount: 5, // video, card, quiz, roleplay, Pune briefing (the playbook is optional)
        doneCount: 0,
        percent: 0,
        roleplayEnabled: true,
        roleplayLeftToday: 3,
      });
      expect(data.courses).toHaveLength(1);
      expect(data.campaignLessons.map((l: any) => l.id)).toEqual([lesson.local]);
      const text = JSON.stringify(data);
      expect(text).not.toContain('HIDDEN');
      expect(text).not.toContain('Because of');
      expect(text).not.toContain('"answer"');
      expect(lessonOf(data, lesson.video).content).toMatchObject({
        youtubeId: 'dQw4w9WgXcQ',
        thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      });
      expect(lessonOf(data, lesson.document).content).toMatchObject({ hasFile: true });

      expect((await sana.get(`/projects/${projectId}/training`)).status).toBe(404);
      expect((await syllabus(meera)).canManage).toBe(true);
    });
  });

  // ---------------------------------------------------------------- taking it

  describe('learning', () => {
    it('reads a card, opens the playbook, and can’t take a lesson outside the campaign', async () => {
      const read = await ravi.post(`/training/items/${lesson.card}/progress`, {
        projectId,
        done: true,
      });
      expect(read.status).toBe(200);
      expect(read.body.data.progress).toMatchObject({ percent: 100 });
      expect(read.body.data.progress.completedAt).not.toBeNull();

      const file = await ravi.get(`/training/items/${lesson.document}/file?projectId=${projectId}`);
      expect(file.status).toBe(200);
      expect(file.body.data.fileName).toBe('Frostique Sales Playbook.pdf');
      expect(file.body.data.url).toContain('/storage/v1/object/sign/');

      const other = (
        await head.post('/projects', { name: 'Mumbai', type: 'online', startDate: '2026-01-01' })
      ).body.data.id;
      const outside = await head.post(`/training/items/${lesson.card}/progress`, {
        projectId: other,
        done: true,
      });
      expect(outside.status).toBe(404);
    });

    it('a video with checks is done only when they are answered right', async () => {
      const watched = await ravi.post(`/training/items/${lesson.video}/progress`, {
        projectId,
        percent: 95,
        positionSeconds: 80,
      });
      expect(watched.body.data.progress).toMatchObject({
        percent: 95,
        positionSeconds: 80,
        completedAt: null,
      });

      const wrong = await ravi.post(`/training/items/${lesson.video}/attempts`, {
        projectId,
        answers: [0],
      });
      expect(wrong.body.data).toMatchObject({ score: 0, passed: false, attemptsLeftToday: null });
      expect(wrong.body.data.results[0]).toMatchObject({
        correct: false,
        answer: 1,
        explanation: 'Because of one branch',
      });

      const right = await ravi.post(`/training/items/${lesson.video}/attempts`, {
        projectId,
        answers: [1],
      });
      expect(right.body.data).toMatchObject({ score: 100, passed: true });
      expect(right.body.data.progress.completedAt).not.toBeNull();
    });

    it('a quiz allows three tries a day until it is passed', async () => {
      for (let i = 0; i < 3; i += 1) {
        const fail = await priya.post(`/training/items/${lesson.quiz}/attempts`, {
          projectId,
          answers: [0, 1],
        });
        expect(fail.status).toBe(200);
        expect(fail.body.data).toMatchObject({ passed: false, attemptsLeftToday: 2 - i });
      }
      const blocked = await priya.post(`/training/items/${lesson.quiz}/attempts`, {
        projectId,
        answers: [2, 0],
      });
      expect(blocked.status).toBe(429);

      expect(
        (await ravi.post(`/training/items/${lesson.quiz}/attempts`, { projectId, answers: [2] }))
          .status,
      ).toBe(400); // one answer per question
      const pass = await ravi.post(`/training/items/${lesson.quiz}/attempts`, {
        projectId,
        answers: [2, 1],
      });
      expect(pass.body.data).toMatchObject({ score: 50, passed: true, certifiedNow: false });
    });
  });

  // ---------------------------------------------------------------- practice pitches

  describe('practice pitch', () => {
    let pitchId: string;

    it('the owner speaks first, in character, through Claude with fallbacks', async () => {
      harness.anthropic.reset();
      const start = await ravi.post(`/training/items/${lesson.roleplay}/roleplay`, { projectId });
      expect(start.status).toBe(201);
      expect(start.body.data).toMatchObject({
        repTurns: 0,
        maxTurns: 4,
        finished: false,
        persona: { name: 'Ravi Shinde' },
        turns: [{ role: 'owner', text: 'Owner line 1' }],
      });
      pitchId = start.body.data.id;

      const [call] = harness.anthropic.requests;
      expect(call.body.model).toBe('claude-opus-5-5');
      expect(call.body.fallbacks).toBe('default');
      expect(String(call.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
      expect(JSON.stringify(call.body.system)).toContain('HIDDEN: worried about who will deliver.');
      expect(JSON.stringify(call.body.system)).toContain('Hinglish');
      expect(call.body.messages.at(-1)?.role).toBe('user');
    });

    it('talks turn by turn, and only the rep may continue it', async () => {
      expect((await priya.post(`/roleplay/${pitchId}/turns`, { message: 'Hi' })).status).toBe(404);
      expect((await ravi.post(`/roleplay/${pitchId}/turns`, { message: '   ' })).status).toBe(400);

      const turn = await ravi.post(`/roleplay/${pitchId}/turns`, {
        message: 'Namaste! How many orders come from Zomato every month?',
      });
      expect(turn.status).toBe(200);
      expect(turn.body.data.turns.map((t: any) => t.role)).toEqual(['owner', 'rep', 'owner']);
      const sent = harness.anthropic.requests.at(-1)!.body.messages;
      expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    });

    it('a failed answer saves nothing, so the rep can simply resend', async () => {
      harness.anthropic.mode = 'refusal';
      const refused = await ravi.post(`/roleplay/${pitchId}/turns`, {
        message: 'Who delivers? Your boy or a partner.',
      });
      expect(refused.status).toBe(502);
      harness.anthropic.mode = 'ok';
      const again = await ravi.get(`/roleplay/${pitchId}`);
      expect(again.body.data.repTurns).toBe(1);
    });

    it('finishing scores it; a pass completes the lesson', async () => {
      harness.anthropic.score = 82;
      const done = await ravi.post(`/roleplay/${pitchId}/finish`);
      expect(done.status).toBe(200);
      expect(done.body.data).toMatchObject({
        finished: true,
        score: 82,
        passScore: 70,
        passed: true,
        feedback: {
          summary: expect.stringContaining('good questions'),
          criteria: [
            { criterion: 'Asked how orders come in today', met: true },
            { criterion: 'Answered the delivery worry', met: false },
          ],
        },
      });
      const scoring = harness.anthropic.requests.at(-1)!.body;
      expect(scoring.output_config?.format?.type).toBe('json_schema');
      expect((await ravi.post(`/roleplay/${pitchId}/finish`)).status).toBe(409);
      expect((await ravi.post(`/roleplay/${pitchId}/turns`, { message: 'More?' })).status).toBe(
        409,
      );

      // Its campaign's manager can read it; another rep can't.
      expect((await meera.get(`/roleplay/${pitchId}`)).body.data.userName).toBe('Ravi Kumar');
      expect((await priya.get(`/roleplay/${pitchId}`)).status).toBe(404);
      expect(
        (await ravi.get(`/training/items/${lesson.roleplay}/roleplay?projectId=${projectId}`)).body
          .data,
      ).toHaveLength(1);
    });

    it('caps how many pitches a person starts a day', async () => {
      expect(
        (await ravi.post(`/training/items/${lesson.roleplay}/roleplay`, { projectId })).status,
      ).toBe(201);
      expect(
        (await ravi.post(`/training/items/${lesson.roleplay}/roleplay`, { projectId })).status,
      ).toBe(201);
      const capped = await ravi.post(`/training/items/${lesson.roleplay}/roleplay`, { projectId });
      expect(capped.status).toBe(429);
      expect(capped.body.message).toContain('3 practice pitches');
      expect((await syllabus(ravi)).roleplayLeftToday).toBe(0);
    });
  });

  // ---------------------------------------------------------------- certificate and board

  describe('certificate', () => {
    it('the last required lesson certifies the rep and tells the managers', async () => {
      const before = await syllabus(ravi);
      expect(before).toMatchObject({ requiredCount: 5, doneCount: 4, certifiedAt: null });

      const last = await ravi.post(`/training/items/${lesson.local}/progress`, {
        projectId,
        done: true,
      });
      expect(last.body.data.certifiedNow).toBe(true);
      const after = await syllabus(ravi);
      expect(after).toMatchObject({ doneCount: 5, percent: 100 });
      expect(after.certifiedAt).not.toBeNull();

      const inbox = (await meera.get('/notifications?limit=100')).body.data.items as any[];
      expect(inbox.find((n) => n.kind === 'training')).toMatchObject({
        title: 'Ravi Kumar finished training for Pune Retail Drive',
        link: `/projects/${projectId}?tab=training`,
      });
      // Doing it again doesn't certify (or notify) twice.
      const again = await ravi.post(`/training/items/${lesson.local}/progress`, {
        projectId,
        done: true,
      });
      expect(again.body.data.certifiedNow).toBe(false);
    });

    it('the board shows every member against the lessons, for managers only', async () => {
      expect((await ravi.get(`/projects/${projectId}/training/board`)).status).toBe(403);
      expect((await omar.get(`/projects/${projectId}/training/board`)).status).toBe(404);
      const board = (await meera.get(`/projects/${projectId}/training/board`)).body.data;
      expect(board.lessons).toHaveLength(6);
      const byName = Object.fromEntries(board.members.map((m: any) => [m.name, m]));
      expect(byName['Ravi Kumar']).toMatchObject({
        doneCount: 5,
        requiredCount: 5,
        percent: 100,
        quizBest: 50,
        practiceBest: 82,
        practiceCount: 3,
      });
      expect(byName['Ravi Kumar'].certifiedAt).not.toBeNull();
      expect(byName['Priya Desai']).toMatchObject({ doneCount: 0, quizBest: 0, certifiedAt: null });
      expect(board.recentPitches[0]).toMatchObject({ userName: 'Ravi Kumar' });
    });

    it('removing a course detaches it but keeps what people did', async () => {
      expect((await head.delete(`/training/courses/${courseId}`)).status).toBe(200);
      const data = await syllabus(ravi);
      expect(data.courses).toEqual([]);
      expect(data.requiredCount).toBe(1);
      expect(data.certifiedAt).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------- the app tutorial

  describe('app tutorial (a YouTube playlist)', () => {
    const PLAYLIST = 'PLfrostiqueAppTutorial01';
    const modules = Array.from({ length: 3 }, (_, i) => ({
      id: `module${i + 1}xxxx`.slice(0, 11),
      title: `${i + 1} · Module & more`,
    }));
    let tutorial: string;

    beforeAll(() => {
      harness.youtube.playlists.set(PLAYLIST, modules);
    });

    it('takes only the playlist link and lists its modules from YouTube', async () => {
      const bad = await meera.post(`/projects/${projectId}/training/items`, {
        kind: 'playlist',
        title: 'App tutorial',
        payload: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toContain('playlist');

      const res = await meera.post(`/projects/${projectId}/training/items`, {
        kind: 'playlist',
        title: 'Frostique app tutorial',
        required: false,
        payload: { url: `https://www.youtube.com/playlist?list=${PLAYLIST}` },
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        step: 'tutorial',
        payload: {
          playlistId: PLAYLIST,
          items: modules.map((m) => ({ youtubeId: m.id, title: m.title })),
        },
      });
      tutorial = res.body.data.id;
      expect(harness.youtube.requests).toContain(PLAYLIST);
    });

    it('keeps the admin’s module titles until asked to refresh from YouTube', async () => {
      const renamed = await meera.patch(`/training/items/${tutorial}`, {
        payload: {
          playlistId: PLAYLIST,
          items: modules.map((m, i) => ({ youtubeId: m.id, title: `Module ${i + 1}` })),
        },
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.payload.items[0].title).toBe('Module 1');

      harness.youtube.playlists.set(PLAYLIST, [
        ...modules,
        { id: 'module4xxxx', title: '4 · New' },
      ]);
      const refreshed = await meera.patch(`/training/items/${tutorial}`, {
        payload: { playlistId: PLAYLIST, refresh: true },
      });
      expect(refreshed.body.data.payload.items).toHaveLength(4);
      expect(refreshed.body.data.payload.items[0].title).toBe(modules[0].title);
      harness.youtube.playlists.set(PLAYLIST, modules);
      await meera.patch(`/training/items/${tutorial}`, {
        payload: { playlistId: PLAYLIST, refresh: true },
      });
    });

    it('the admin rearranges the modules, and a refresh keeps that order', async () => {
      const reversed = [...modules].reverse().map((m) => ({ youtubeId: m.id, title: m.title }));
      const res = await meera.patch(`/training/items/${tutorial}`, {
        payload: { playlistId: PLAYLIST, items: reversed },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.payload.items.map((i: any) => i.youtubeId)).toEqual(
        reversed.map((m) => m.youtubeId),
      );

      harness.youtube.playlists.set(PLAYLIST, [
        ...modules,
        { id: 'module4xxxx', title: '4 · New' },
      ]);
      const refreshed = await meera.patch(`/training/items/${tutorial}`, {
        payload: { playlistId: PLAYLIST, refresh: true },
      });
      expect(refreshed.body.data.payload.items.map((i: any) => i.youtubeId)).toEqual([
        ...reversed.map((m) => m.youtubeId),
        'module4xxxx',
      ]);
      // put it back the way the rest of these tests expect
      harness.youtube.playlists.set(PLAYLIST, modules);
      await meera.patch(`/training/items/${tutorial}`, {
        payload: {
          playlistId: PLAYLIST,
          items: modules.map((m) => ({ youtubeId: m.id, title: m.title })),
        },
      });
    });

    it('reps see the modules with thumbnails', async () => {
      const mine = lessonOf(await syllabus(priya), tutorial);
      expect(mine).toMatchObject({ kind: 'playlist', step: 'tutorial' });
      expect(mine.content.items[0]).toMatchObject({
        youtubeId: modules[0].id,
        thumbnailUrl: `https://i.ytimg.com/vi/${modules[0].id}/hqdefault.jpg`,
      });
      expect(mine.progress.watched).toEqual({});
    });

    it('tracks each module, and is done when every module is watched', async () => {
      const post = (body: Record<string, unknown>) =>
        priya.post(`/training/items/${tutorial}/progress`, { projectId, ...body });

      expect((await post({ percent: 50 })).status).toBe(400);
      expect((await post({ moduleId: 'notinthelst', percent: 50 })).status).toBe(400);

      const first = await post({ moduleId: modules[0].id, percent: 95 });
      expect(first.status).toBe(200);
      expect(first.body.data.progress).toMatchObject({
        percent: 33,
        completedAt: null,
        watched: { [modules[0].id]: 95 },
      });
      // A rewind never lowers what was watched.
      const rewound = await post({ moduleId: modules[0].id, percent: 10 });
      expect(rewound.body.data.progress.watched[modules[0].id]).toBe(95);

      await post({ moduleId: modules[1].id, done: true });
      const last = await post({ moduleId: modules[2].id, percent: 92 });
      expect(last.body.data.progress).toMatchObject({ percent: 100 });
      expect(last.body.data.progress.completedAt).not.toBeNull();
    });

    it('a playlist YouTube won’t list plays whole, and a tap marks it watched', async () => {
      const res = await meera.post(`/projects/${projectId}/training/items`, {
        kind: 'playlist',
        title: 'Private playlist',
        required: false,
        payload: { url: 'https://www.youtube.com/playlist?list=PLprivateNotListed' },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.payload).toEqual({ playlistId: 'PLprivateNotListed', items: [] });
      const done = await priya.post(`/training/items/${res.body.data.id}/progress`, {
        projectId,
        done: true,
      });
      expect(done.body.data.progress).toMatchObject({ percent: 100 });
    });

    describe('a playlist longer than the feed’s 15 videos', () => {
      const LONG = 'PLfrostiquePortalAcademy';
      const episodes = Array.from({ length: 31 }, (_, i) => ({
        id: `episode${String(i).padStart(2, '0')}xx`,
        title: `${String(i).padStart(2, '0')} · Episode ${i}`,
      }));
      const save = (title: string) =>
        meera.post(`/projects/${projectId}/training/items`, {
          kind: 'playlist',
          title,
          required: false,
          payload: { url: `https://www.youtube.com/playlist?list=${LONG}` },
        });

      beforeAll(() => {
        harness.youtube.playlists.set(LONG, episodes);
      });
      afterEach(() => {
        harness.youtube.pageSize = 50;
        harness.youtube.apiDown = false;
      });

      it('lists all 31 videos through the Data API, page by page', async () => {
        harness.youtube.pageSize = 10; // four pages
        const res = await save('Portal academy');
        expect(res.status).toBe(201);
        expect(res.body.data.payload.items).toEqual(
          episodes.map((e) => ({ youtubeId: e.id, title: e.title })),
        );
      });

      it('falls back to the feed’s first 15 when the API refuses (quota spent)', async () => {
        harness.youtube.apiDown = true;
        const res = await save('Portal academy, feed only');
        expect(res.status).toBe(201);
        expect(res.body.data.payload.items).toEqual(
          episodes.slice(0, 15).map((e) => ({ youtubeId: e.id, title: e.title })),
        );
      });
    });
  });
});
