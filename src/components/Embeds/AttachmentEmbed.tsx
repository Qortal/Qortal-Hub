import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { MyContext, getBaseApiReact } from "../../App";
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  RadioGroup,
  Radio,
  FormControlLabel,
  Button,
  Box,
  ButtonBase,
  Divider,
  Dialog,
  IconButton,
  CircularProgress,
} from "@mui/material";
import { base64ToBlobUrl } from "../../utils/fileReading";
import { saveFileToDiskGeneric } from "../../utils/generateWallet/generateWallet";
import AttachmentIcon from '@mui/icons-material/Attachment';
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { CustomLoader } from "../../common/CustomLoader";
import { Spacer } from "../../common/Spacer";
import { FileAttachmentContainer, FileAttachmentFont } from "./Embed-styles";
import DownloadIcon from "@mui/icons-material/Download";
import SaveIcon from '@mui/icons-material/Save';
import { useSetRecoilState } from "recoil";
import { blobControllerAtom } from "../../atoms/global";
import { decodeIfEncoded } from "../../utils/decode";


export const AttachmentCard = ({
    resourceData,
    resourceDetails,
    owner,
    refresh,
    openExternal,
    external,
    isLoadingParent,
    errorMsg,
    encryptionType,
    selectedGroupId
  }) => {

    const [isOpen, setIsOpen] = useState(true);
    const { downloadResource } = useContext(MyContext);
  
    const saveToDisk = async ()=> {
      const { name, service, identifier } = resourceData;
  
          const url = `${getBaseApiReact()}/arbitrary/${service}/${name}/${identifier}`;
          fetch(url)
            .then(response => response.blob())
            .then(async blob => {
              await saveFileToDiskGeneric(blob, resourceData?.fileName)
            })
            .catch(error => {
              console.error("Error fetching the video:", error);
            });
    }
  
    const saveToDiskEncrypted = async ()=> {
      let blobUrl
      try {
        const { name, service, identifier,key } = resourceData;
  
        const url = `${getBaseApiReact()}/arbitrary/${service}/${name}/${identifier}?encoding=base64`;
        const res = await fetch(url)
        const data = await res.text();
        let decryptedData
        try {
          if(key && encryptionType === 'private'){
            decryptedData = await window.sendMessage(
              "DECRYPT_DATA_WITH_SHARING_KEY",
             
                {
                  encryptedData: data,
                key: decodeURIComponent(key),
                }
              
            );
          }
           if(encryptionType === 'group'){
            decryptedData = await window.sendMessage(
              "DECRYPT_QORTAL_GROUP_DATA",
             
                {
                  data64: data,
                groupId: selectedGroupId,
                }
              
            );
           }
        } catch (error) {
          throw new Error('Unable to decrypt')
        }
        
        if (!decryptedData || decryptedData?.error) throw new Error("Could not decrypt data");
         blobUrl = base64ToBlobUrl(decryptedData, resourceData?.mimeType)
        const response = await fetch(blobUrl);
      const blob = await response.blob();
        await saveFileToDiskGeneric(blob,  resourceData?.fileName)
  
      } catch (error) {
        console.error(error)
      } finally {
        if(blobUrl){
          URL.revokeObjectURL(blobUrl);
        }
  
      }
    }
    return (
      <Card
        sx={{
          backgroundColor: "#1F2023",
          height: "250px",
          // height: isOpen ? "auto" : "150px",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 16px 0px 16px",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <AttachmentIcon
              sx={{
                color: "white",
              }}
            />
            <Typography>ATTACHMENT embed</Typography>
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <ButtonBase>
              <RefreshIcon
                onClick={refresh}
                sx={{
                  fontSize: "24px",
                  color: "white",
                }}
              />
            </ButtonBase>
            {external && (
              <ButtonBase>
                <OpenInNewIcon
                  onClick={openExternal}
                  sx={{
                    fontSize: "24px",
                    color: "white",
                  }}
                />
              </ButtonBase>
            )}
          </Box>
        </Box>
        <Box
          sx={{
            padding: "8px 16px 8px 16px",
          }}
        >
          <Typography
            sx={{
              fontSize: "12px",
              color: "white",
            }}
          >
            Created by {decodeIfEncoded(owner)}
          </Typography>
          <Typography
            sx={{
              fontSize: "12px",
              color: "cadetblue",
            }}
          >
                      {encryptionType === 'private' ? "ENCRYPTED" : encryptionType === 'group' ? 'GROUP ENCRYPTED' : "Not encrypted"}

          </Typography>
        </Box>
        <Divider sx={{ borderColor: "rgb(255 255 255 / 10%)" }} />
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            alignItems: "center",
          }}
        >
         
          {isLoadingParent && isOpen && (
            <Box
              sx={{
                width: "100%",
                display: "flex",
                justifyContent: "center",
              }}
            >
              {" "}
              <CustomLoader />{" "}
            </Box>
          )}
          {errorMsg && (
            <Box
              sx={{
                width: "100%",
                display: "flex",
                justifyContent: "center",
              }}
            >
              {" "}
              <Typography
                sx={{
                  fontSize: "14px",
                  color: "var(--danger)",
                }}
              >
                {errorMsg}
              </Typography>{" "}
            </Box>
          )}
        </Box>
  
        <Box>
          <CardContent>
          {resourceData?.fileName && (
                <>
                <Typography sx={{
                  fontSize: '14px'
                }}>{resourceData?.fileName}</Typography>
                <Spacer height="10px" />
                </>
              )}
            <ButtonBase sx={{
              width: '90%',
              maxWidth: '400px'
            }} onClick={()=> {
            if(resourceDetails?.status?.status === 'READY'){
              if(encryptionType){
                saveToDiskEncrypted()
                return
              }
              saveToDisk()
              return
            }
            downloadResource(resourceData)
          }}>
             
          <FileAttachmentContainer >
            <Typography>{resourceDetails?.status?.status}</Typography>
            {!resourceDetails && (
              <>
                        <DownloadIcon />
                        <FileAttachmentFont>Download File</FileAttachmentFont>
  
              </>
            )}
            {resourceDetails && resourceDetails?.status?.status !== 'READY' && resourceDetails?.status?.status !== 'FAILED_TO_DOWNLOAD' && (
              <>
                        <CircularProgress sx={{
                          color: 'white'
                        }} size={20} />
                        <FileAttachmentFont>Downloading: {resourceDetails?.status?.percentLoaded || '0'}%</FileAttachmentFont>
  
              </>
            )}
            {resourceDetails && resourceDetails?.status?.status === 'READY' &&  (
              <>
                        <SaveIcon />
                        <FileAttachmentFont>Save to Disk</FileAttachmentFont>
  
              </>
            )}
               
              
              </FileAttachmentContainer>
              </ButtonBase>
             
          </CardContent>
        </Box>
      </Card>
    );
  };