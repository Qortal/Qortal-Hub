import { describe, expect, it } from 'vitest';
import { plainTextToTorqDoc, torqDocToPostBody } from './torqRichText';

const text = (value: string, marks: string[] = []) => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const paragraph = (...content: any[]) => ({ type: 'paragraph', content });

describe('torqDocToPostBody', () => {
  it('turns each paragraph into a Torq paragraph gap, with no richText', () => {
    const body = torqDocToPostBody({
      type: 'doc',
      content: [
        paragraph(text('First line')),
        paragraph(text('Second'), { type: 'hardBreak' }, text('same para')),
        { type: 'paragraph' },
        paragraph(text('Third')),
      ],
    });
    expect(body).toEqual({
      text: 'First line\n\nSecond\nsame para\n\nThird',
    });
  });

  it('emits Torq-sanitizer HTML only when formatting is used', () => {
    const body = torqDocToPostBody({
      type: 'doc',
      content: [
        paragraph(
          text('Hi '),
          text('bold', ['bold']),
          text(' <tag> & ', ['italic', 'underline'])
        ),
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph(text('one'))] },
            { type: 'listItem', content: [paragraph(text('two'))] },
          ],
        },
        {
          type: 'orderedList',
          content: [{ type: 'listItem', content: [paragraph(text('first'))] }],
        },
      ],
    });
    expect(body.text).toBe('Hi bold <tag> &\n\n• one\n• two\n\n1. first');
    expect(body.richText).toBe(
      '<p>Hi <b>bold</b><i><u> &lt;tag&gt; &amp; </u></i></p>' +
        '<ul data-list="disc"><li>one</li><li>two</li></ul>' +
        '<ol><li>first</li></ol>'
    );
  });

  it('returns empty text for an empty editor', () => {
    expect(
      torqDocToPostBody({ type: 'doc', content: [{ type: 'paragraph' }] })
    ).toEqual({
      text: '',
    });
  });
});

describe('plainTextToTorqDoc', () => {
  it('round-trips Quitter text: blank lines split paragraphs', () => {
    const source = 'Hello\nworld\n\nSecond paragraph';
    expect(torqDocToPostBody(plainTextToTorqDoc(source)).text).toBe(source);
  });
});
