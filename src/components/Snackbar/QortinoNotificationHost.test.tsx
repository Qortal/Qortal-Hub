import React, { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider, useAtom, useSetAtom } from 'jotai';
import { infoSnackGlobalAtom, openSnackGlobalAtom } from '../../atoms/global';
import { LoadingSnackbar } from './LoadingSnackbar';
import { QortinoNotificationHost } from './QortinoNotificationHost';

type Phase = 'idle' | 'working' | 'done' | 'stopped';

/**
 * Shows a loading snackbar while working. Done says what came of it in the
 * same update that ends the loading snackbar; stopped only ends it.
 */
const Task = ({ phase }: { phase: Phase }) => {
  const setInfo = useSetAtom(infoSnackGlobalAtom);
  const setOpen = useSetAtom(openSnackGlobalAtom);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (phase === 'working') setWorking(true);
    if (phase === 'done') {
      setInfo({ type: 'success', message: 'Done' });
      setOpen(true);
    }
    if (phase === 'done' || phase === 'stopped') setWorking(false);
  }, [phase, setInfo, setOpen]);
  return <LoadingSnackbar info={{ message: 'Working…' }} open={working} />;
};

/** Hub's own snackbar, after the content, as App mounts it. */
const Host = () => {
  const [info, setInfo] = useAtom(infoSnackGlobalAtom);
  const [open, setOpen] = useAtom(openSnackGlobalAtom);
  return (
    <QortinoNotificationHost
      info={info}
      open={open}
      setInfo={setInfo}
      setOpen={setOpen}
    />
  );
};

const renderTask = () => {
  const store = createStore();
  const view = (phase: Phase) => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <Task phase={phase} />
        <Host />
      </ThemeProvider>
    </Provider>
  );
  const { rerender } = render(view('idle'));
  const to = async (phase: Phase) => {
    await act(async () => {
      rerender(view(phase));
    });
  };
  return { store, to };
};

describe("Hub's own snackbar and a loading snackbar", () => {
  it('keeps a message that opens as the loading snackbar closes', async () => {
    const { store, to } = renderTask();
    await to('working');
    expect(store.get(infoSnackGlobalAtom)).toMatchObject({
      message: 'Working…',
    });

    await to('done');
    expect(store.get(infoSnackGlobalAtom)).toMatchObject({
      type: 'success',
      message: 'Done',
    });
    expect(store.get(openSnackGlobalAtom)).toBe(true);
  });

  it('closes the loading snackbar when nothing took its place', async () => {
    const { store, to } = renderTask();
    await to('working');
    expect(store.get(openSnackGlobalAtom)).toBe(true);

    await to('stopped');
    expect(store.get(openSnackGlobalAtom)).toBe(false);
    expect(store.get(infoSnackGlobalAtom)).toBeNull();
  });
});
