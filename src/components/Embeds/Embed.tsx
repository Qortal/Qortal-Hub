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
} from "@mui/material";
import { getNameInfo } from "../Group/Group";
import { getFee } from "../../background";
import { Spacer } from "../../common/Spacer";
import { CustomizedSnackbars } from "../Snackbar/Snackbar";
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { extractComponents } from "../Chat/MessageDisplay";
import { executeEvent } from "../../utils/events";
import { CustomLoader } from "../../common/CustomLoader";
import PollIcon from '@mui/icons-material/Poll';
function decodeHTMLEntities(str) {
  const txt = document.createElement("textarea");
  txt.innerHTML = str;
  return txt.value;
}

const parseQortalLink = (link) => {
    const prefix = "qortal://use-embed/";
    if (!link.startsWith(prefix)) {
      throw new Error("Invalid link format");
    }
  
    // Decode any HTML entities in the link
    link = decodeHTMLEntities(link);
  
    // Separate the type and query string
    const [typePart, queryPart] = link.slice(prefix.length).split("?");
  
    // Ensure only the type is parsed
    const type = typePart.split("/")[0].toUpperCase();
  
    const params = {};
    if (queryPart) {
      const queryPairs = queryPart.split("&");
  
      queryPairs.forEach((pair) => {
        const [key, value] = pair.split("=");
        if (key && value) {
          const decodedKey = decodeURIComponent(key.trim());
          const decodedValue = value.trim().replace(
            /<\/?[^>]+(>|$)/g,
            "" // Remove any HTML tags
          );
          params[decodedKey] = decodedValue;
        }
      });
    }
  
    return { type, ...params };
  };
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

  const handlePoll = async (parsedData) => {
    try {
      setIsLoading(true);
      setErrorMsg("");
      setType("POLL");
      if (!parsedData?.name)
        throw new Error("Invalid poll embed link. Missing name.");
      const pollRes = await getPoll(parsedData.name);
      setPoll(pollRes);
      if (parsedData?.ref) {
        const res = extractComponents(decodeURIComponent(parsedData.ref));
      

        if (res?.service && res?.name) {
          setExternal(res);
        }
      }
    } catch (error) {
      setErrorMsg(error?.message || "Invalid embed link");
    } finally {
      setIsLoading(false);
    }
  };
  const handleLink = () => {
    try {
      const parsedData = parseQortalLink(embedLink);
      console.log('parsedData', parsedData)
      const type = parsedData?.type;
      switch (type) {
        case "POLL":
          {
            handlePoll(parsedData);
          }
          break;

        default:
          break;
      }
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

  return (
    <div>
      {!type && <Box height="150px" />}
      {type === "POLL" && (
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

export const PollCard = ({
  poll,
  setInfoSnack,
  setOpenSnack,
  refresh,
  openExternal,
  external,
  isLoadingParent,
  errorMsg,
}) => {
  const [selectedOption, setSelectedOption] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { show, userInfo } = useContext(MyContext);
  const [isLoadingSubmit, setIsLoadingSubmit] = useState(false);
  const handleVote = async () => {
    const fee = await getFee("VOTE_ON_POLL");

    await show({
      message: `Do you accept this VOTE_ON_POLL transaction? POLLS are public!`,
      publishFee: fee.fee + " QORT",
    });
    setIsLoadingSubmit(true);

    window
      .sendMessage(
        "voteOnPoll",
        {
          pollName: poll?.info?.pollName,
          optionIndex: +selectedOption,
        },
        60000
      )
      .then((response) => {
        setIsLoadingSubmit(false);
        if (response.error) {
          setInfoSnack({
            type: "error",
            message: response?.error || "Unable to vote.",
          });
          setOpenSnack(true);
          return;
        } else {
          setInfoSnack({
            type: "success",
            message:
              "Successfully voted. Please wait a couple minutes for the network to propogate the changes.",
          });
          setOpenSnack(true);
        }
      })
      .catch((error) => {
        setIsLoadingSubmit(false);
        setInfoSnack({
          type: "error",
          message: error?.message || "Unable to vote.",
        });
        setOpenSnack(true);
      });
  };

  const getName = async (owner) => {
    try {
      const res = await getNameInfo(owner);
      if (res) {
        setOwnerName(res);
      }
    } catch (error) {}
  };

  useEffect(() => {
    if (poll?.info?.owner) {
      getName(poll.info.owner);
    }
  }, [poll?.info?.owner]);

  console.log('ownerName', ownerName)

  return (
    <Card
      sx={{
        backgroundColor: "#1F2023",
        height: isOpen ? 'auto' : "150px",

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
        <PollIcon sx={{
            color: 'white'
        }} />
        <Typography>POLL embed</Typography>
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
          }}
        >
          Created by {ownerName || poll?.info?.owner}
        </Typography>
      </Box>
      <Divider sx={{ borderColor: "rgb(255 255 255 / 10%)" }} />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          alignItems: 'center'
        }}
      >
        {!isOpen && !errorMsg && (
                <>
                <Spacer height="5px" />
          <Button
          size="small"
            variant="contained"
            sx={{
                backgroundColor: 'var(--green)',
            }}
            onClick={() => {
              setIsOpen(true);
            }}
           
          >
            Show poll
          </Button>
          </>
        )}
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
                color: 'var(--unread)'
              }}
            >
              {errorMsg}
            </Typography>{" "}
          </Box>
        )}
      </Box>

      <Box
        sx={{
          display: isOpen ? "block" : "none",
        }}
      >
        <CardHeader
          title={poll?.info?.pollName}
          subheader={poll?.info?.description}
          sx={{
            "& .MuiCardHeader-title": {
              fontSize: "18px", // Custom font size for title
            },
          }}
        />
        <CardContent>
          <Typography
            sx={{
              fontSize: "18px",
            }}
          >
            Options
          </Typography>
          <RadioGroup
            value={selectedOption}
            onChange={(e) => setSelectedOption(e.target.value)}
          >
            {poll?.info?.pollOptions?.map((option, index) => (
              <FormControlLabel
                key={index}
                value={index}
                control={
                  <Radio
                    sx={{
                      color: "white", // Unchecked color
                      "&.Mui-checked": {
                        color: "var(--green)", // Checked color
                      },
                    }}
                  />
                }
                label={option?.optionName}
              />
            ))}
          </RadioGroup>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
            }}
          >
            <Button
              variant="contained"
              color="primary"
              disabled={!selectedOption || isLoadingSubmit}
              onClick={handleVote}
            >
              Vote
            </Button>
            <Typography
              sx={{
                fontSize: "14px",
                fontStyle: "italic",
              }}
            >
              {" "}
              {`${poll?.votes?.totalVotes} ${
                poll?.votes?.totalVotes === 1 ? " vote" : " votes"
              }`}
            </Typography>
          </Box>

          <Spacer height="10px" />
          <Typography
            sx={{
              fontSize: "14px",
              visibility: poll?.votes?.votes?.find(
                (item) => item?.voterPublicKey === userInfo?.publicKey
              )
                ? "visible"
                : "hidden",
            }}
          >
            You've already voted.
          </Typography>
          <Spacer height="10px" />
          {isLoadingSubmit && (
            <Typography
              sx={{
                fontSize: "12px",
              }}
            >
              Is processing transaction, please wait...
            </Typography>
          )}
          <ButtonBase
            onClick={() => {
              setShowResults((prev) => !prev);
            }}
          >
            {showResults ? "hide " : "show "} results
          </ButtonBase>
        </CardContent>
        {showResults && <PollResults votes={poll?.votes} />}
      </Box>
    </Card>
  );
};

const PollResults = ({ votes }) => {
  const maxVotes = Math.max(
    ...votes?.voteCounts?.map((option) => option.voteCount)
  );
  const options = votes?.voteCounts;
  return (
    <Box sx={{ width: "100%", p: 2 }}>
      {options
        .sort((a, b) => b.voteCount - a.voteCount) // Sort options by votes (highest first)
        .map((option, index) => (
          <Box key={index} sx={{ mb: 2 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Typography
                variant="body1"
                sx={{ fontWeight: index === 0 ? "bold" : "normal" }}
              >
                {`${index + 1}. ${option.optionName}`}
              </Typography>
              <Typography
                variant="body1"
                sx={{ fontWeight: index === 0 ? "bold" : "normal" }}
              >
                {option.voteCount} votes
              </Typography>
            </Box>
            <Box
              sx={{
                mt: 1,
                height: 10,
                backgroundColor: "#e0e0e0",
                borderRadius: 5,
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  width: `${(option.voteCount / maxVotes) * 100}%`,
                  height: "100%",
                  backgroundColor: index === 0 ? "#3f51b5" : "#f50057",
                  transition: "width 0.3s ease-in-out",
                }}
              />
            </Box>
          </Box>
        ))}
    </Box>
  );
};
