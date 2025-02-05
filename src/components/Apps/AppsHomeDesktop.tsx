import React, { useContext, useMemo, useState } from "react";
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
  AppsParent,
  PublishQAppChoseFile,
  PublishQAppInfo,
} from "./Apps-styles";
import { Avatar, Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, Input, MenuItem, Select, Tab, Tabs, Typography } from "@mui/material";
import { Add } from "@mui/icons-material";
import { getBaseApiReact, isMobile, MyContext } from "../../App";
import LogoSelected from "../../assets/svgs/LogoSelected.svg";
import { executeEvent } from "../../utils/events";
import { Spacer } from "../../common/Spacer";
import { SortablePinnedApps } from "./SortablePinnedApps";
import { extractComponents } from "../Chat/MessageDisplay";
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import { createEndpoint, getFee } from "../../background";
import { useRecoilState, useSetRecoilState } from "recoil";
import { myGroupsWhereIAmAdminAtom, settingsLocalLastUpdatedAtom, sortablePinnedAppsAtom } from "../../atoms/global";
import { saveToLocalStorage } from "./AppsNavBarDesktop";
import { Label } from "../Group/AddGroup";
import { useHandlePrivateApps } from "./useHandlePrivateApps";
import { useDropzone } from "react-dropzone";
import ImageUploader from "../../common/ImageUploader";
import { base64ToBlobUrl, fileToBase64 } from "../../utils/fileReading";
import { objectToBase64 } from "../../qdn/encryption/group-encryption";

const maxFileSize = 50 * 1024 * 1024 ; // 50MB or 400MB

