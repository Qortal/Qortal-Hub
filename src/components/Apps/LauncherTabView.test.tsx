import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { newLauncherTabState, showPublishPage } from './launcherTabs';

// The pages around the publish form: not what this file is about.
vi.mock('./AppsLauncher', () => ({ AppsLauncher: () => null }));
vi.mock('./AppInfo', () => ({ AppInfo: () => null }));
vi.mock('./AppsCategoryDesktop', () => ({ AppsCategoryDesktop: () => null }));

// The form says what it was opened on.
vi.mock('./AppPublish', () => ({
  AppPublish: (props: Record<string, unknown>) => (
    <output aria-label="publish form">
      {JSON.stringify({
        initialAppType: props.initialAppType,
        initialName: props.initialName ?? null,
        isAppTypeLocked: props.isAppTypeLocked,
        isUpdate: props.isUpdate,
        startAsWidget: props.startAsWidget,
        widgetToUpdate: props.widgetToUpdate ?? null,
      })}
    </output>
  ),
}));

import { LauncherTabView } from './LauncherTabView';

const renderPage = (page: string, target = null) =>
  render(
    <LauncherTabView
      availableQapps={[]}
      categories={[]}
      contentHeight="600px"
      getQapps={vi.fn()}
      isShown
      myAddress="Qme"
      myApp={null}
      myName="alice"
      myWebsite={null}
      onChange={vi.fn()}
      onUnsavedPublishChange={vi.fn()}
      state={showPublishPage(newLauncherTabState(), page, target)}
      tabId="launcher-1"
    />
  );

const formProps = () =>
  JSON.parse(screen.getByRole('status', { name: 'publish form' }).textContent);

describe('LauncherTabView: the publish page', () => {
  it("opens Update on a widget on that widget, under its name's APP", () => {
    renderPage('publish', {
      name: 'alice',
      service: 'APP',
      identifier: 'go-widget-now',
    });
    expect(formProps()).toEqual({
      initialAppType: 'APP',
      initialName: 'alice',
      isAppTypeLocked: true,
      isUpdate: true,
      startAsWidget: false,
      widgetToUpdate: 'go-widget-now',
    });
  });

  it("opens Update on the name's app without a widget", () => {
    renderPage('publish', { name: 'alice', service: 'APP' });
    expect(formProps()).toMatchObject({
      isUpdate: true,
      startAsWidget: false,
      widgetToUpdate: null,
    });
  });

  it('opens Publish widget on Widget, for a new one under any name', () => {
    renderPage('publish-widget');
    expect(formProps()).toEqual({
      initialAppType: 'APP',
      initialName: null,
      isAppTypeLocked: true,
      isUpdate: false,
      startAsWidget: true,
      widgetToUpdate: null,
    });
  });
});
