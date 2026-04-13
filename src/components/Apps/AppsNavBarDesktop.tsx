import { useEffect, useMemo, useState } from 'react';
import {
  AppsNavBarParent,
  AppsNavBarRight,
} from './Apps-styles';
import { NavAdd } from '../../assets/Icons/NavAdd.tsx';
import { NavMoreMenu } from '../../assets/Icons/NavMoreMenu.tsx';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  ButtonBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  useTheme,
} from '@mui/material';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import PushPinIcon from '@mui/icons-material/PushPin';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

export function saveToLocalStorage(key, subKey, newValue) {
  try {
    // Fetch existing data
    const existingData = localStorage.getItem(key);
    let combinedData = {};

    if (existingData) {
      // Parse the existing data
      const parsedData = JSON.parse(existingData);
      // Merge with the new data under the subKey
      combinedData = {
        ...parsedData,
        timestamp: Date.now(), // Update the root timestamp
        [subKey]: newValue, // Assuming the data is an array
      };
    } else {
      // If no existing data, just use the new data under the subKey
      combinedData = {
        timestamp: Date.now(), // Set the initial root timestamp
        [subKey]: newValue,
      };
    }

    // Save combined data back to localStorage
    const serializedValue = JSON.stringify(combinedData);
    localStorage.setItem(key, serializedValue);
  } catch (error) {
    console.error('Error saving to localStorage:', error);
  }
}

export const AppsNavBarDesktop = ({
  disableBack,
  isApps,
}: {
  disableBack?: boolean;
  isApps?: boolean;
}) => {
  const [selectedTab, setSelectedTab] = useState(null);
  const [sortablePinnedApps, setSortablePinnedApps] = useAtom(
    sortablePinnedAppsAtom
  );

  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const setTabsToNav = (e) => {
    const { selectedTab } = e.detail?.data;
    setSelectedTab(!selectedTab ? null : { ...selectedTab });
  };

  useEffect(() => {
    subscribeToEvent('setTabsToNav', setTabsToNav);

    return () => {
      unsubscribeFromEvent('setTabsToNav', setTabsToNav);
    };
  }, []);

  const isSelectedAppPinned = useMemo(() => {
    if (selectedTab?.isPrivate) {
      return !!sortablePinnedApps?.find(
        (item) =>
          item?.privateAppProperties?.name ===
            selectedTab?.privateAppProperties?.name &&
          item?.privateAppProperties?.service ===
            selectedTab?.privateAppProperties?.service &&
          item?.privateAppProperties?.identifier ===
            selectedTab?.privateAppProperties?.identifier
      );
    } else {
      return !!sortablePinnedApps?.find(
        (item) =>
          item?.name === selectedTab?.name &&
          item?.service === selectedTab?.service
      );
    }
  }, [selectedTab, sortablePinnedApps]);

  return (
    <AppsNavBarParent
      sx={{
        borderRadius: '0px 30px 30px 0px',
        flexDirection: 'column',
        gap: '14px',
        height: 'auto',
        justifyContent: 'flex-start',
        padding: '10px',
        position: 'relative',
        width: '59px',
      }}
    >
      {isApps && selectedTab && (
        <AppsNavBarRight
          sx={{
            gap: '10px',
            flexDirection: 'column',
            width: '100%',
          }}
        >
          <ButtonBase
            onClick={() => {
              setSelectedTab(null);
              executeEvent('newTabWindow', {});
            }}
            sx={{
              alignItems: 'center',
              borderRadius: '50%',
              display: 'flex',
              height: '36px',
              justifyContent: 'center',
              width: '36px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              },
            }}
          >
            <NavAdd
              style={{
                height: '40px',
                width: '40px',
              }}
            />
          </ButtonBase>

          <ButtonBase
            onClick={(e) => {
              if (!selectedTab) return;
              handleClick(e);
            }}
            sx={{
              alignItems: 'center',
              borderRadius: '50%',
              display: 'flex',
              height: '36px',
              justifyContent: 'center',
              width: '36px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              },
            }}
          >
            <NavMoreMenu
              style={{
                height: '34px',
                width: '34px',
              }}
            />
          </ButtonBase>
        </AppsNavBarRight>
      )}

      <Menu
        id="navbar-more-mobile"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        slotProps={{
          list: {
            'aria-labelledby': 'basic-button',
          },
          paper: {
            sx: {
              backgroundColor: theme.palette.background.default,
              borderRadius: '8px',
              color: theme.palette.text.primary,
              width: '148px',
            },
          },
        }}
        sx={{
          marginTop: '10px',
        }}
      >
        <MenuItem
          onClick={() => {
            if (!selectedTab) return;

            setSortablePinnedApps((prev) => {
              let updatedApps;

              if (isSelectedAppPinned) {
                // Remove the selected app if it is pinned
                if (selectedTab?.isPrivate) {
                  updatedApps = prev.filter(
                    (item) =>
                      !(
                        item?.privateAppProperties?.name ===
                          selectedTab?.privateAppProperties?.name &&
                        item?.privateAppProperties?.service ===
                          selectedTab?.privateAppProperties?.service &&
                        item?.privateAppProperties?.identifier ===
                          selectedTab?.privateAppProperties?.identifier
                      )
                  );
                } else {
                  updatedApps = prev.filter(
                    (item) =>
                      !(
                        item?.name === selectedTab?.name &&
                        item?.service === selectedTab?.service
                      )
                  );
                }
              } else {
                // Add the selected app if it is not pinned
                if (selectedTab?.isPrivate) {
                  updatedApps = [
                    ...prev,
                    {
                      isPreview: true,
                      isPrivate: true,
                      privateAppProperties: {
                        ...(selectedTab?.privateAppProperties || {}),
                      },
                    },
                  ];
                } else {
                  updatedApps = [
                    ...prev,
                    {
                      name: selectedTab?.name,
                      service: selectedTab?.service,
                    },
                  ];
                }
              }

              saveToLocalStorage(
                'ext_saved_settings',
                'sortablePinnedApps',
                updatedApps
              );
              return updatedApps;
            });
            setSettingsLocalLastUpdated(Date.now());

            handleClose();
          }}
        >
          <ListItemIcon
            sx={{
              minWidth: '24px !important',
              marginRight: '5px',
            }}
          >
            <PushPinIcon
              height={20}
              sx={{
                color: isSelectedAppPinned
                  ? theme.palette.other.danger
                  : theme.palette.text.primary,
              }}
            />
          </ListItemIcon>

          <ListItemText
            sx={{
              '& .MuiTypography-root': {
                fontSize: '12px',
                fontWeight: 600,
                color: isSelectedAppPinned
                  ? theme.palette.other.danger
                  : theme.palette.text.primary,
              },
            }}
            primary={
              isSelectedAppPinned
                ? t('core:action.unpin_app', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:action.pin_app', {
                    postProcess: 'capitalizeFirstChar',
                  })
            }
          />
        </MenuItem>

        {!selectedTab?.isPrivate && (
          <MenuItem
            onClick={() => {
              executeEvent('copyLink', {
                tabId: selectedTab?.tabId,
              });
              handleClose();
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: '24px !important',
                marginRight: '5px',
              }}
            >
              <ContentCopyIcon
                height={20}
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
            </ListItemIcon>

            <ListItemText
              sx={{
                '& .MuiTypography-root': {
                  fontSize: '12px',
                  fontWeight: 600,
                  color: theme.palette.text.primary,
                },
              }}
              primary={t('core:action.copy_link', {
                postProcess: 'capitalizeFirstChar',
              })}
            />
          </MenuItem>
        )}
      </Menu>
    </AppsNavBarParent>
  );
};
