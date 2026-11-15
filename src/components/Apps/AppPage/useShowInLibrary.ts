import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QORTAL_APP_CONTEXT } from '../../../App';
import { getFee } from '../../../background/background';
import { AppRef, publishHiddenState } from './appPageQdn';
import { appPageErrorText } from './appPageErrors';

/**
 * Shows a hidden app in the library again (appHidden.ts): Hub's usual fee
 * confirmation, then the record again with `hidden: false`.
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
  const [busy, setBusy] = useState(false);

  const showInLibrary = async () => {
    let fee: { fee: string };
    try {
      fee = await getFee('ARBITRARY');
    } catch (cause) {
      // The node can't be reached: say so, rather than act as if declined.
      notify('error', appPageErrorText(t, cause));
      return;
    }
    try {
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
    setBusy(true);
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
      setBusy(false);
    }
  };

  return { busy, showInLibrary };
};
