import React, { useContext, useEffect,  useState } from "react";
import { MyContext } from "../../App";
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
import PollIcon from "@mui/icons-material/Poll";
import { getFee } from "../../background";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Spacer } from "../../common/Spacer";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";


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
  
    return (
      <Card
        sx={{
          backgroundColor: "#1F2023",
          height: isOpen ? "auto" : "150px",
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
            <PollIcon
              sx={{
                color: "white",
              }}
            />
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
            alignItems: "center",
          }}
        >
          {!isOpen && !errorMsg && (
            <>
              <Spacer height="5px" />
              <Button
                size="small"
                variant="contained"
                sx={{
                  backgroundColor: "var(--green)",
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
                  color: "var(--unread)",
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