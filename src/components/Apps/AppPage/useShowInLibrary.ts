import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { QORTAL_APP_CONTEXT } from '../../../App';
import { getFee } from '../../../background/background';
import { AppRef, publishHiddenState } from './appPageQdn';
import { appPageErrorText } from './appPageErrors';
import {
  claimHiddenStateRun,
  hiddenStateChangeCount,
  useHiddenStateRun,
} from './useAppPage';

/**
 * Shows a hidden app in the library again (appHidden.ts): Hub's usual fee
 * confirmation, then the record again with `hidden: false`. While that is
 * published, from this page or the same app's page in another launcher tab,
 * hiding and showing it wait (`busy`), so it isn't published twice.
 */
export const useShowInLibrary = ({
  app,
  title,
  notify,
  onShown,
}: {
  app: AppRef;
  title: string;
  notify: (type: string, message: string) => void;
  onShown: () => void;
}) => {
  const { t } = useTranslation(['core']);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const running = !!useHiddenStateRun(app);

  const showInLibrary = async () => {
    // Shown or hidden again from another page since this click: what it was
    // for is gone, so it neither asks nor publishes.
    const clickedAt = hiddenStateChangeCount(app);
    const outdated = () => hiddenStateChangeCount(app) !== clickedAt;
    let fee: { fee: string };
    try {
      fee = await getFee('ARBITRARY');
    } catch (cause) {
      // The node can't be reached: say so, rather than act as if declined.
      notify('error', appPageErrorText(t, cause));
      return;
    }
    if (outdated()) return;
    try {
      // Hub asks one confirmation at a time and a newer one takes its place,
      // leaving this one unanswered: nothing is held until it is answered.
      await show({
        message: t('core:app_page.hide.confirm_show', {
          title,
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: `${fee.fee} QORT`,
      });
    } catch {
      return;
    }
    if (outdated()) return;
    const release = claimHiddenStateRun(app, 'show');
    if (!release) return;
    try {
      await publishHiddenState(app, { hidden: false, replaced: false });
      onShown();
      notify(
        'success',
        t('core:app_page.hide.done_shown', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    } catch (cause) {
      notify('error', appPageErrorText(t, cause));
    } finally {
      release();
    }
  };

  return { busy: running, showInLibrary };
};
