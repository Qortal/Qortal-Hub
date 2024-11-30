import React, {  useEffect, useMemo, useRef, useState } from "react";
import { getBaseApiReact } from "../../App";


import { CustomizedSnackbars } from "../Snackbar/Snackbar";

import { extractComponents } from "../Chat/MessageDisplay";
import { executeEvent } from "../../utils/events";

import { base64ToBlobUrl } from "../../utils/fileReading";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { blobControllerAtom, blobKeySelector, resourceKeySelector } from "../../atoms/global";
import { parseQortalLink } from "./embed-utils";
import { PollCard } from "./PollEmbed";
import { ImageCard } from "./ImageEmbed";
import { AttachmentCard } from "./AttachmentEmbed";

const getPoll = async (name) => {
  const pollName = name;
  const url = `${getBaseApiReact()}/polls/${pollName}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const responseData = await response.json();
  if (responseData?.message?.includes("POLL_NO_EXISTS")) {
    throw new Error("POLL_NO_EXISTS");
  } else if (responseData?.pollName) {
    const urlVotes = `${getBaseApiReact()}/polls/votes/${pollName}`;

    const responseVotes = await fetch(urlVotes, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const responseDataVotes = await responseVotes.json();
    return {
      info: responseData,
      votes: responseDataVotes,
    };
  }
};

export const Embed = ({ embedLink }) => {
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [poll, setPoll] = useState(null);
  const [type, setType] = useState("");
  const hasFetched = useRef(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [external, setExternal] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [parsedData, setParsedData] = useState(null);
  const setBlobs = useSetRecoilState(blobControllerAtom);

  const resourceData = useMemo(()=> {
    const parsedDataOnTheFly = parseQortalLink(embedLink);
    if(parsedDataOnTheFly?.service && parsedDataOnTheFly?.name && parsedDataOnTheFly?.identifier){
      return {
        service : parsedDataOnTheFly?.service,
        name: parsedDataOnTheFly?.name,
        identifier: parsedDataOnTheFly?.identifier,
        fileName: parsedDataOnTheFly?.fileName ? decodeURIComponent(parsedDataOnTheFly?.fileName) : null,
        mimeType: parsedDataOnTheFly?.mimeType ? decodeURIComponent(parsedDataOnTheFly?.mimeType) : null,
        key:  parsedDataOnTheFly?.key ? decodeURIComponent(parsedDataOnTheFly?.key) : null,
      }
    } else {
      return null
    }
  }, [embedLink])

  const keyIdentifier = useMemo(()=> {
    
    if(resourceData){
      return `${resourceData.service}-${resourceData.name}-${resourceData.identifier}`
    } else {
      return undefined
    }
  }, [resourceData])
  const blobUrl = useRecoilValue(blobKeySelector(keyIdentifier));

  const handlePoll = async (parsedData) => {
    try {
      setIsLoading(true);
      setErrorMsg("");
      setType("POLL");
      if (!parsedData?.name)
        throw new Error("Invalid poll embed link. Missing name.");
      const pollRes = await getPoll(parsedData.name);
      setPoll(pollRes);
    
    } catch (error) {
      setErrorMsg(error?.message || "Invalid embed link");
    } finally {
      setIsLoading(false);
    }
  };

  const getImage = async ({ identifier, name, service }, key, parsedData) => {
    try {
      if(blobUrl?.blobUrl){
        return blobUrl?.blobUrl
      }
      let numberOfTries = 0;
      let imageFinalUrl = null;

      const tryToGetImageStatus = async () => {
        const urlStatus = `${getBaseApiReact()}/arbitrary/resource/status/${service}/${name}/${identifier}?build=true`;

        const responseStatus = await fetch(urlStatus, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        const responseData = await responseStatus.json();
        if (responseData?.status === "READY") {
          if (parsedData?.encryptionType) {
            const urlData = `${getBaseApiReact()}/arbitrary/${service}/${name}/${identifier}?encoding=base64`;

            const responseData = await fetch(urlData, {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
              },
            });
            const data = await responseData.text();
            if (data) {
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
                      groupId: 683,
                      }
                    
                  );
                 }
              } catch (error) {
                throw new Error('Unable to decrypt')
              }
              
              if (!decryptedData || decryptedData?.error) throw new Error("Could not decrypt data");
               imageFinalUrl = base64ToBlobUrl(decryptedData)
               setBlobs((prev=> {
                return {
                  ...prev,
                  [`${service}-${name}-${identifier}`]: {
                    blobUrl: imageFinalUrl,
                    timestamp: Date.now()
                  }
                }
              }))
            } else {
              throw new Error('No data for image')
            }
            
          } else {
          imageFinalUrl = `${getBaseApiReact()}/arbitrary/${service}/${name}/${identifier}?async=true`;
         
          // If parsedData is used here, it must be defined somewhere
        
        }
        }
      };

      // Retry logic
      while (!imageFinalUrl && numberOfTries < 3) {
        await tryToGetImageStatus();
        if (!imageFinalUrl) {
          numberOfTries++;
          await new Promise((res) => {
            setTimeout(() => {
              res(null);
            }, 5000);
          });
        }
      }

      if (imageFinalUrl) {
       
        return imageFinalUrl;
      } else {
        setErrorMsg(
          "Unable to download IMAGE. Please try again later by clicking the refresh button"
        );
        return null;
      }
    } catch (error) {
      console.error("Error fetching image:", error);
      setErrorMsg(
       error?.error || error?.message ||  "An unexpected error occurred while trying to download the image"
      );
      return null;
    }
  };

  const handleImage = async (parsedData) => {
    try {
      setIsLoading(true);
      setErrorMsg("");
      if (!parsedData?.name || !parsedData?.service || !parsedData?.identifier)
        throw new Error("Invalid image embed link. Missing param.");
      let image = await getImage({
        name: parsedData.name,
        service: parsedData.service,
        identifier: parsedData?.identifier,
      }, parsedData?.key, parsedData);
      
      setImageUrl(image);

    } catch (error) {
      setErrorMsg(error?.message || "Invalid embed link");
    } finally {
      setIsLoading(false);
    }
  };

 
  const handleLink = () => {
    try {
      const parsedData = parseQortalLink(embedLink);
      setParsedData(parsedData);
      const type = parsedData?.type;
      try {
        if (parsedData?.ref) {
          const res = extractComponents(decodeURIComponent(parsedData.ref));
          if (res?.service && res?.name) {
            setExternal(res);
          }
        }
      } catch (error) {
        
      }
      switch (type) {
        case "POLL":
          {
            handlePoll(parsedData);
          }
          break;
        case "IMAGE":
          setType("IMAGE");

          break;
          case "ATTACHMENT":
            setType("ATTACHMENT");
            
            break;
        default:
          break;
      }
    } catch (error) {
      setErrorMsg(error?.message || "Invalid embed link");
    }
  };

  const fetchImage = () => {
    try {
      const parsedData = parseQortalLink(embedLink);
      handleImage(parsedData);
    } catch (error) {
      setErrorMsg(error?.message || "Invalid embed link");
    }
  };

  const openExternal = () => {
    executeEvent("addTab", { data: external });
    executeEvent("open-apps-mode", {});
  };

  useEffect(() => {
    if (!embedLink || hasFetched.current) return;
    handleLink();
    hasFetched.current = true;
  }, [embedLink]);



  const resourceDetails = useRecoilValue(resourceKeySelector(keyIdentifier));

  const { parsedType, encryptionType } = useMemo(() => {
    let parsedType;
    let encryptionType = false;
    try {
      const parsedDataOnTheFly = parseQortalLink(embedLink);
      if (parsedDataOnTheFly?.type) {
        parsedType = parsedDataOnTheFly.type;
      }
      if (parsedDataOnTheFly?.encryptionType) {
        encryptionType = parsedDataOnTheFly?.encryptionType
      }
    } catch (error) {}
    return { parsedType, encryptionType };
  }, [embedLink]);

  return (
    <div>
      {parsedType === "POLL" && (
        <PollCard
          poll={poll}
          refresh={handleLink}
          setInfoSnack={setInfoSnack}
          setOpenSnack={setOpenSnack}
          external={external}
          openExternal={openExternal}
          isLoadingParent={isLoading}
          errorMsg={errorMsg}
        />
      )}
      {parsedType === "IMAGE" && (
        <ImageCard
          image={imageUrl}
          owner={parsedData?.name}
          fetchImage={fetchImage}
          refresh={fetchImage}
          setInfoSnack={setInfoSnack}
          setOpenSnack={setOpenSnack}
          external={external}
          openExternal={openExternal}
          isLoadingParent={isLoading}
          errorMsg={errorMsg}
          encryptionType={encryptionType}
        />
      )}
      {parsedType === 'ATTACHMENT' && (
        <AttachmentCard
        resourceData={resourceData}
        resourceDetails={resourceDetails}
          owner={parsedData?.name}
          refresh={fetchImage}
          setInfoSnack={setInfoSnack}
          setOpenSnack={setOpenSnack}
          external={external}
          openExternal={openExternal}
          isLoadingParent={isLoading}
          errorMsg={errorMsg}
          encryptionType={encryptionType}
        />
      )}
      <CustomizedSnackbars
        duration={2000}
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </div>
  );
};








