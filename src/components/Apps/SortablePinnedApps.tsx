import { useMemo } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Avatar, ButtonBase } from '@mui/material';
import { AppCircle, AppCircleContainer, AppCircleLabel } from './Apps-styles';
import { getBaseApiReact } from '../../App';
import { executeEvent } from '../../utils/events';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { saveToLocalStorage } from './AppsNavBarDesktop';
import { ContextMenuPinnedApps } from '../ContextMenuPinnedApps';
import LockIcon from '@mui/icons-material/Lock';
import { useHandlePrivateApps } from '../../hooks/useHandlePrivateApps';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

const SortableItem = ({ id, name, app, isDesktop }) => {
  const { openApp } = useHandlePrivateApps();

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });

  const style = {
    backgroundColor: '#f9f9f9',
    border: '1px solid #ccc',
    borderRadius: '4px',
    color: 'black',
    cursor: 'grab',
    marginBottom: '5px',
    padding: '10px',
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  return (
    <ContextMenuPinnedApps app={app} isMine={!!app?.isMine}>
      <ButtonBase
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        sx={{
          width: '80px',
          transform: CSS.Transform.toString(transform),
          transition,
        }}
        onClick={async () => {
          if (app?.isPrivate) {
            try {
              await openApp(app?.privateAppProperties);
            } catch (error) {
              console.error(error);
            }
          } else {
            executeEvent('addTab', {
              data: app,
            });
          }
        }}
      >
        <AppCircleContainer
          sx={{
            border: 'none',
            gap: isDesktop ? '10px' : '5px',
          }}
        >
          <AppCircle
            sx={{
              border: 'none',
            }}
          >
            {app?.isPrivate && !app?.privateAppProperties?.logo ? (
              <LockIcon
                sx={{
                  height: '42px',
                  width: '42px',
                }}
              />
            ) : (
              <Avatar
                sx={{
                  height: '42px',
                  width: '42px',
                  '& img': {
                    objectFit: 'fill',
                  },
                }}
                alt={app?.metadata?.title || app?.name}
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
                    width: '31px',
                    height: 'auto',
                  }}
                  alt="center-icon"
                />
              </Avatar>
            )}
          </AppCircle>
          {app?.isPrivate ? (
            <AppCircleLabel>
              {`${
                app?.privateAppProperties?.appName ||
                t('core:app_private', {
                  postProcess: 'capitalizeFirstChar',
                })
              }`}
            </AppCircleLabel>
          ) : (
            <AppCircleLabel>{app?.metadata?.title || app?.name}</AppCircleLabel>
          )}
        </AppCircleContainer>
      </ButtonBase>
    </ContextMenuPinnedApps>
  );
};

export const SortablePinnedApps = ({
  isDesktop,
  myWebsite,
  myApp,
  availableQapps = [],
}) => {
  const [pinnedApps, setPinnedApps] = useAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const transformPinnedApps = useMemo(() => {
    // Clone the existing pinned apps list
    let pinned = [...pinnedApps];

    // Function to add or update `isMine` property
    const addOrUpdateIsMine = (pinnedList, appToCheck) => {
      if (!appToCheck) return pinnedList;

      const existingIndex = pinnedList.findIndex(
        (item) =>
          item?.service === appToCheck?.service &&
          item?.name === appToCheck?.name
      );

      if (existingIndex !== -1) {
        // If the app is already in the list, update it with `isMine: true`
        pinnedList[existingIndex] = {
          ...pinnedList[existingIndex],
          isMine: true,
        };
      } else {
        // If not in the list, add it with `isMine: true` at the beginning
        pinnedList.unshift({ ...appToCheck, isMine: true });
      }

      return pinnedList;
    };

    // Update or add `myWebsite` and `myApp` while preserving their positions
    pinned = addOrUpdateIsMine(pinned, myWebsite);
    pinned = addOrUpdateIsMine(pinned, myApp);

    // Update pinned list based on availableQapps
    pinned = pinned.map((pin) => {
      const findIndex = availableQapps?.findIndex(
        (item) => item?.service === pin?.service && item?.name === pin?.name
      );
      if (findIndex !== -1)
        return {
          ...availableQapps[findIndex],
          ...pin,
        };

      return pin;
    });

    return pinned;
  }, [myApp, myWebsite, pinnedApps, availableQapps]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10, // Set a distance to avoid triggering drag on small movements
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        distance: 10, // Also apply to touch
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (!over) return; // Make sure the drop target exists

    if (active.id !== over.id) {
      const oldIndex = transformPinnedApps.findIndex(
        (item) => `${item?.service}-${item?.name}` === active.id
      );
      const newIndex = transformPinnedApps.findIndex(
        (item) => `${item?.service}-${item?.name}` === over.id
      );

      const newOrder = arrayMove(transformPinnedApps, oldIndex, newIndex);
      setPinnedApps(newOrder);
      saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', newOrder);
      setSettingsLocalLastUpdated(Date.now());
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={transformPinnedApps.map((app) => `${app?.service}-${app?.name}`)}
      >
        {transformPinnedApps.map((app) => (
          <SortableItem
            app={app}
            id={`${app?.service}-${app?.name}`}
            isDesktop={isDesktop}
            key={`${app?.service}-${app?.name}`}
            name={app?.name}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
};
