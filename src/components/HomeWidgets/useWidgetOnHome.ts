import { useCallback } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { userInfoAtom } from '../../atoms/global';
import {
  isHomePanelShown,
  readHomeLayout,
  saveHomeLayout,
  withHomePanelShown,
} from '../Group/HomeDesktop/homeLayout';
import {
  HOME_WIDGET_LIMIT,
  addSavedWidget,
  homeWidgetKey,
  removeSavedWidget,
  savedHomeWidgetsAtom,
} from './homeWidgets';
import { WIDGET_GRID_MAX_COLUMNS } from './widgetGrid';

export type WidgetOnHomeChange = 'added' | 'removed' | 'full' | 'unchanged';

interface WidgetRef {
  name: string;
  identifier: string | null;
  title?: string;
}

/**
 * Whether a widget is on Home, and putting it there or taking it off from
 * outside Home (the library's Widgets tab and a widget's page). It is the
 * same saved list Home's Widgets window shows, with the same limit.
 *
 * Adding shows Home's Widgets window when the account had hidden it:
 * otherwise the widget would be on Home but nowhere to be seen.
 */
export const useWidgetOnHome = (widget: WidgetRef | null | undefined) => {
  const [saved, setSaved] = useAtom(savedHomeWidgetsAtom);
  const address: string | undefined = useAtomValue(userInfoAtom)?.address;
  const key = widget?.name ? homeWidgetKey(widget) : '';
  const onHome = !!key && saved.some((item) => homeWidgetKey(item) === key);
  const full = saved.length >= HOME_WIDGET_LIMIT;

  const add = useCallback((): WidgetOnHomeChange => {
    if (!widget?.name) return 'unchanged';
    if (onHome) return 'unchanged';
    if (full) return 'full';
    setSaved((list) =>
      addSavedWidget(
        list,
        {
          name: widget.name,
          identifier: widget.identifier,
          ...(widget.title ? { title: widget.title } : {}),
        },
        WIDGET_GRID_MAX_COLUMNS
      )
    );
    if (address) {
      const layout = readHomeLayout(address);
      if (!isHomePanelShown(layout, 'widgets')) {
        saveHomeLayout(address, withHomePanelShown(layout, 'widgets', true));
      }
    }
    return 'added';
  }, [address, full, onHome, setSaved, widget]);

  const remove = useCallback((): WidgetOnHomeChange => {
    if (!key || !onHome) return 'unchanged';
    setSaved((list) => removeSavedWidget(list, key));
    return 'removed';
  }, [key, onHome, setSaved]);

  return { onHome, full, add, remove, limit: HOME_WIDGET_LIMIT };
};
