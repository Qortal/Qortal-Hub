import React, { useContext, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Input,
  MenuItem,
  Select,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useDropzone } from "react-dropzone";
import { useHandlePrivateApps } from "./useHandlePrivateApps";
import { useRecoilState, useSetRecoilState } from "recoil";
import { myGroupsWhereIAmAdminAtom } from "../../atoms/global";
import { Label } from "../Group/AddGroup";
import { Spacer } from "../../common/Spacer";
import {
  Add,
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  PublishQAppChoseFile,
  PublishQAppInfo,
} from "./Apps-styles";
import ImageUploader from "../../common/ImageUploader";
import { isMobile, MyContext } from "../../App";
import { fileToBase64 } from "../../utils/fileReading";
import { objectToBase64 } from "../../qdn/encryption/group-encryption";
import { getFee } from "../../background";

const maxFileSize = 50 * 1024 * 1024; // 50MB

export const AppsPrivate = ({myName}) => {
  const { openApp } = useHandlePrivateApps();
  const [file, setFile] = useState(null);
  const [logo, setLogo] = useState(null);
  const [qortalUrl, setQortalUrl] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(0);

  const [valueTabPrivateApp, setValueTabPrivateApp] = useState(0);
  const [myGroupsWhereIAmAdmin, setMyGroupsWhereIAmAdmin] = useRecoilState(
    myGroupsWhereIAmAdminAtom
  );
  const [isOpenPrivateModal, setIsOpenPrivateModal] = useState(false);
  const { show, setInfoSnackCustom, setOpenSnackGlobal, memberGroups } = useContext(MyContext);

  const [privateAppValues, setPrivateAppValues] = useState({
    name: "",
    service: "DOCUMENT",
    identifier: "",
    groupId: 0,
  });

  const [newPrivateAppValues, setNewPrivateAppValues] = useState({
    service: "DOCUMENT",
    identifier: "",
    name: "",
  });
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

  const addPrivateApp = async () => {
    try {
      if (privateAppValues?.groupId === 0) return;
      
     await openApp(privateAppValues, true);
    } catch (error) {
        console.log('error', error?.message)
      
    }
  };

  const clearFields = () => {
    setPrivateAppValues({
      name: "",
      service: "DOCUMENT",
      identifier: "",
      groupId: 0,
    });
    setNewPrivateAppValues({
      service: "DOCUMENT",
      identifier: "",
      name: "",
    });
    setFile(null);
    setValueTabPrivateApp(0);
    setSelectedGroup(0);
    setLogo(null);
  };

  const publishPrivateApp = async () => {
    try {
      if (selectedGroup === 0) return;
      if (!logo) throw new Error("Please select an image for a logo");
      if (!myName) throw new Error("You need a Qortal name to publish");
      if (!newPrivateAppValues?.name) throw new Error("Your app needs a name");
      const base64Logo = await fileToBase64(logo);
      const base64App = await fileToBase64(file);
      const objectToSave = {
        app: base64App,
        logo: base64Logo,
        name: newPrivateAppValues.name,
      };
      const object64 = await objectToBase64(objectToSave);
      const decryptedData = await window.sendMessage(
        "ENCRYPT_QORTAL_GROUP_DATA",

        {
          base64: object64,
          groupId: selectedGroup,
        }
      );
      if (decryptedData?.error) {
        throw new Error(
          decryptedData?.error || "Unable to encrypt app. App not published"
        );
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
      openApp(
        {
          identifier: newPrivateAppValues?.identifier,
          service: newPrivateAppValues?.service,
          name: myName,
          groupId: selectedGroup,
        },
        true
      );
      clearFields();
    } catch (error) {
        setOpenSnackGlobal(true)
      setInfoSnackCustom({
        type: "error",
        message: error?.message || "Unable to publish app",
      });
    }
  };

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
      {isOpenPrivateModal && (
        <Dialog
          open={isOpenPrivateModal}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (valueTabPrivateApp === 0) {
                if (
                  !privateAppValues.name ||
                  !privateAppValues.service ||
                  !privateAppValues.identifier ||
                  !privateAppValues?.groupId
                )
                  return;
                addPrivateApp();
              }
            }
          }}
          maxWidth="md"
          fullWidth={true}
        >
          <DialogTitle id="alert-dialog-title">
            {valueTabPrivateApp === 0
              ? "Access private app"
              : "Publish private app"}
          </DialogTitle>

          <Box>
            <Tabs
              value={valueTabPrivateApp}
              onChange={handleChange}
              aria-label="basic tabs example"
              variant={isMobile ? "scrollable" : "fullWidth"} // Scrollable on mobile, full width on desktop
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
                  fontSize: isMobile ? "0.75rem" : "1rem", // Adjust font size for mobile
                }}
              />
              <Tab
                label="Publish app"
                {...a11yProps(1)}
                sx={{
                  "&.Mui-selected": {
                    color: "white",
                  },
                  fontSize: isMobile ? "0.75rem" : "1rem", // Adjust font size for mobile
                }}
              />
            </Tabs>
          </Box>
          {valueTabPrivateApp === 0 && (
            <>
              <DialogContent>
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
                      setPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          groupId: e.target.value,
                        };
                      });
                    }}
                  >
                    <MenuItem value={0}>No group selected</MenuItem>

                    {memberGroups
                      ?.filter((item) => !item?.isOpen)
                      .map((group) => {
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
                    onChange={(e) =>
                      setPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          name: e.target.value,
                        };
                      })
                    }
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
                    onChange={(e) =>
                      setPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          identifier: e.target.value,
                        };
                      })
                    }
                  />
                </Box>
              </DialogContent>
              <DialogActions>
                <Button
                  variant="contained"
                  onClick={() => {
                    setIsOpenPrivateModal(false);
                  }}
                >
                  Close
                </Button>
                <Button
                  disabled={
                    !privateAppValues.name ||
                    !privateAppValues.service ||
                    !privateAppValues.identifier ||
                    !privateAppValues?.groupId
                  }
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
                <PublishQAppInfo
                  sx={{
                    fontSize: "14px",
                  }}
                >
                  Select .zip file containing static content:{" "}
                </PublishQAppInfo>
                <Spacer height="10px" />
                <PublishQAppInfo
                  sx={{
                    fontSize: "14px",
                  }}
                >{`
                       50mb MB maximum`}</PublishQAppInfo>
                {file && (
                  <>
                    <Spacer height="5px" />
                    <PublishQAppInfo>{`Selected: (${file?.name})`}</PublishQAppInfo>
                  </>
                )}

                <Spacer height="18px" />
                <PublishQAppChoseFile {...getRootProps()}>
                  {" "}
                  <input {...getInputProps()} />
                  {file ? "Change" : "Choose"} File
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
                  <Label>
                    Only groups where you are an admin will be shown
                  </Label>
                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={selectedGroup}
                    label="Groups where you are an admin"
                    onChange={(e) => setSelectedGroup(e.target.value)}
                  >
                    <MenuItem value={0}>No group selected</MenuItem>
                    {myGroupsWhereIAmAdmin
                      ?.filter((item) => !item?.isOpen)
                      .map((group) => {
                        return (
                          <MenuItem key={group?.groupId} value={group?.groupId}>
                            {group?.groupName}
                          </MenuItem>
                        );
                      })}
                  </Select>
                </Box>
                <Spacer height="20px" />

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
                    onChange={(e) =>
                      setNewPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          identifier: e.target.value,
                        };
                      })
                    }
                  />
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
                  <Label>App name</Label>
                  <Input
                    placeholder="App name"
                    value={newPrivateAppValues?.name}
                    onChange={(e) =>
                      setNewPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          name: e.target.value,
                        };
                      })
                    }
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
                <Button
                  variant="contained"
                  onClick={() => {
                    setIsOpenPrivateModal(false);
                    clearFields();
                  }}
                >
                  Close
                </Button>
                <Button
                  disabled={
                    !newPrivateAppValues.name ||
                    !newPrivateAppValues.service ||
                    !newPrivateAppValues.identifier ||
                    !selectedGroup
                  }
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
