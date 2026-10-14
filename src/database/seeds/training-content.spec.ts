import { DEFAULT_STEP, normalizePayload } from '../../modules/training/training-rules';
import { FROSTIQUE_LESSONS } from './training-content';

/** The seeded course must pass the same checks the API applies to a lesson an admin adds. */
describe('Frostique starting course', () => {
  it.each(FROSTIQUE_LESSONS.map((l) => [l.title, l] as const))(
    '%s is a valid lesson',
    (_, lesson) => {
      expect(() => normalizePayload(lesson.kind, lesson.payload)).not.toThrow();
      expect(lesson.title.length).toBeLessThanOrEqual(120);
      expect(lesson.step ?? DEFAULT_STEP[lesson.kind]).toBeDefined();
    },
  );

  it('keeps the fee and the coming-soon list right', () => {
    const text = JSON.stringify(FROSTIQUE_LESSONS);
    expect(text).not.toMatch(/2\.36/);
    const sheet = FROSTIQUE_LESSONS.find((l) => l.title.startsWith('Live / Coming soon'));
    const markdown = String(sheet?.payload.markdown);
    const soon = markdown.slice(
      markdown.indexOf('## Coming soon'),
      markdown.indexOf('## Never say'),
    );
    expect(soon).toContain('WhatsApp and email alerts');
    expect(markdown.slice(0, markdown.indexOf('## Rolling out'))).not.toContain('WhatsApp');
  });
});
