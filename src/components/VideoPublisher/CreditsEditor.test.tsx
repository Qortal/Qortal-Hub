import { ThemeProvider } from '@mui/material/styles';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves strings.
import i18n from '../../i18n/i18n';
import type { SubscreenCredit } from '../../lib/videoPublisher';
import { darkTheme } from '../../styles/theme-dark';
import { lightTheme } from '../../styles/theme-light';
import { CreditsEditor } from './CreditsEditor';
import { ItemFieldsForm } from './ItemFieldsForm';
import { SeriesForm } from './SharedForms';
import type { VideoPublisherController } from './videoPublisherController';
import type { SeriesFields } from './videoPublisherTypes';

/**
 * The English strings, until they're in the locale files (never over the
 * ones there): the queries below go through i18n either way.
 */
beforeAll(() => {
  i18n.addResourceBundle(
    'en',
    'core',
    {
      video_publisher: {
        credits: {
          heading: 'Cast & crew',
          hint: 'Shown on the title’s page in Subscreen.',
          role: {
            director: 'Directors',
            actor: 'Cast',
            writer: 'Writers',
            producer: 'Producers',
            composer: 'Music',
            cinematographer: 'Cinematography',
            editor: 'Editing',
          },
          name_placeholder: 'Type a name, then Enter',
          character: 'Character',
          character_placeholder: 'Optional',
          as_character: '{{name}} as {{character}}',
          add: 'Add to {{role}}',
          remove: 'Remove {{name}} from {{role}}',
          duplicate: '{{name}} is already in {{role}}',
          limit: '{{max}} names at most: remove one to add another',
        },
      },
    },
    true,
    false
  );
});

afterEach(cleanup);

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`core:video_publisher.credits.${key}`, options);
const role = (name: string) => t(`role.${name}`);

/** The editor with its own state, as a form keeps it. */
const Editor = ({
  initial = [],
  disabled = false,
  onChange = () => undefined,
}: {
  initial?: SubscreenCredit[];
  disabled?: boolean;
  onChange?: (credits: SubscreenCredit[]) => void;
}) => {
  const [credits, setCredits] = useState(initial);
  return (
    <CreditsEditor
      credits={credits}
      disabled={disabled}
      onChange={(next) => {
        setCredits(next);
        onChange(next);
      }}
    />
  );
};

const renderEditor = (
  props: Parameters<typeof Editor>[0] = {},
  theme = lightTheme
) =>
  render(
    <ThemeProvider theme={theme}>
      <Editor {...props} />
    </ThemeProvider>
  );

const field = (name: string) => screen.getByRole('textbox', { name });
const type = (name: string, text: string) =>
  fireEvent.change(field(name), { target: { value: text } });
const enter = (name: string) =>
  fireEvent.keyDown(field(name), { key: 'Enter', code: 'Enter' });
