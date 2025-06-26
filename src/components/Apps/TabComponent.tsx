import { TabParent } from './Apps-styles';
import { NavCloseTab } from '../../assets/Icons/NavCloseTab.tsx';
import { getBaseApiReact } from '../../App';
import { Avatar, ButtonBase, useTheme } from '@mui/material';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { executeEvent } from '../../utils/events';
import LockIcon from '@mui/icons-material/Lock';

const TabComponent = ({ isSelected, app }) => {
  const theme = useTheme();

  return (
    <ButtonBase
      onClick={() => {
        if (isSelected) {
          executeEvent('removeTab', {
            data: app,
          });
          return;
        }
        executeEvent('setSelectedTab', {
          data: app,
        });
      }}
    >
      <TabParent
        sx={{
          borderStyle: isSelected && 'solid',
          borderWidth: isSelected && '1px',
          borderColor: isSelected && theme.palette.text.primary,
        }}
      >
        {isSelected && (
          <NavCloseTab
            style={{
              position: 'absolute',
              right: '-5px',
              top: '-5px',
              zIndex: 1,
            }}
          />
        )}

        {app?.isPrivate && !app?.privateAppProperties?.logo ? (
          <LockIcon
            sx={{
              height: '28px',
              width: '28px',
            }}
          />
        ) : (
          <Avatar
            sx={{
              height: '28px',
              width: '28px',
            }}
            alt={app?.name}
            src={
              app?.privateAppProperties?.logo
                ? app?.privateAppProperties?.logo
                : `${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                    app?.name
                  }/qortal_avatar?async=true`
            }
          >
            <img
              style={{
                width: '28px',
                height: 'auto',
              }}
              src={LogoSelected}
              alt="center-icon"
            />
          </Avatar>
        )}
      </TabParent>
    </ButtonBase>
  );
};

export default TabComponent;