export const AppsHomeDesktop = ({
  setMode,
  myApp,
  myWebsite,
  availableQapps,
  myName
}) => {
    const {openApp} = useHandlePrivateApps()
    const [file, setFile] = useState(null)
    const [logo, setLogo] = useState(null)
    const { getRootProps, getInputProps } = useDropzone({
      accept: {
        "application/zip": [".zip"], // Only accept zip files
      },
      maxSize: maxFileSize,
      multiple: false, // Disable multiple file uploads
      onDrop: (acceptedFiles) => {
        if (acceptedFiles.length > 0) {
          setFile(acceptedFiles[0]); // Set the file name
        }
      },
      onDropRejected: (fileRejections) => {
        fileRejections.forEach(({ file, errors }) => {
          errors.forEach((error) => {
            if (error.code === "file-too-large") {
              console.error(
                `File ${file.name} is too large. Max size allowed is ${
                  maxFileSize / (1024 * 1024)
                } MB.`
              );
            }
          });
        });
      },
    });

      const {
        show,
        setInfoSnackCustom,
        memberGroups
      } = useContext(MyContext);
  const [qortalUrl, setQortalUrl] = useState('')
    const [selectedGroup, setSelectedGroup] = useState(0);
  
  const [valueTabPrivateApp, setValueTabPrivateApp] = useState(0)
const [myGroupsWhereIAmAdmin, setMyGroupsWhereIAmAdmin] = useRecoilState(
    myGroupsWhereIAmAdminAtom
  );
  const [isOpenPrivateModal, setIsOpenPrivateModal] = useState(false)
    const [sortablePinnedApps, setSortablePinnedApps] = useRecoilState(
      sortablePinnedAppsAtom
    );
      const setSettingsLocalLastUpdated = useSetRecoilState(
        settingsLocalLastUpdatedAtom
      );
  const [privateAppValues, setPrivateAppValues] = useState({
    name: 'a-test',
    service: 'DOCUMENT',
    identifier: 'qortal_test_private',
    groupId: 0
  })

  const [newPrivateAppValues, setNewPrivateAppValues] = useState({
    service: 'DOCUMENT',
    identifier: '',
    name: '',
  })

  const addPrivateApp = async ()=> {
    try {
      if(privateAppValues?.groupId === 0) return
      openApp(privateAppValues, true)
 
    
    } catch (error) {
      
    }
  }

  const clearFields = ()=> {
    setPrivateAppValues({
      name: '',
    service: 'DOCUMENT',
    identifier: '',
    groupId: 0
    })
    setNewPrivateAppValues({
service: 'DOCUMENT',
    identifier: '',
    name: ''
    })
    setFile(null)
    setValueTabPrivateApp(0)
    setSelectedGroup(0)
    setLogo(null)
    
  }

  const publishPrivateApp = async ()=> {
    try {
      if(selectedGroup === 0) return
      if(!logo) throw new Error('Please select an image for a logo')
      if(!myName) throw new Error('You need a Qortal name to publish')
        if(!newPrivateAppValues?.name) throw new Error('Your app needs a name')
      const base64Logo = await fileToBase64(logo)
      const base64App = await fileToBase64(file)
      const objectToSave = {
        app: base64App,
        logo: base64Logo,
        name: newPrivateAppValues.name
      }
      const object64 = await objectToBase64(objectToSave);
      const decryptedData = await window.sendMessage(
        "ENCRYPT_QORTAL_GROUP_DATA",

        {
          base64: object64,
          groupId: selectedGroup,
        }
      );
      if(decryptedData?.error){
        throw new Error(decryptedData?.error || 'Unable to encrypt app. App not published')
      }
      const fee = await getFee("ARBITRARY");
      
            await show({
              message: "Would you like to publish this app?",
              publishFee: fee.fee + " QORT",
            });
      await new Promise((res, rej) => {
        window
          .sendMessage("publishOnQDN", {
            data: decryptedData,
            identifier: newPrivateAppValues?.identifier,
            service: newPrivateAppValues?.service,
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(error.message || "An error occurred");
          });
      });
      openApp({
        identifier: newPrivateAppValues?.identifier,
            service: newPrivateAppValues?.service,
            name: myName,
            groupId: selectedGroup
      }, true)
      clearFields()
    } catch (error) {
      setInfoSnackCustom({
        type: "error",
        message: error?.message || "Unable to publish app",
      });
    }
  }
  const openQortalUrl = ()=> {
    try {
      if(!qortalUrl) return
      const res = extractComponents(qortalUrl);
      if (res) {
        const { service, name, identifier, path } = res;
        executeEvent("addTab", { data: { service, name, identifier, path } });
        executeEvent("open-apps-mode", { });
        setQortalUrl('qortal://')
      }
    } catch (error) {
      
    }
  }
  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setValueTabPrivateApp(newValue);
  };

  function a11yProps(index: number) {
    return {
      id: `simple-tab-${index}`,
      "aria-controls": `simple-tabpanel-${index}`,
    };
  }


  return (
    <>
     <AppsContainer
        sx={{
        
          justifyContent: "flex-start",
        }}
      >
      <AppLibrarySubTitle
        sx={{
          fontSize: "30px",
        }}
      >
        Apps Dashboard
      </AppLibrarySubTitle>
      </AppsContainer>
      <Spacer height="20px" />
      <AppsContainer
        sx={{
        
          justifyContent: "flex-start",
          
        }}
      >
        <Box sx={{
          display: 'flex',
          gap: '20px',
          alignItems: 'center',
          backgroundColor: '#1f2023',
          padding: '7px',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '500px'
        }}>
      <Input
              id="standard-adornment-name"
              value={qortalUrl}
              onChange={(e) => {
                setQortalUrl(e.target.value)
              }}
              disableUnderline
              autoComplete='off'
              autoCorrect='off'
              placeholder="qortal://"
              sx={{
                width: '100%',
                color: 'white',
                '& .MuiInput-input::placeholder': {
                  color: 'rgba(84, 84, 84, 0.70) !important',
                  fontSize: '20px',
                  fontStyle: 'normal',
                  fontWeight: 400,
                  lineHeight: '120%', // 24px
                  letterSpacing: '0.15px',
                  opacity: 1
                },
                '&:focus': {
                  outline: 'none',
                },
                // Add any additional styles for the input here
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && qortalUrl) {
                  openQortalUrl();
                }
              }}
            />
            <ButtonBase onClick={()=> openQortalUrl()}>
              <ArrowOutwardIcon sx={{
                color: qortalUrl ? 'white' : 'rgba(84, 84, 84, 0.70)'
              }} />
            </ButtonBase>
            </Box>
            </AppsContainer>
      <Spacer height="45px" />
      <AppsContainer
        sx={{
          gap: "50px",
          justifyContent: "flex-start",
        }}
      >
        <ButtonBase
          onClick={() => {
            setMode("library");
          }}
          sx={{
            width: "80px",
          }}
        >
          <AppCircleContainer
            sx={{
              gap: !isMobile ? "10px" : "5px",
            }}
          >
            <AppCircle>
              <Add>+</Add>
            </AppCircle>
            <AppCircleLabel>Library</AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setIsOpenPrivateModal(true);
          }}
          sx={{
            width: "80px",
          }}
        >
          <AppCircleContainer
            sx={{
              gap: !isMobile ? "10px" : "5px",
            }}
          >
            <AppCircle>
              <Add>+</Add>
            </AppCircle>
            <AppCircleLabel>Private</AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>
        <SortablePinnedApps
          isDesktop={true}
          availableQapps={availableQapps}
          myWebsite={myWebsite}
          myApp={myApp}
        />
      </AppsContainer>

      {isOpenPrivateModal && (
        <Dialog
          open={isOpenPrivateModal}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if(valueTabPrivateApp === 0){
                if(!privateAppValues.name || !privateAppValues.service || !privateAppValues.identifier || !privateAppValues?.groupId) return
                addPrivateApp();
              }
             
            }
          }}
          maxWidth="md"
          fullWidth={true}
        >
          <DialogTitle id="alert-dialog-title">
            {valueTabPrivateApp === 0 ? "Access private app" : "Publish private app"}
          </DialogTitle>
  
            <Box>
            <Tabs
      value={valueTabPrivateApp}
      onChange={handleChange}
      aria-label="basic tabs example"
      variant={isMobile ? 'scrollable' : 'fullWidth'} // Scrollable on mobile, full width on desktop
      scrollButtons="auto"
      allowScrollButtonsMobile
      sx={{
        "& .MuiTabs-indicator": {
          backgroundColor: "white",
        },
      }}
    >
      <Tab
        label="Access app"
        {...a11yProps(0)}
        sx={{
          "&.Mui-selected": {
            color: "white",
          },
          fontSize: isMobile ? '0.75rem' : '1rem', // Adjust font size for mobile
        }}
      />
      <Tab
        label="Publish app"
        {...a11yProps(1)}
        sx={{
          "&.Mui-selected": {
            color: "white",
          },
          fontSize: isMobile ? '0.75rem' : '1rem', // Adjust font size for mobile
        }}
      />
    </Tabs>
            </Box>
            {valueTabPrivateApp === 0 && (
              <>
              <DialogContent>
                  {/* <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              }}
            >
              <Label>service</Label>
              <Input
                placeholder="service"
                value={privateAppValues?.service}
                onChange={(e) => setPrivateAppValues((prev)=> {
                  return {
                    ...prev,
                    service: e.target.value
                  }
                })}
              />
            </Box> */}
              <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              }}
            >
              <Label>Select a group</Label>
              <Label>Only private groups will be shown</Label>
              <Select
                labelId="demo-simple-select-label"
                id="demo-simple-select"
                value={privateAppValues?.groupId}
                label="Groups"
                onChange={(e) => {
                  setPrivateAppValues((prev)=> {
                    return {
                      ...prev,
                      groupId: e.target.value
                    }
                  })
                }}
              >
             
                  <MenuItem  value={0}>
                  No group selected
                </MenuItem>
               
                {memberGroups?.filter((item)=> !item?.isOpen).map((group) => {
                  return (
                    <MenuItem key={group?.groupId} value={group?.groupId}>
                      {group?.groupName}
                    </MenuItem>
                  );
                })}
              </Select>
            </Box>
            <Spacer height="10px" />
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                marginTop: "15px",
              }}
            >
              <Label>name</Label>
              <Input
                placeholder="name"
                value={privateAppValues?.name}
                onChange={(e) => setPrivateAppValues((prev)=> {
                  return {
                    ...prev,
                    name: e.target.value
                  }
                })}
              />
            </Box>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                marginTop: "15px",
              }}
            >
              <Label>identifier</Label>
              <Input
                placeholder="identifier"
                value={privateAppValues?.identifier}
                onChange={(e) => setPrivateAppValues((prev)=> {
                  return {
                    ...prev,
                    identifier: e.target.value
                  }
                })}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={()=> {
              setIsOpenPrivateModal(false)
            }}>
              Close
            </Button>
            <Button
              disabled={!privateAppValues.name || !privateAppValues.service || !privateAppValues.identifier || !privateAppValues?.groupId}
              variant="contained"
              onClick={() => addPrivateApp()}
              autoFocus
            >
              Access
            </Button>
            </DialogActions>
              </>
            )}
          {valueTabPrivateApp === 1 && (
              <>
              <DialogContent>
                 <PublishQAppInfo sx={{
                          fontSize: '14px'
                        }}>
                          Select .zip file containing static content:{" "}
                        </PublishQAppInfo>
                        <Spacer height="10px" />
                        <PublishQAppInfo sx={{
                          fontSize: '14px'
                        }}>{`
                           50mb MB maximum`}</PublishQAppInfo>
                        {file && (
                          <>
                            <Spacer height="5px" />
                            <PublishQAppInfo >{`Selected: (${file?.name})`}</PublishQAppInfo>
                          </>
                        )}
                
                        <Spacer height="18px" />
                        <PublishQAppChoseFile {...getRootProps()}>
                          {" "}
                          <input {...getInputProps()} />
                          {file ? 'Change' : 'Choose'} File
                        </PublishQAppChoseFile>
                        <Spacer height="20px" />
              <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              }}
            >
              <Label>Select a group</Label>
              <Label>Only groups where you are an admin will be shown</Label>
              <Select
                labelId="demo-simple-select-label"
                id="demo-simple-select"
                value={selectedGroup}
                label="Groups where you are an admin"
                onChange={(e) => setSelectedGroup(e.target.value)}
              >
                  <MenuItem  value={0}>
                  No group selected
                </MenuItem>
                {myGroupsWhereIAmAdmin?.filter((item)=> !item?.isOpen).map((group) => {
                  return (
                    <MenuItem key={group?.groupId} value={group?.groupId}>
                      {group?.groupName}
                    </MenuItem>
                  );
                })}
              </Select>
            </Box>
            <Spacer height="20px" />
                  {/* <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              }}
            >
              <Label>service</Label>
              <Input
                placeholder="service"
                value={privateAppValues?.service}
                onChange={(e) => setPrivateAppValues((prev)=> {
                  return {
                    ...prev,
                    service: e.target.value
                  }
                })}
              />
            </Box> */}
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                marginTop: "15px",
              }}
            >
              <Label>identifier</Label>
              <Input
                placeholder="identifier"
                value={newPrivateAppValues?.identifier}
                onChange={(e) => setNewPrivateAppValues((prev)=> {
                  return {
                    ...prev,
                    identifier: e.target.value
                  }
                })}
              />
            </Box>
            <Spacer height="10px"/>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                marginTop: "15px",
              }}
            >
              <Label>App name</Label>
              <Input
                placeholder="App name"
                value={newPrivateAppValues?.name}
                onChange={(e) => setNewPrivateAppValues((prev)=> {
                  return {
                    ...prev,
                    name: e.target.value
                  }
                })}
              />
            </Box>

          <Spacer height="10px" />
        <ImageUploader onPick={(file) => setLogo(file)}>
          <Button variant="contained">Choose logo</Button>
        </ImageUploader>
        {logo?.name}
        <Spacer height="25px" />

          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={()=> {
              setIsOpenPrivateModal(false)
              clearFields()
            }}>
              Close
            </Button>
            <Button
              disabled={!privateAppValues.name || !privateAppValues.service || !privateAppValues.identifier || !selectedGroup}
              variant="contained"
              onClick={() => publishPrivateApp()}
              autoFocus
            >
              Publish
            </Button>
            </DialogActions>
              </>
            )}
         
        </Dialog>
      )}
    </>
  );
};
