import { IconButton, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { hideHiddenAppsAtom } from '../../../atoms/appsAtoms';

/**
 * Leaves the apps their publishers hid out of the library (pressed, the
 * default), or shows them too: one choice per device (appHidden.ts).
 */
export const HiddenAppsToggle = () => {
  const { t } = useTranslation(['core']);
  const [hideHidden, setHideHidden] = useAtom(hideHiddenAppsAtom);
  const label = t('core:app_page.hide.library_toggle', {
    postProcess: 'capitalizeFirstChar',
  });

  return (
    <Tooltip
      describeChild
      disableInteractive
      enterDelay={0}
      title={
        hideHidden
          ? t('core:app_page.hide.library_toggle_on')
          : t('core:app_page.hide.library_toggle_off')
      }
    >
      <IconButton
        aria-label={label}
        aria-pressed={hideHidden}
        onClick={() => setHideHidden(!hideHidden)}
        sx={(theme) => ({
          backgroundColor: hideHidden
            ? 'transparent'
            : alpha(theme.palette.primary.main, 0.16),
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '12px',
          color: hideHidden
            ? theme.palette.text.secondary
            : theme.palette.text.primary,
          flexShrink: 0,
          height: 36,
          width: 36,
        })}
      >
        {hideHidden ? (
          <VisibilityOffRoundedIcon sx={{ fontSize: 18 }} />
        ) : (
          <VisibilityRoundedIcon sx={{ fontSize: 18 }} />
        )}
      </IconButton>
    </Tooltip>
  );
};