const names = (roleName: string) =>
  within(screen.getByRole('list', { name: roleName }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('CreditsEditor', () => {
  it('shows a field for every role, in Subscreen’s order', () => {
    renderEditor();
    expect(
      screen.getByRole('group', { name: t('heading') })
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('textbox')
        .map((box) => box.getAttribute('id'))
        .map((id) => document.querySelector(`label[for="${id}"]`)?.textContent)
    ).toEqual([
      role('director'),
      role('actor'),
      t('character'),
      role('writer'),
      role('producer'),
      role('composer'),
      role('cinematographer'),
      role('editor'),
    ]);
    for (const box of screen.getAllByRole('textbox')) {
      expect(box).toHaveAttribute('maxlength', '80');
    }
  });

  it('adds a name with Enter or the + button, cleaned, and takes it out again', () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    const add = screen.getByRole('button', {
      name: t('add', { role: role('director') }),
    });
    expect(add).toBeDisabled();

    type(role('director'), '  Sam    Brandt ');
    enter(role('director'));
    expect(onChange).toHaveBeenLastCalledWith([
      { role: 'director', displayName: 'Sam Brandt' },
    ]);
    expect(field(role('director'))).toHaveValue('');
    expect(names(role('director'))).toEqual(['Sam Brandt']);

    type(role('writer'), 'Ivan Brandt');
    fireEvent.click(
      screen.getByRole('button', { name: t('add', { role: role('writer') }) })
    );
    expect(names(role('writer'))).toEqual(['Ivan Brandt']);

    fireEvent.click(
      screen.getByRole('button', {
        name: t('remove', { name: 'Sam Brandt', role: role('director') }),
      })
    );
    expect(onChange).toHaveBeenLastCalledWith([
      { role: 'writer', displayName: 'Ivan Brandt' },
    ]);
    expect(screen.queryByRole('list', { name: role('director') })).toBeNull();
  });

  it('adds an actor with the character they play', () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    type(role('actor'), 'Owen Marsh');
    type(t('character'), ' Ash ');
    enter(t('character'));
    expect(onChange).toHaveBeenLastCalledWith([
      { role: 'actor', displayName: 'Owen Marsh', character: 'Ash' },
    ]);
    expect(names(role('actor'))).toEqual([
      t('as_character', { name: 'Owen Marsh', character: 'Ash' }),
    ]);
    expect(field(t('character'))).toHaveValue('');
    // Enter in the name alone adds one without a character.
    type(role('actor'), 'Ida Kerr');
    enter(role('actor'));
    expect(onChange).toHaveBeenLastCalledWith([
      { role: 'actor', displayName: 'Owen Marsh', character: 'Ash' },
      { role: 'actor', displayName: 'Ida Kerr' },
    ]);
  });

  it('refuses someone already in that role, not in another', () => {
    const onChange = vi.fn();
    renderEditor({
      initial: [{ role: 'director', displayName: 'Sam Brandt' }],
      onChange,
    });
    type(role('director'), 'sam  BRANDT');
    enter(role('director'));
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        t('duplicate', { name: 'sam BRANDT', role: role('director') })
      )
    ).toBeInTheDocument();
    expect(field(role('director'))).toHaveValue('sam  BRANDT');

    type(role('writer'), 'Sam Brandt');
    enter(role('writer'));
    expect(onChange).toHaveBeenLastCalledWith([
      { role: 'director', displayName: 'Sam Brandt' },
      { role: 'writer', displayName: 'Sam Brandt' },
    ]);
  });

  it('is greyed exactly like the form, its names kept', () => {
    renderEditor(
      {
        initial: [
          { role: 'actor', displayName: 'Ted Brandt', character: 'Stand-in' },
        ],
        disabled: true,
      },
      darkTheme
    );
    for (const box of screen.getAllByRole('textbox')) {
      expect(box).toBeDisabled();
    }
    expect(
      screen.getByRole('button', {
        name: t('remove', { name: 'Ted Brandt', role: role('actor') }),
      })
    ).toBeDisabled();
    expect(names(role('actor'))).toEqual([
      t('as_character', { name: 'Ted Brandt', character: 'Stand-in' }),
    ]);
  });

  it('takes 200 names at most', () => {
    const initial = Array.from({ length: 200 }, (_, index) => ({
      role: 'actor' as const,
      displayName: `Actor ${index}`,
    }));
    const onChange = vi.fn();
    renderEditor({ initial, onChange });
    expect(screen.getByRole('status')).toHaveTextContent(
      t('limit', { max: 200 })
    );
    expect(field(role('director'))).toBeDisabled();
    // Taking one out makes room.
    fireEvent.click(
      screen.getByRole('button', {
        name: t('remove', { name: 'Actor 0', role: role('actor') }),
      })
    );
    expect(onChange).toHaveBeenLastCalledWith(initial.slice(1));
    expect(field(role('director'))).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('where it shows', () => {
  const renderFields = (
    destination: 'subscreen-film' | 'subscreen-series' | 'qtube'
  ) => {
    const onChange = vi.fn();
    render(
      <ThemeProvider theme={lightTheme}>
        <ItemFieldsForm
          destination={destination}
          fields={{ title: 'Film', credits: [] }}
          index={0}
          missing={[]}
          onChange={onChange}
          seriesTitle="Show"
        />
      </ThemeProvider>
    );
    return onChange;
  };

  it('is in a Subscreen film’s fields, saved with them', () => {
    const onChange = renderFields('subscreen-film');
    type(role('director'), 'Sam Brandt');
    enter(role('director'));
    expect(onChange).toHaveBeenCalledWith({
      credits: [{ role: 'director', displayName: 'Sam Brandt' }],
    });
  });

  it('is not in an episode’s, nor in other apps’', () => {
    renderFields('subscreen-series');
    expect(screen.queryByRole('group', { name: t('heading') })).toBeNull();
    cleanup();
    renderFields('qtube');
    expect(screen.queryByRole('group', { name: t('heading') })).toBeNull();
  });

  it('is in the series’ form, for the series', () => {
    const updateSettings = vi.fn();
    const controller = {
      updateSettings,
      sortEpisodes: vi.fn(),
      loadFrames: vi.fn(),
    } as unknown as VideoPublisherController;
    const series: SeriesFields = {
      title: 'Show',
      year: null,
      genre: 201,
      description: '',
      poster: null,
      credits: [{ role: 'writer', displayName: 'Hal Bremer' }],
    };
    render(
      <ThemeProvider theme={lightTheme}>
        <SeriesForm
          controller={controller}
          disabled={false}
          firstEpisode={undefined}
          missing={[]}
          series={series}
        />
      </ThemeProvider>
    );
    expect(names(role('writer'))).toEqual(['Hal Bremer']);
    type(role('composer'), 'Dave Porter');
    enter(role('composer'));
    const { calls } = updateSettings.mock;
    const change = calls[calls.length - 1][0];
    expect(change({ series })).toEqual({
      series: {
        ...series,
        credits: [
          { role: 'writer', displayName: 'Hal Bremer' },
          { role: 'composer', displayName: 'Dave Porter' },
        ],
      },
    });
  });
});
