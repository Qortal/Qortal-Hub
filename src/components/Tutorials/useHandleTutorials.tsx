import React, { useCallback, useEffect, useState } from "react";
import { saveToLocalStorage } from "../Apps/AppsNavBar";


const checkIfGatewayIsOnline = async () => {
    try {
      const url = `https://ext-node.qortal.link/admin/status`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data = await response.json();
      if (data?.height) {
        return true
      }
      return false
      
    } catch (error) {
      return false
      
    } 
  }
export const useHandleTutorials = () => {
  const [openTutorialModal, setOpenTutorialModal] = useState<any>(null);
const [shownTutorials, setShowTutorials] = useState(null)

useEffect(()=> {
    try {
        const storedData = localStorage.getItem('shown-tutorials');


    if (storedData) {
      setShowTutorials(JSON.parse(storedData));
    } else {
        setShowTutorials({})
    }
    } catch (error) {
        //error
    }
}, [])

  const saveShowTutorial = useCallback((type)=> {
    try {

        setShowTutorials((prev)=> {
            return {
                ...(prev || {}),
                [type]: true
            }
        })
        saveToLocalStorage('shown-tutorials', type, true)
    } catch (error) {
        //error
    }
  }, [])
  const showTutorial = useCallback(async (type, isForce) => {
    try {
        const isOnline = await checkIfGatewayIsOnline()
        if(!isOnline) return
        switch (type) {
            case "create-account":
              {
                  if((shownTutorials || {})['create-account'] && !isForce) return
                  saveShowTutorial('create-account')
                setOpenTutorialModal({
                  title: "Account Creation",
                  resource: {
                    name: "a-test",
                    service: "VIDEO",
                    identifier: "account-creation-hub",
                  },
                });
              }
              break;
            case "important-information":
              {
                  if((shownTutorials || {})['important-information'] && !isForce) return
                  saveShowTutorial('important-information')

                setOpenTutorialModal({
                  title: "Important Information!",
                  resource: {
                    name: "a-test",
                    service: "VIDEO",
                    identifier: "important-information-hub",
                  },
                });
              }
              break;
            case "getting-started":
              {
                  if((shownTutorials || {})['getting-started'] && !isForce) return
                  saveShowTutorial('getting-started')

                setOpenTutorialModal({
                  multi: [
                   
                    {
                      title: "1. Getting Started",
                      resource: {
                        name: "a-test",
                        service: "VIDEO",
                        identifier: "getting-started-hub",
                      },
                    },
                    {
                        title: "2. Overview",
                        resource: {
                          name: "a-test",
                          service: "VIDEO",
                          identifier: "overview-hub",
                        },
                      },
                    {
                      title: "3. Qortal Groups",
                      resource: {
                        name: "a-test",
                        service: "VIDEO",
                        identifier: "groups-hub",
                      },
                    },
                  ],
                });
              }
              break;
              case "qapps":
                  {
                      if((shownTutorials || {})['qapps'] && !isForce) return
                      saveShowTutorial('qapps')

                    setOpenTutorialModal({
                      multi: [
                        {
                          title: "1. Apps Dashboard",
                          resource: {
                            name: "a-test",
                            service: "VIDEO",
                            identifier: "apps-dashboard-hub",
                          },
                        },
                        {
                          title: "2. Apps Navigation",
                          resource: {
                            name: "a-test",
                            service: "VIDEO",
                            identifier: "apps-navigation-hub",
                          },
                        }
                       
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
  }, [shownTutorials]);
  return {
    showTutorial,
    openTutorialModal,
    setOpenTutorialModal,
    shownTutorialsInitiated: !!shownTutorials
  };
};
