import { useCallback, useEffect, useMemo, useState } from 'react';
import { saveToLocalStorage } from '../components/Apps/AppsNavBarDesktop';
import creationImg from '../components/Tutorials/img/creation.webp';
import dashboardImg from '../components/Tutorials/img/dashboard.webp';
import groupsImg from '../components/Tutorials/img/groups.webp';
import importantImg from '../components/Tutorials/img/important.webp';
import navigationImg from '../components/Tutorials/img/navigation.webp';
import overviewImg from '../components/Tutorials/img/overview.webp';
import startedImg from '../components/Tutorials/img/started.webp';
import obtainingImg from '../components/Tutorials/img/obtaining-qort.jpg';
import { useTranslation } from 'react-i18next';

const checkIfGatewayIsOnline = async () => {
  try {
    const url = `https://ext-node.qortal.link/admin/status`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    if (data?.height) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
};

export const useHandleTutorials = () => {
  const [openTutorialModal, setOpenTutorialModal] = useState<any>(null);
  const [shownTutorials, setShowTutorials] = useState(null);
  const { t } = useTranslation(['core', 'tutorial']);

  useEffect(() => {
    try {
      let storedData;
      if (window?.walletStorage) {
        storedData = window.walletStorage.get('shown-tutorials');
      } else {
        storedData = localStorage.getItem('shown-tutorials');
      }

      if (storedData) {
        setShowTutorials(JSON.parse(storedData));
      } else {
        setShowTutorials({});
      }
    } catch (error) {
      //error
    }
  }, []);

  const saveShowTutorial = useCallback((type) => {
    try {
      setShowTutorials((prev) => {
        const objectToSave = {
          ...(prev || {}),
          [type]: true,
        };
        if (window?.walletStorage) {
          window.walletStorage.set('shown-tutorials', objectToSave);
        } else {
          saveToLocalStorage('shown-tutorials', type, true);
        }
        return objectToSave;
      });
    } catch (error) {
      //error
    }
  }, []);
  const showTutorial = useCallback(
    async (type, isForce) => {
      try {
        const isOnline = await checkIfGatewayIsOnline();
        if (!isOnline) return;
        switch (type) {
          case 'create-account':
            {
              if ((shownTutorials || {})['create-account'] && !isForce) return;
              saveShowTutorial('create-account');
              setOpenTutorialModal({
                title: 'Account Creation',
                resource: {
                  name: 'a-test',
                  service: 'VIDEO',
                  identifier: 'account-creation-hub',
                  poster: creationImg,
                },
              });
            }
            break;
          case 'important-information':
            {
              if ((shownTutorials || {})['important-information'] && !isForce)
                return;
              saveShowTutorial('important-information');

              setOpenTutorialModal({
                title: 'Important Information!',
                resource: {
                  name: 'a-test',
                  service: 'VIDEO',
                  identifier: 'important-information-hub',
                  poster: importantImg,
                },
              });
            }
            break;
          case 'getting-started':
            {
              if ((shownTutorials || {})['getting-started'] && !isForce) return;
              saveShowTutorial('getting-started');

              setOpenTutorialModal({
                multi: [
                  {
                    title: t('tutorial:1_getting_started', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                    resource: {
                      name: 'a-test',
                      service: 'VIDEO',
                      identifier: 'getting-started-hub',
                      poster: startedImg,
                    },
                  },
                  {
                    title: t('tutorial:2_overview', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                    resource: {
                      name: 'a-test',
                      service: 'VIDEO',
                      identifier: 'overview-hub',
                      poster: overviewImg,
                    },
                  },
                  {
                    title: t('tutorial:3_groups', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                    resource: {
                      name: 'a-test',
                      service: 'VIDEO',
                      identifier: 'groups-hub',
                      poster: groupsImg,
                    },
                  },
                  {
                    title: t('tutorial:4_obtain_qort', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                    resource: {
                      name: 'a-test',
                      service: 'VIDEO',
                      identifier: 'obtaining-qort',
                      poster: obtainingImg,
                    },
                  },
                ],
              });
            }
            break;
          case 'qapps':
            {
              if ((shownTutorials || {})['qapps'] && !isForce) return;
              saveShowTutorial('qapps');

              setOpenTutorialModal({
                multi: [
                  {
                    title: t('tutorial:apps.dashboard', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                    resource: {
                      name: 'a-test',
                      service: 'VIDEO',
                      identifier: 'apps-dashboard-hub',
                      poster: dashboardImg,
                    },
                  },
                  {
                    title: t('tutorial:apps.navigation', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                    resource: {
                      name: 'a-test',
                      service: 'VIDEO',
                      identifier: 'apps-navigation-hub',
                      poster: navigationImg,
                    },
                  },
                ],
              });
            }
            break;
          default:
            break;
        }
      } catch (error) {
        //error
      }
    },
    [shownTutorials]
  );
  return useMemo(
    () => ({
      showTutorial,
      hasSeenGettingStarted:
        shownTutorials === null
          ? null
          : !!(shownTutorials || {})['getting-started'],
      openTutorialModal,
      setOpenTutorialModal,
      shownTutorialsInitiated: !!shownTutorials,
    }),
    [showTutorial, openTutorialModal, setOpenTutorialModal, shownTutorials]
  );
};
